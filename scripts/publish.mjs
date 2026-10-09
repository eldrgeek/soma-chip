#!/usr/bin/env node
/**
 * publish.mjs — publish a SOMA feedback chip version to the central host.
 *
 *   node scripts/publish.mjs <version>             # build site/v/<version>/ from SOMA origin/main,
 *                                                  # run the chip checks, point channels/beta.json at it
 *   node scripts/publish.mjs --promote <version>   # point channels/stable.json at a version whose checks passed
 *   node scripts/publish.mjs --verify              # every manifest's files exist and match their hashes
 *
 * Then commit and push this repo; Netlify deploys soma-chip.netlify.app on push.
 *
 * Rules this script enforces:
 *   - The chip comes from SOMA's origin/main, read through a temporary worktree,
 *     never from ~/Projects/SOMA's working tree (it is often on another
 *     session's branch; on 2026-09-20 a regeneration from such a branch silently
 *     removed the chip's drag from PlayMaker).
 *   - A published version is immutable: republishing the same number with
 *     different bytes is refused. Fix forward with a new number.
 *   - Promotion to stable requires the version's recorded checks to have passed
 *     (standards/soma-feedback/drag-check.mjs and page-text-check.mjs).
 *
 * Written 2026-10-09 (Mike Wolf; Claude Opus 5.5, CCc). Bead pm-bjcp.
 */
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SITE = path.join(ROOT, 'site');
const SOMA = process.env.SOMA_REPO || path.join(process.env.HOME, 'Projects/SOMA');
const FILES = ['soma-feedback.js', 'soma-feedback.css', 'soma-feedback-showme.js', 'soma-feedback-showme.css'];
const CHECKS = ['drag-check.mjs', 'page-text-check.mjs'];

const die = (msg) => { console.error(`publish: ${msg}`); process.exit(1); };
const sri = (buf) => 'sha256-' + createHash('sha256').update(buf).digest('base64');
const git = (args, opts = {}) => execFileSync('git', ['-C', SOMA, ...args], { encoding: 'utf8', ...opts }).trim();
const writeJson = (file, value) => writeFileSync(file, JSON.stringify(value, null, 2) + '\n');

function manifestFor(version) {
  const dir = path.join(SITE, 'v', version);
  return {
    version,
    js: `v/${version}/soma-feedback.js`,
    css: `v/${version}/soma-feedback.css`,
    sri: {
      js: sri(readFileSync(path.join(dir, 'soma-feedback.js'))),
      css: sri(readFileSync(path.join(dir, 'soma-feedback.css'))),
    },
  };
}

function publish(version) {
  if (!/^\d+\.\d+\.\d+$/.test(version)) die(`version must look like 4.4.0, got "${version}"`);
  git(['fetch', '-q', 'origin', 'main']);
  const main = git(['rev-parse', 'origin/main']);
  const wt = mkdtempSync(path.join(tmpdir(), 'soma-chip-src-'));
  rmSync(wt, { recursive: true, force: true });
  git(['worktree', 'add', '-q', '--detach', wt, main]);
  try {
    const src = path.join(wt, 'standards/soma-feedback');
    const dir = path.join(SITE, 'v', version);
    if (existsSync(dir)) {
      for (const f of FILES) {
        const was = readFileSync(path.join(dir, f));
        if (!was.equals(readFileSync(path.join(src, f)))) {
          die(`v/${version}/${f} is already published with different bytes; versions are immutable, publish a new number`);
        }
      }
      console.log(`publish: v/${version} already published with identical bytes`);
    }

    const results = CHECKS.map((check) => {
      const run = spawnSync('node', [path.join(src, check)], { cwd: src, encoding: 'utf8', timeout: 300_000 });
      const out = `${run.stdout || ''}${run.stderr || ''}`;
      const summary = (out.match(/\d+\/\d+ checks passed/) || ['(no summary)'])[0];
      console.log(`publish: ${check}: exit ${run.status}, ${summary}`);
      return { check, exit: run.status, summary };
    });

    mkdirSync(dir, { recursive: true });
    for (const f of FILES) writeFileSync(path.join(dir, f), readFileSync(path.join(src, f)));
    const passed = results.every((r) => r.exit === 0);
    writeJson(path.join(dir, 'checks.json'), {
      version, soma_commit: main, published_at: new Date().toISOString(), passed, results,
    });
    mkdirSync(path.join(SITE, 'channels'), { recursive: true });
    writeJson(path.join(SITE, 'channels', 'beta.json'), manifestFor(version));
    console.log(`publish: v/${version} from SOMA ${main.slice(0, 7)}; checks ${passed ? 'PASSED' : 'FAILED'}; beta -> ${version}`);
    if (!passed) console.log('publish: stable cannot be promoted to this version until a version passes its checks.');
  } finally {
    git(['worktree', 'remove', '--force', wt]);
  }
}

function promote(version) {
  const checksFile = path.join(SITE, 'v', version, 'checks.json');
  if (!existsSync(checksFile)) die(`v/${version} is not published`);
  const checks = JSON.parse(readFileSync(checksFile, 'utf8'));
  if (!checks.passed) die(`v/${version} did not pass its checks; see ${path.relative(ROOT, checksFile)}`);
  writeJson(path.join(SITE, 'channels', 'stable.json'), manifestFor(version));
  console.log(`publish: stable -> ${version}`);
}

function verify() {
  let bad = 0;
  const channels = path.join(SITE, 'channels');
  for (const name of readdirSync(channels).filter((n) => n.endsWith('.json'))) {
    const m = JSON.parse(readFileSync(path.join(channels, name), 'utf8'));
    for (const kind of ['js', 'css']) {
      const file = path.join(SITE, m[kind]);
      if (!existsSync(file)) { console.log(`MISSING ${name}: ${m[kind]}`); bad++; continue; }
      const got = sri(readFileSync(file));
      if (got !== m.sri[kind]) { console.log(`HASH MISMATCH ${name}: ${m[kind]}`); bad++; }
    }
    console.log(`${name}: ${m.version}`);
  }
  if (bad) die(`${bad} problem(s)`);
  console.log('verify: every channel points at files that exist and match their hashes');
}

const [a, b] = process.argv.slice(2);
if (a === '--promote' && b) promote(b);
else if (a === '--verify') verify();
else if (a && !a.startsWith('--')) publish(a);
else die('usage: publish.mjs <version> | --promote <version> | --verify');
