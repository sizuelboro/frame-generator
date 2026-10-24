'use strict';
/* =========================================================================
   FrameForge Studio - 10-dialogs.js
   in-app modal dialogs replacing native prompt/confirm
   -------------------------------------------------------------------------
   Part of one ordered classic-script bundle. These files share the global
   scope on purpose and MUST stay in the order listed in index.html.
   ========================================================================= */

/* ---------------------------- in-app dialogs ----------------------------
   Some viewers (Edge/Chrome file preview, sandboxed iframes, Notion preview)
   silently block window.confirm / window.prompt, which made buttons look dead.
   These modals are plain DOM, so they always work. */

function uiModal(opts) {
  return new Promise((resolve) => {
    const back = document.createElement('div');
    back.style.cssText = 'position:fixed;inset:0;background:rgba(15,17,21,.45);z-index:9999;display:flex;align-items:center;justify-content:center;font:13px/1.45 ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,sans-serif';
    const card = document.createElement('div');
    card.style.cssText = 'background:#fff;border-radius:12px;box-shadow:0 18px 50px rgba(0,0,0,.28);padding:18px;width:340px;max-width:calc(100vw - 32px)';
    const h = document.createElement('div');
    h.style.cssText = 'font-weight:600;font-size:14px;color:#16181d;margin-bottom:6px';
    h.textContent = opts.title || '';
    const sub = document.createElement('div');
    sub.style.cssText = 'color:#6b7280;margin-bottom:14px';
    sub.textContent = opts.message || '';
    const input = document.createElement('input');
    if (opts.input) {
      input.value = opts.value == null ? '' : String(opts.value);
      input.style.cssText = 'width:100%;box-sizing:border-box;padding:8px 10px;border:1px solid #d9dce1;border-radius:8px;font:inherit;margin-bottom:14px;outline:none';
      input.onfocus = () => { input.style.borderColor = '#2f6fed'; };
      input.onblur = () => { input.style.borderColor = '#d9dce1'; };
    }
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:8px;justify-content:flex-end';
    const mk = (label, primary) => {
      const b = document.createElement('button');
      b.textContent = label;
      b.style.cssText = 'padding:7px 14px;border-radius:8px;font:inherit;font-weight:500;cursor:pointer;border:1px solid ' +
        (primary ? '#2f6fed;background:#2f6fed;color:#fff' : '#d9dce1;background:#fff;color:#2b2f36');
      return b;
    };
    const cancel = mk(opts.cancelLabel || 'Cancel', false);
    const ok = mk(opts.confirmLabel || 'OK', true);
    const done = (v) => { document.removeEventListener('keydown', onKey, true); back.remove(); resolve(v); };
    const onKey = (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); done(null); }
      if (e.key === 'Enter') { e.stopPropagation(); e.preventDefault(); done(opts.input ? input.value : true); }
    };
    cancel.onclick = () => done(null);
    ok.onclick = () => done(opts.input ? input.value : true);
    back.onmousedown = (e) => { if (e.target === back) done(null); };
    card.appendChild(h);
    if (opts.message) card.appendChild(sub);
    if (opts.input) card.appendChild(input);
    row.appendChild(cancel); row.appendChild(ok);
    card.appendChild(row);
    back.appendChild(card);
    document.body.appendChild(back);
    document.addEventListener('keydown', onKey, true);
    if (opts.input) { input.focus(); input.select(); } else ok.focus();
  });
}

/* Multi-field dialog. Native prompt() can only ask one question, has no
   password masking, and is blocked outright in several embedded viewers.
   uiForm replaces every remaining prompt() in the Studio.

   fields: [{ name, label, value, type, placeholder, hint, liveHint, min, max, step }]

   liveHint(value) is optional and runs while the field is being typed in,
   debounced, and may be async. It returns null or { text, tone } where tone
   is 'ok' | 'warn' | 'error'. It is advisory only: it never blocks submit,
   which is still decided by validate().

   Resolves to an object keyed by field name, or null when cancelled. */
