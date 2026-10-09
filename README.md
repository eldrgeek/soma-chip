# soma-chip

The central host for the SOMA feedback chip: <https://soma-chip.netlify.app>. Netlify deploys it on every push to `main`.

A site installs the chip loader once. After that, upgrading the chip on that site means publishing here; the site is not rebuilt.

## How a site uses it

1. **Vendor the loader and keep a fallback copy.** Copy `SOMA/standards/soma-feedback/soma-chip-loader.js` into the site. Keep the vendored `soma-feedback.js` and `.css` the site already has. Those are the fallback.
2. **Proxy `/soma-chip/*` here, same-origin.** For Netlify, the rule goes before any single-page-app fallback:

   ```toml
   [[redirects]]
     from = "/soma-chip/*"
     to = "https://soma-chip.netlify.app/:splat"
     status = 200
     force = true
   ```

3. **Mount the loader where the chip used to be.** Keep the same `data-*` attributes:

   ```html
   <script src="/vendor/soma-feedback/soma-chip-loader.js"
           data-site="playmaker" data-endpoint="/api/submit-feedback-widget" defer></script>
   ```

The loader reads `/soma-chip/channels/stable.json` and loads the version it names, with subresource integrity. It falls back to the site's copy if anything fails or takes more than 3 seconds. `window.somaChipLoader` says which one ran. `?soma-chip=beta` tries the beta channel in one browser, `?soma-chip=local` forces the site's copy, and `?soma-chip=stable` goes back to the default.

## Publishing a version

```bash
node scripts/publish.mjs 4.4.1
```

That command:

- builds `site/v/4.4.1/` from SOMA `origin/main`;
- runs `drag-check.mjs` and `page-text-check.mjs`;
- points `beta` at the new version.

Commit and push. Then check it on a site with `?soma-chip=beta`.

```bash
node scripts/publish.mjs --promote 4.4.1
```

That command points `stable` at the version, and is refused unless its checks passed. Commit and push.

```bash
node scripts/publish.mjs --verify
```

That command confirms every channel points at files that exist and match their hashes.

**Rollback** is `--promote` with the previous version. Published versions are immutable, so the old files are still here.

## Sites using it

- PlayMaker, from 2026-10-09 (bead pm-bjcp).

Written 2026-10-09 by Mike Wolf and Claude Opus 5.5 (CCc).
