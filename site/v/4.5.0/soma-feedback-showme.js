/* PlayMaker/SOMA Feedback "Show me" companion. Plain JS by design. */
(function () {
  'use strict';
  if (typeof window === 'undefined' || window.somaFeedbackShowMe) return;

  var SKIP_SELECTOR = [
    '.soma-feedback-root', '.soma-showme-toolbar', '.soma-showme-workbench',
    '[data-feedback-skip]',
    '[data-live-edit-ui]', '[data-live-edit-skip]',
    '.cm-editor', '[data-soma-widget]', '[class^="smgr"]', '[id^="smgr"]',
    'script', 'style', 'link', 'meta', 'noscript',
  ].join(',');
  var STYLE_PROPERTIES = [
    'display', 'font-family', 'font-size', 'font-style', 'font-weight',
    'text-transform', 'text-align', 'text-indent', 'margin-top', 'margin-right',
    'margin-bottom', 'margin-left', 'padding-left', 'line-height', 'color',
    'background-color', 'width', 'white-space',
  ];
  var state = null;

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function isSkipped(node) {
    return !(node instanceof Element) || node === document.documentElement || node === document.body || Boolean(node.closest(SKIP_SELECTOR));
  }

  function selectableAtPoint(x, y) {
    var nodes = document.elementsFromPoint ? document.elementsFromPoint(x, y) : [document.elementFromPoint(x, y)];
    return nodes.find(function (node) { return node && !isSkipped(node); }) || null;
  }

  function isContainer(node) {
    if (!(node instanceof HTMLElement) || isSkipped(node)) return false;
    if (node.matches('[data-area],section,article,aside,form,header,footer,nav,li,p,[data-block-id]')) return true;
    var style = window.getComputedStyle(node);
    return style.display === 'flex' || style.display === 'grid' || style.backgroundColor !== 'rgba(0, 0, 0, 0)';
  }

  function selectionPath(target) {
    var path = [];
    var clicked = target;
    var stop = document.querySelector('main') || document.getElementById('root') || document.body;
    while (target && target !== stop) {
      if (isContainer(target)) path.unshift(target);
      target = target.parentElement;
    }
    // The element actually clicked is always the deepest step, container or
    // not: otherwise a headline inside a card can never be selected on its own.
    if (clicked && !isSkipped(clicked) && path[path.length - 1] !== clicked) path.push(clicked);
    return path;
  }

  function dataAttributes(root) {
    var result = [];
    [root].concat(Array.prototype.slice.call(root.querySelectorAll('*'))).forEach(function (node) {
      var attrs = {};
      Array.prototype.forEach.call(node.attributes || [], function (attr) {
        if (attr.name.indexOf('data-') === 0) attrs[attr.name] = attr.value;
      });
      if (Object.keys(attrs).length) result.push({ path: elementPath(root, node), attributes: attrs });
    });
    return result;
  }

  function elementPath(root, node) {
    if (root === node) return ':scope';
    var parts = [];
    while (node && node !== root) {
      var index = node.parentElement ? Array.prototype.indexOf.call(node.parentElement.children, node) + 1 : 1;
      parts.unshift(node.tagName.toLowerCase() + ':nth-child(' + index + ')');
      node = node.parentElement;
    }
    return ':scope > ' + parts.join(' > ');
  }

  function sanitizeClone(original) {
    var clone = original.cloneNode(true);
    var originals = [original].concat(Array.prototype.slice.call(original.querySelectorAll('*')));
    var clones = [clone].concat(Array.prototype.slice.call(clone.querySelectorAll('*')));
    clones.forEach(function (node, index) {
      if (/^(INPUT|TEXTAREA|SELECT)$/i.test(node.tagName)) node.remove();
      else {
        var computed = window.getComputedStyle(originals[index]);
        node.removeAttribute('id');
        node.classList.remove('soma-showme-selected', 'soma-showme-hover');
        node.removeAttribute('contenteditable');
        node.removeAttribute('value');
        STYLE_PROPERTIES.forEach(function (property) {
          var value = computed.getPropertyValue(property);
          if (value) node.style.setProperty(property, value);
        });
      }
    });
    clone.querySelectorAll('script,style,noscript').forEach(function (node) { node.remove(); });
    return clone;
  }

  function styleSummary(root) {
    return [root].concat(Array.prototype.slice.call(root.querySelectorAll('[data-block-id]'))).map(function (node) {
      var computed = window.getComputedStyle(node);
      var styles = {};
      STYLE_PROPERTIES.forEach(function (property) { styles[property] = computed.getPropertyValue(property); });
      return { blockId: node.getAttribute('data-block-id') || null, styles: styles };
    });
  }

  function captureRegion(target) {
    var clone = sanitizeClone(target);
    return {
      id: 'region-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7),
      element: target,
      text: (target.textContent || '').trim(),
      rect: rectObject(target.getBoundingClientRect()),
      dataAttributes: dataAttributes(target),
      styleSummary: styleSummary(target),
      beforeHtml: clone.outerHTML,
      editor: null,
    };
  }

  function rectObject(rect) {
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, top: rect.top, right: rect.right, bottom: rect.bottom, left: rect.left };
  }

  function describePointerTarget(node) {
    if (!node || isSkipped(node)) return null;
    var bits = [node.tagName.toLowerCase()];
    if (node.getAttribute('data-block-id')) bits.push('block ' + node.getAttribute('data-block-id'));
    if (node.getAttribute('data-block-type')) bits.push('type ' + node.getAttribute('data-block-type'));
    var text = (node.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 60);
    if (text) bits.push('“' + text + '”');
    return bits.join(' — ');
  }

  function transcriptSegment(text, pointerTarget, now) {
    return { timestamp: (now || new Date()).toISOString(), text: String(text).trim(), pointerTarget: describePointerTarget(pointerTarget) };
  }

  function publicRegions() {
    return state.regions.map(function (region) {
      var edited = Boolean(region.editor && region.editor.innerHTML !== region.beforeHtml);
      // afterHtml only when Mike changed something: an unedited copy doubled
      // every request (75 KB → about 36k tokens) for no information.
      var out = {
        text: region.text,
        rect: region.rect,
        dataAttributes: region.dataAttributes,
        styleSummary: region.styleSummary,
        beforeHtml: region.beforeHtml,
        edited: edited,
      };
      if (edited) out.afterHtml = region.editor.innerHTML;
      return out;
    });
  }

  function renderRegions() {
    state.regionsHost.textContent = '';
    state.regions.forEach(function (region, index) {
      var card = el('section', 'soma-showme-region');
      var label = el('div', 'soma-showme-region-label', 'Region ' + (index + 1));
      var editor = el('div', 'soma-showme-region-editor');
      editor.contentEditable = 'true';
      editor.innerHTML = region.beforeHtml;
      editor.addEventListener('keydown', formatShortcut);
      region.editor = editor;
      card.appendChild(label);
      card.appendChild(editor);
      state.regionsHost.appendChild(card);
    });
    state.empty.hidden = state.regions.length > 0;
    state.workbench.setAttribute('data-region-count', state.regions.length ? state.regions.length + (state.regions.length === 1 ? ' region' : ' regions') : 'Pointing');
  }

  function formatShortcut(event) {
    if (!(event.metaKey || event.ctrlKey) || !/^[bi]$/i.test(event.key)) return;
    event.preventDefault();
    document.execCommand(event.key.toLowerCase() === 'b' ? 'bold' : 'italic', false);
  }

  function selectTarget(target, additive) {
    if (!target) return;
    if (!additive) state.regions.forEach(function (region) { region.element.classList.remove('soma-showme-selected'); });
    if (!additive) state.regions = [];
    if (state.regions.some(function (region) { return region.element === target; })) return;
    target.classList.add('soma-showme-selected');
    state.regions.push(captureRegion(target));
    renderRegions();
  }

  function pointerMove(event) {
    state.pointerTarget = selectableAtPoint(event.clientX, event.clientY);
    if (!state.pointing) return;
    if (state.hover) state.hover.classList.remove('soma-showme-hover');
    state.hover = state.pointerTarget;
    if (state.hover) state.hover.classList.add('soma-showme-hover');
  }

  function pointClick(event) {
    if (!state.pointing || isSkipped(event.target)) return;
    event.preventDefault();
    event.stopPropagation();
    var rawTarget = selectableAtPoint(event.clientX, event.clientY);
    var path = selectionPath(rawTarget);
    var containing = state.regions.find(function (region) { return region.element.contains(rawTarget); });
    var target = path[0] || rawTarget;
    if (containing) {
      var currentIndex = path.indexOf(containing.element);
      if (currentIndex >= 0 && path[currentIndex + 1]) target = path[currentIndex + 1];
    }
    selectTarget(target, event.shiftKey);
  }

  function escapeKey(event) {
    if (event.key !== 'Escape' || !state) return;
    // Esc inside the workbench (typing, editing a clone) must not close Show me
    // and throw away what was typed.
    if (state.workbench.contains(event.target)) return;
    if (!state.regions.length) { close(); return; }
    event.preventDefault();
    var last = state.regions[state.regions.length - 1];
    var parent = last.element.parentElement;
    while (parent && isSkipped(parent)) parent = parent.parentElement;
    last.element.classList.remove('soma-showme-selected');
    state.regions.pop();
    if (parent) selectTarget(parent, true);
    else renderRegions();
  }

  function addTranscript(text, isFinal) {
    text = String(text || '').trim();
    if (!text) return;
    if (isFinal) {
      state.transcript.push(transcriptSegment(text, state.pointerTarget));
      state.typed.value = state.transcript.map(function (part) { return part.text; }).join(' ');
      scheduleUnderstand();
    } else state.interim.textContent = text;
  }

  function startRecognition() {
    var Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Recognition) { state.typed.focus(); setStatus('Speech recognition is unavailable here; type instead.'); return; }
    if (state.recognition) { state.recognition.stop(); return; }
    var recognition = new Recognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.onresult = function (event) {
      var interim = '';
      for (var i = event.resultIndex; i < event.results.length; i++) {
        var text = event.results[i][0].transcript;
        if (event.results[i].isFinal) addTranscript(text, true); else interim += text;
      }
      state.interim.textContent = interim;
    };
    recognition.onend = function () { state.recognition = null; state.talkBtn.classList.remove('is-active'); };
    recognition.onerror = function () { setStatus('I could not hear that. You can type instead.', true); };
    state.recognition = recognition;
    state.talkBtn.classList.add('is-active');
    recognition.start();
  }

  function captureTyped() {
    var text = state.typed.value.trim();
    if (!text) return;
    var joined = state.transcript.map(function (part) { return part.text; }).join(' ').trim();
    if (text !== joined) state.transcript.push({ timestamp: new Date().toISOString(), text: text.slice(joined.length).trim() || text, pointerTarget: describePointerTarget(state.pointerTarget) });
  }

  function scheduleUnderstand() {
    clearTimeout(state.silenceTimer);
    state.silenceTimer = setTimeout(function () { converse('understand'); }, 1500);
  }

  async function evidence() {
    captureTyped();
    var regions = publicRegions();
    var elements = state.regions.map(function (region) { return region.element; });
    var appContext = null;
    if (typeof window.somaFeedbackContext === 'function') {
      try { appContext = await window.somaFeedbackContext(elements); } catch (_) { appContext = null; }
    }
    return {
      page: { url: location.href, title: document.title },
      regions: regions,
      transcript: state.transcript.slice(),
      appContext: appContext,
      conversation: state.conversation.slice(),
    };
  }

  async function converse(mode) {
    if (!state || state.busy) return;
    clearTimeout(state.silenceTimer);
    if (!state.transcript.length && !state.regions.length) { setStatus('Point at something or tell me what should change.', true); return; }
    state.busy = true;
    setStatus(mode === 'consult' ? 'Consulting the smart model…' : 'Repeating that back…');
    try {
      var body = await evidence();
      body.mode = mode;
      if (mode === 'consult') body.confirmedUnderstanding = state.confirmedUnderstanding;
      var auth = await state.bridge.resolveAuthHeader();
      var headers = { 'Content-Type': 'application/json' };
      if (auth) headers.Authorization = auth;
      var response = await fetch(state.bridge.converseEndpoint, { method: 'POST', headers: headers, body: JSON.stringify(body) });
      var data = await response.json().catch(function () { return {}; });
      if (!response.ok) throw new Error(data.error || 'The conversation could not continue.');
      if (mode === 'understand') renderUnderstanding(data);
      else renderConsult(data);
      setStatus('');
    } catch (error) { setStatus(error.message || 'The conversation could not continue.', true); }
    finally { if (state) state.busy = false; }
  }

  function renderUnderstanding(reply) {
    state.latestUnderstanding = reply;
    state.conversation.push({ role: 'assistant', content: reply.understanding });
    state.turns.textContent = '';
    state.turns.appendChild(el('p', 'soma-showme-ai', reply.understanding));
    if (reply.differences && reply.differences.length) state.turns.appendChild(el('p', 'soma-showme-differences', reply.differences.join(' · ')));
    if (reply.question) state.turns.appendChild(el('p', 'soma-showme-question', reply.question));
    var buttons = el('div', 'soma-showme-turn-actions');
    var yes = el('button', '', "Yes, that's it");
    var no = el('button', '', 'Not quite');
    yes.onclick = function () { state.confirmedUnderstanding = reply.understanding; converse('consult'); };
    no.onclick = function () { setStatus('Keep pointing or talking, then Send again.'); state.typed.focus(); };
    buttons.appendChild(yes); buttons.appendChild(no); state.turns.appendChild(buttons);
    if (state.speaker.checked && window.speechSynthesis) window.speechSynthesis.speak(new SpeechSynthesisUtterance(reply.understanding));
  }

  function renderConsult(reply) {
    state.consultReply = reply;
    state.turns.textContent = '';
    ['diagnosis', 'proposal', 'risks', 'questions'].forEach(function (key) {
      if (reply[key]) { state.turns.appendChild(el('strong', '', key[0].toUpperCase() + key.slice(1))); state.turns.appendChild(el('p', '', Array.isArray(reply[key]) ? reply[key].join(' · ') : reply[key])); }
    });
    if (reply.likelyPlaces && reply.likelyPlaces.length) { state.turns.appendChild(el('strong', '', 'Likely places')); state.turns.appendChild(el('p', '', reply.likelyPlaces.join(' · '))); }
    var file = el('button', 'soma-showme-file', 'File it');
    file.onclick = fileIt;
    state.turns.appendChild(file);
  }

  async function fileIt() {
    if (state.busy || !state.confirmedUnderstanding) return;
    state.busy = true; setStatus('Filing…');
    try {
      var full = await evidence();
      full.understandingReply = state.latestUnderstanding;
      full.consultReply = state.consultReply;
      var result = await state.bridge.submitShowMe(state.confirmedUnderstanding, [{ role: 'user', content: JSON.stringify(full) }]);
      if (!result || (result.status !== 'accepted' && !result.ok)) throw new Error('The feedback was not accepted.');
      var replyMessage = typeof result.message === 'string' && result.message.trim() ? result.message : '';
      setStatus(replyMessage || 'Filed ✓');
      setTimeout(close, 900);
    } catch (error) { setStatus(error.message || 'Could not file it just now.', true); state.busy = false; }
  }

  function setStatus(text, error) { if (state) { state.status.textContent = text || ''; state.status.classList.toggle('is-error', Boolean(error)); } }

  function build(bridge) {
    var toolbar = el('div', 'soma-showme-toolbar'); toolbar.setAttribute('data-feedback-skip', '');
    var point = el('button', '', 'Point'); var talk = el('button', '', 'Talk'); var send = el('button', '', 'Send'); var done = el('button', '', 'Done');
    [point, talk, send, done].forEach(function (button) { toolbar.appendChild(button); });
    var workbench = el('aside', 'soma-showme-workbench'); workbench.setAttribute('data-feedback-skip', ''); workbench.setAttribute('data-region-count', 'Pointing');
    var header = el('header', '', "What I'm showing");
    var empty = el('p', 'soma-showme-empty', 'Choose Point, then click a part of the page. Shift-click adds another region.');
    var regionsHost = el('div', 'soma-showme-regions');
    var transcriptLabel = el('label', 'soma-showme-label', 'What I mean');
    var typed = el('textarea', 'soma-showme-transcript'); typed.placeholder = 'Talk or type what should change…';
    var interim = el('div', 'soma-showme-interim');
    var speakerLabel = el('label', 'soma-showme-speaker'); var speaker = document.createElement('input'); speaker.type = 'checkbox'; speakerLabel.appendChild(speaker); speakerLabel.appendChild(document.createTextNode(' Read the repeat-back aloud'));
    var turns = el('div', 'soma-showme-turns'); var status = el('div', 'soma-showme-status'); status.setAttribute('aria-live', 'polite');
    // The conversation sits above the regions: a tall region must never push
    // the narration box and the AI's reply below the fold.
    [header, transcriptLabel, typed, interim, speakerLabel, turns, status, empty, regionsHost].forEach(function (node) { workbench.appendChild(node); });
    document.body.appendChild(toolbar); document.body.appendChild(workbench);
    state = { bridge: bridge, toolbar: toolbar, workbench: workbench, pointBtn: point, talkBtn: talk, regionsHost: regionsHost, empty: empty, typed: typed, interim: interim, speaker: speaker, turns: turns, status: status, regions: [], transcript: [], conversation: [], pointerTarget: null, hover: null, pointing: false, recognition: null, silenceTimer: null, busy: false };
    point.onclick = function () {
      state.pointing = !state.pointing;
      point.classList.toggle('is-active', state.pointing);
      // While pointing, the workbench folds to a strip so the page under it
      // can be pointed at; it opens again when Point is turned off.
      workbench.classList.toggle('is-folded', state.pointing);
      if (!state.pointing && state.hover) { state.hover.classList.remove('soma-showme-hover'); state.hover = null; }
    };
    talk.onclick = startRecognition; send.onclick = function () { converse('understand'); }; done.onclick = close;
    document.addEventListener('pointermove', pointerMove, true); document.addEventListener('click', pointClick, true); document.addEventListener('keydown', escapeKey, true);
  }

  function close() {
    if (!state) return;
    clearTimeout(state.silenceTimer);
    if (state.recognition) state.recognition.stop();
    if (state.hover) state.hover.classList.remove('soma-showme-hover');
    state.regions.forEach(function (region) { region.element.classList.remove('soma-showme-selected'); });
    document.removeEventListener('pointermove', pointerMove, true); document.removeEventListener('click', pointClick, true); document.removeEventListener('keydown', escapeKey, true);
    state.toolbar.remove(); state.workbench.remove(); state = null;
  }

  window.somaFeedbackShowMe = { open: function (bridge) { if (!state) build(bridge); }, close: close, _test: { isSkipped: isSkipped, selectionPath: selectionPath, describePointerTarget: describePointerTarget, transcriptSegment: transcriptSegment } };
}());