function uiForm(opts) {
  return new Promise((resolve) => {
    const fields = (opts.fields || []).map((f) => ({ ...f }));
    const back = document.createElement('div');
    back.style.cssText = 'position:fixed;inset:0;background:rgba(15,17,21,.45);z-index:9999;display:flex;align-items:center;justify-content:center;font:13px/1.45 ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,sans-serif';
    const card = document.createElement('form');
    // Use our own validation only. With native constraint validation on, the
    // browser silently blocks the submit event for an out-of-range number, so
    // our inline error never rendered and the dialog just looked stuck.
    card.noValidate = true;
    card.style.cssText = 'background:#fff;border-radius:12px;box-shadow:0 18px 50px rgba(0,0,0,.28);padding:18px;width:380px;max-width:calc(100vw - 32px);display:grid;gap:12px';

    const h = document.createElement('div');
    h.style.cssText = 'font-weight:600;font-size:14px;color:#16181d';
    h.textContent = opts.title || '';
    card.appendChild(h);

    if (opts.message) {
      const sub = document.createElement('div');
      sub.style.cssText = 'color:#6b7280;margin-top:-6px';
      sub.textContent = opts.message;
      card.appendChild(sub);
    }

    const error = document.createElement('div');
    error.style.cssText = 'display:none;padding:7px 9px;border-radius:7px;background:#FCE9E7;color:#8d2b20;font-size:12px';
    error.setAttribute('role', 'alert');
    card.appendChild(error);

    const timers = [];
    const inputs = [];
    fields.forEach((f, index) => {
      const wrap = document.createElement('label');
      wrap.style.cssText = 'display:grid;gap:4px;font-size:12px;font-weight:600;color:#2b2f36';
      wrap.textContent = f.label || f.name;

      const input = document.createElement('input');
      input.type = f.type || 'text';
      input.value = f.value == null ? '' : String(f.value);
      if (f.placeholder) input.placeholder = f.placeholder;
      if (f.type === 'password') input.autocomplete = 'off';
      if (f.min != null) input.min = String(f.min);
      if (f.max != null) input.max = String(f.max);
      if (f.step != null) input.step = String(f.step);
      input.style.cssText = 'width:100%;box-sizing:border-box;padding:8px 10px;border:1px solid #d9dce1;border-radius:8px;font:inherit;font-weight:400;outline:none';
      input.onfocus = () => { input.style.borderColor = '#2f6fed'; };
      input.onblur = () => { input.style.borderColor = '#d9dce1'; };
      wrap.appendChild(input);

      if (f.hint) {
        const hint = document.createElement('span');
        hint.style.cssText = 'color:#7D7A75;font-size:11px;font-weight:400';
        hint.textContent = f.hint;
        wrap.appendChild(hint);
      }

      if (typeof f.liveHint === 'function') {
        const live = document.createElement('span');
        live.style.cssText = 'font-size:11px;font-weight:400;min-height:15px';
        live.setAttribute('aria-live', 'polite');
        wrap.appendChild(live);
        const tones = { ok: '#1f6f43', warn: '#8a5a00', error: '#8d2b20' };
        let run = 0;
        // Only the newest answer may paint: an async check that resolves late
        // would otherwise describe a name the user has already edited away.
        const update = async () => {
          const seq = ++run;
          let result = null;
          try { result = await f.liveHint(input.value.trim()); } catch (e) { result = null; }
          if (seq !== run || !live.isConnected) return;
          live.textContent = result && result.text ? result.text : '';
          live.style.color = tones[(result && result.tone) || 'ok'] || tones.ok;
        };
        input.oninput = () => {
          clearTimeout(timers[index]);
          timers[index] = setTimeout(update, f.liveHintDelay == null ? 250 : f.liveHintDelay);
        };
        setTimeout(update, 0);
      }

      card.appendChild(wrap);
      inputs.push(input);
      if (index === 0) setTimeout(() => { input.focus(); input.select(); }, 0);
    });

    const row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:8px;justify-content:flex-end;margin-top:2px';
    const mk = (label, primary, type) => {
      const b = document.createElement('button');
      b.type = type || 'button';
      b.textContent = label;
      b.style.cssText = 'padding:7px 14px;border-radius:8px;font:inherit;font-weight:500;cursor:pointer;border:1px solid ' +
        (primary ? '#2f6fed;background:#2f6fed;color:#fff' : '#d9dce1;background:#fff;color:#2b2f36');
      return b;
    };
    const cancel = mk(opts.cancelLabel || 'Cancel', false);
    const ok = mk(opts.confirmLabel || 'Save', true, 'submit');
    row.appendChild(cancel); row.appendChild(ok);
    card.appendChild(row);

    const done = (v) => { timers.forEach(clearTimeout); document.removeEventListener('keydown', onKey, true); back.remove(); resolve(v); };
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); done(null); } };
    cancel.onclick = () => done(null);
    back.onmousedown = (e) => { if (e.target === back) done(null); };

    card.onsubmit = (e) => {
      e.preventDefault();
      const values = {};
      fields.forEach((f, i) => { values[f.name] = inputs[i].value.trim(); });
      const message = opts.validate ? opts.validate(values) : null;
      if (message) { error.textContent = message; error.style.display = 'block'; return; }
      done(values);
    };

    back.appendChild(card);
    document.body.appendChild(back);
    document.addEventListener('keydown', onKey, true);
  });
}

/* Numeric prompt with inline range validation. */
async function uiNumber(opts) {
  const result = await uiForm({
    title: opts.title,
    message: opts.message,
    confirmLabel: opts.confirmLabel || 'Apply',
    fields: [{
      name: 'value', label: opts.label || 'Value', value: opts.value,
      type: 'number', min: opts.min, max: opts.max, step: opts.step == null ? 1 : opts.step,
      hint: opts.hint,
    }],
    validate: (values) => {
      const n = Number(values.value);
      if (values.value === '' || !Number.isFinite(n)) return 'Enter a number.';
      if (opts.min != null && n < opts.min) return `Must be ${opts.min} or more.`;
      if (opts.max != null && n > opts.max) return `Must be ${opts.max} or less.`;
      return null;
    },
  });
  return result == null ? null : Number(result.value);
}

const uiConfirm = (title, message, confirmLabel) =>
  uiModal({ title, message, confirmLabel: confirmLabel || 'Continue' }).then(v => v === true);
const uiPrompt = (title, value, message) =>
  uiModal({ title, message, value, input: true, confirmLabel: 'Save' })
    .then(v => (v == null ? null : String(v)));

/* --- rebind the handlers that used native dialogs --- */

$('#btnNew').onclick = async () => {
  if (doc.layers.length) {
    const go = await uiConfirm('Start a new empty design?', 'Unsaved work on this canvas will be lost.', 'Start new');
    if (!go) return;
  }
  doc = { canvas: { w: 1200, h: 800, bg: '#FFFFFF' }, layers: [] };
  sel = null; contentEdit = null; contentCache.clear(); sizePill(); fit(); sync();
  toast('New empty canvas');
};

$('#btnSaveTpl').onclick = async () => {
  if (!doc.layers.length) { toast('Nothing to save yet — add an overlay and a frame first'); return; }
  const name = await uiPrompt('Mockup name', 'Laptop Mockup 01', 'Saved in this browser with empty frames, reusable with any artwork.');
  if (!name) return;
  const clean = JSON.parse(JSON.stringify(doc));
  clean.layers.forEach(l => { if (l.type === 'frame') l.content = null; });
  const thumbCv = exportCanvas({ scale: 0.22 });
  const list = tplAll();
  list.unshift({ id: uid(), name, doc: clean, thumb: thumbCv.toDataURL('image/jpeg', 0.6), at: Date.now() });
  tplSave(list.slice(0, 30));
  refreshTpls();
  toast('Saved — reuse it anytime from the left panel');
};

if (typeof removeBg === 'function') {
  $('#btnRemoveBg').onclick = async () => {
    const L = sel ? layer(sel) : null;
    if (!L || !L.src || (L.type !== 'image' && L.type !== 'overlay')) { toast('Select an image or overlay layer first'); return; }
    const tol = await uiNumber({
      title: 'Remove background',
      message: 'Clears the background inward from the canvas edges, so colours enclosed by the subject survive.',
      label: 'Tolerance', value: 32, min: 2, max: 160, step: 1,
      hint: 'Higher removes more. Try 32, then 48 if edges remain.',
      confirmLabel: 'Remove',
    });
    if (tol == null) return;
    toast('Removing background…');
    // removeBg is pure: it returns the new source and does not mutate the
    // layer. Discarding the result made this button silently do nothing.
    const out = await removeBg(L, clamp(tol, 2, 160));
    if (!out) { toast('Nothing matched — try a higher tolerance'); return; }
    L.src = out.src;
    imgCache.delete(out.src);
    contentCache.clear();
    sync();
    toast('Background removed');
  };
}
