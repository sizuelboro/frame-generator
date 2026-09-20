'use strict';
/* =========================================================================
   FrameForge Studio - 12-silhouette.js
   silhouette tracing, hole handling, multi-object paths
   -------------------------------------------------------------------------
   Part of one ordered classic-script bundle. These files share the global
   scope on purpose and MUST stay in the order listed in index.html.
   ========================================================================= */

/* =====================================================================
   SCENE TRACK - AI mockup round-trip
   ---------------------------------------------------------------------
   Kept deliberately separate from the overlay track. Nothing here
   changes how overlays, silhouettes, auto-bleed or shadow layers work.

     1. "Export for AI"    frame -> one ZIP: keyed PNG + prompt + sidecar
     2. (user runs it through ChatGPT / any image model)
     3. "Import AI scene"  scene -> key knocked out, openings retraced,
                                    environmental shadow harvested,
                                    fresh scene document

   The opening is handed to the model as flat pure green instead of
   transparency, because image models fill transparency with invented
   content but leave a large flat block alone. Green is used rather than
   magenta so it never collides with the warm reds and creams that are
   common in frame artwork.

   Shadow IS allowed to fall across the key region. A shadow is
   multiplicative, so shadowed key green keeps r and b near zero and only
   loses brightness - which means the key can be found by hue while the
   brightness drop inside it doubles as a shadow map. That shadow is
   turned into a normal shadow layer, so whatever the buyer drops in gets
   the same window light as the frame around it.
   ===================================================================== */
const FF_SCENE_SIDECAR_KEY = 'frameforge.scene.handoff.v1';
const FF_SCENE_KEY_HEX = '#00FF00';

/* ---------------------------------------------------------------------
   Scene setting
   ---------------------------------------------------------------------
   The prompt used to offer the setting as a choice - wall, or shelf, or
   sideboard, or mantelpiece, or table - which left the decision to the
   model. Exporting the same frame twice produced two different rooms,
   so a listing built from several exports looked incoherent.

   Each option below is a single declarative sentence that replaces that
   choice. "auto" keeps the original wording for anyone who wants the
   variety.

   The standing options say upright and square-on rather than leaning
   back, because a leaning frame is a tilted frame and R6 forbids tilt.
   --------------------------------------------------------------------- */
const FF_SCENE_SETTINGS = [
  {
    id: 'auto',
    label: 'Let the model choose',
    hint: 'Original behaviour. Varies between exports.',
    line: 'Put the frame in a believable real setting: hung on a textured painted\nwall, or standing on a wooden shelf, sideboard, mantelpiece or table.'
  },
  {
    id: 'wall',
    label: 'Wall',
    hint: 'Hung flat on a painted interior wall.',
    line: 'Put the frame hung flat against a textured painted interior wall, with\nnothing else hanging beside it.'
  },
  {
    id: 'shelf',
    label: 'Shelf',
    hint: 'Standing on a wooden shelf or sideboard.',
    line: 'Put the frame standing upright and square-on on a wooden shelf or\nsideboard, with a plain wall behind it.'
  },
  {
    id: 'mantel',
    label: 'Mantelpiece',
    hint: 'Standing above a fireplace.',
    line: 'Put the frame standing upright and square-on on a mantelpiece above a\nfireplace, with the chimney breast behind it.'
  },
  {
    id: 'table',
    label: 'Table or console',
    hint: 'Standing on a desk, table or console.',
    line: 'Put the frame standing upright and square-on on a wooden table or\nconsole, with a plain wall behind it.'
  }
];

let ffSceneSetting = 'auto';

function ffSceneSettingById(id) {
  for (let i = 0; i < FF_SCENE_SETTINGS.length; i++) {
    if (FF_SCENE_SETTINGS[i].id === id) return FF_SCENE_SETTINGS[i];
  }
  return FF_SCENE_SETTINGS[0];
}

/* Describe the placeholder in numbers.

   R2 and R6 tell the model not to change the shape of the green area,
   but the prompt never said what that shape was, so there was nothing
   for the model to check itself against. If the creator declared a print
   ratio, name it and state the tolerance the importer will actually
   apply. Returns '' when nothing was declared, so the prompt stays
   exactly as it was for older documents. */
function ffScenePlaceholderSpec() {
  if (typeof doc !== 'object' || !doc || !Array.isArray(doc.layers)) return '';
  const frames = doc.layers.filter(l => l.type === 'frame');
  if (!frames.length) return '';
  const declared = frames.filter(l => l.ratioId);
  if (!declared.length) return '';

  const first = declared[0];
  const orientation = first.ratioOrientation === 'landscape' ? 'landscape' : 'portrait';
  const name = typeof ffRatioLabel === 'function'
    ? ffRatioLabel(first.ratioId, orientation)
    : String(first.ratioId);
  const value = typeof ffRatioValue === 'function'
    ? ffRatioValue(first.ratioId, orientation)
    : first.ratioValue;
  if (!value) return '';

  const mixed = declared.some(l => l.ratioId !== first.ratioId ||
    (l.ratioOrientation === 'landscape' ? 'landscape' : 'portrait') !== orientation);
  const n = frames.length;

  const lines = [
    '== THE PLACEHOLDER ==',
    'The green placeholder is a ' + name + ' print opening. Its aspect ratio is',
    'exactly ' + value.toFixed(4) + ' (width divided by height).'
  ];
  if (n === 1) {
    lines.push('There is exactly 1 green placeholder in this image.');
  } else {
    lines.push('There are exactly ' + n + ' green placeholders in this image. Keep every');
    lines.push('one of them, separate and in the same arrangement.');
    if (mixed) lines.push('They do not all share the same ratio. Keep each one as it is.');
  }
  lines.push('The returned image is measured by software. If the green area\'s own');
  lines.push('aspect ratio differs from the value above by more than 2%, it is');
  lines.push('rejected and the render is wasted.');
  return lines.join('\n');
}

function ffScenePromptFor(settingId, specBlock) {
  const setting = ffSceneSettingById(settingId);

  const blocks = [
`You are producing a commercial picture-frame mockup. The attached image
is a finished frame asset. Your job is ONLY to place it into a realistic
photographic environment. You are NOT redesigning it.`,

`The large solid green area is a reserved placeholder. A customer photo
will be inserted into it later by software that finds it by colour. If
that green is damaged, recoloured or covered, the asset is destroyed and
the output is worthless.`,

    specBlock || null,

`== WHAT TO ADD ==
` + setting.line + `
Light it with soft directional daylight coming from one side, as if from
a window just out of frame. Add, in the same light direction:
  - the cast shadow of window panes, mullions or venetian blinds falling
    across the wall, the frame AND the green area
  - dappled shadows from leaves or a nearby houseplant
  - ambient occlusion where the frame meets the surface behind it
  - a soft contact shadow under or behind the frame
Keep the result photographic: real surface texture, natural colour,
shallow depth of field is fine.`,

`== ABSOLUTE RULES ==
These are not preferences. Breaking any one of them makes the image
unusable, so re-check each before you output.`,

`R1. NOTHING inside the green area. No photo, no picture, no artwork, no
    person, no landscape, no texture, no pattern, no gradient, no noise,
    no reflection, no glass glare, no highlight, no vignette, no logo,
    no text. It stays an empty flat block of colour. Do not "helpfully"
    fill it. Do not treat it as a canvas.`,

`R2. The green area keeps EXACTLY the shape, size, position and corner
    geometry it has in the attached image, relative to the frame. Do not
    shrink it, grow it, round its corners, soften its edges, feather it,
    blur it or move it. Its boundary against the frame must stay crisp.`,

`R3. Shadows MUST continue across the green area rather than stopping at
    the frame's inner edge - but inside shadow the green must stay GREEN
    and only get DARKER. Darker green is correct and expected. Grey,
    grey-green, olive, brown, black, blue-green, teal or desaturated
    green is WRONG. Never add warm or cool colour tints to it. The
    green's red and blue channels must remain near zero everywhere.`,

`R4. Do not redraw, restyle, smooth, sharpen, simplify, embellish or
    reinterpret the frame's border artwork. Reproduce its exact
    silhouette, its scallops or carvings, its colours, its material and
    its fine detail pixel-for-pixel as far as possible. Do not change
    its thickness. Do not add or remove ornament. If you are unsure,
    copy rather than improve.`,

`R5. Keep the ENTIRE frame visible and unobstructed. Do not crop any
    edge. Do not let a plant, leaf, vase, book, hand or any other object
    pass in front of the frame or overlap it. Objects may sit beside or
    behind it only. Shadows falling on it are fine; solid objects are
    not.`,

`R6. Keep the frame's aspect ratio exactly. Do not stretch, squash, skew,
    rotate, tilt or apply perspective to it. Show it flat and square-on
    to the camera.`,

`R7. Output exactly one image. No collage, no variants side by side, no
    frame-within-a-frame, no added border, no text, no caption, no
    watermark, no signature.`,

`== SELF-CHECK BEFORE YOU ANSWER ==
Confirm all of these are true:
  1. Is the green area still completely empty?
  2. Is every green pixel still clearly green, even in deep shadow?
  3. Is the green area the same shape and proportion as the original?
  4. Is the border artwork unchanged?
  5. Is the whole frame visible, uncropped, square-on and unstretched?
  6. Do the shadows cross the green area instead of stopping at it?
  7. Is this exactly one image, with no collage, added border, text or
     watermark?
If any answer is no, fix it and re-render before replying. If you cannot
satisfy all seven rules, say so in text instead of returning a broken
image.`
  ];

  return blocks.filter(Boolean).join('\n\n');
}

/* A let, not a const: 13-scene.js writes this straight into the ZIP, so
   rebuilding it here before each export means that file needs no change. */
let FF_SCENE_PROMPT = ffScenePromptFor('auto', '');

function ffSceneRefreshPrompt() {
  FF_SCENE_PROMPT = ffScenePromptFor(ffSceneSetting, ffScenePlaceholderSpec());
  return FF_SCENE_PROMPT;
}

/* ---------------------------------------------------------------------
   Setting picker
   ---------------------------------------------------------------------
   uiForm only builds text inputs, and a list of five mutually exclusive
   settings is not a text field. This is the same card, backdrop, Escape
   and click-outside behaviour as the dialogs in 10-dialogs.js, with one
   button per option. Resolves to a setting id, or null when cancelled.
   --------------------------------------------------------------------- */
function ffPickSceneSetting() {
  return new Promise((resolve) => {
    const back = document.createElement('div');
    back.style.cssText = 'position:fixed;inset:0;background:rgba(15,17,21,.45);z-index:9999;display:flex;align-items:center;justify-content:center;font:13px/1.45 ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,sans-serif';
    const card = document.createElement('div');
    card.style.cssText = 'background:#fff;border-radius:12px;box-shadow:0 18px 50px rgba(0,0,0,.28);padding:18px;width:380px;max-width:calc(100vw - 32px);display:grid;gap:10px';

    const h = document.createElement('div');
    h.style.cssText = 'font-weight:600;font-size:14px;color:#16181d';
    h.textContent = 'Where should the frame be?';
    card.appendChild(h);

    const sub = document.createElement('div');
    sub.style.cssText = 'color:#6b7280;margin-top:-4px';
    sub.textContent = 'Pick one so every export in a listing comes back in the same kind of room.';
    card.appendChild(sub);

    const done = (v) => {
      document.removeEventListener('keydown', onKey, true);
      back.remove();
      resolve(v);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); done(null); }
    };

    FF_SCENE_SETTINGS.forEach((s) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.dataset.setting = s.id;
      const on = s.id === ffSceneSetting;
      b.style.cssText = 'display:grid;gap:2px;text-align:left;padding:9px 11px;border-radius:9px;font:inherit;cursor:pointer;border:1px solid ' +
        (on ? '#2f6fed;background:#E5F2FC' : '#d9dce1;background:#fff');
      const t = document.createElement('span');
      t.style.cssText = 'font-weight:600;color:#2b2f36';
      t.textContent = s.label;
      const d = document.createElement('span');
      d.style.cssText = 'color:#7D7A75;font-size:11.5px';
      d.textContent = s.hint;
      b.appendChild(t);
      b.appendChild(d);
      b.onclick = () => done(s.id);
      card.appendChild(b);
    });

    const row = document.createElement('div');
    row.style.cssText = 'display:flex;justify-content:flex-end;margin-top:2px';
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.textContent = 'Cancel';
    cancel.style.cssText = 'padding:7px 14px;border-radius:8px;font:inherit;font-weight:500;cursor:pointer;border:1px solid #d9dce1;background:#fff;color:#2b2f36';
    cancel.onclick = () => done(null);
    row.appendChild(cancel);
    card.appendChild(row);

    back.onmousedown = (e) => { if (e.target === back) done(null); };
    back.appendChild(card);
    document.body.appendChild(back);
    document.addEventListener('keydown', onKey, true);
  });
}

/* Wrap the export button rather than reimplementing it.

   13-scene.js binds #btnSceneExport when it loads, which is after this
   file, so the wrap is deferred to the end of the current task. If that
   handler is ever missing the button is left exactly as it was and the
   prompt falls back to the default text. */
function ffSceneStyleInstall() {
  const b = typeof $ === 'function' ? $('#btnSceneExport') : null;
  if (!b || typeof b.onclick !== 'function') return false;
  const original = b.onclick;
  b.onclick = async (ev) => {
    const picked = await ffPickSceneSetting();
    if (picked === null) return;
    ffSceneSetting = picked;
    ffSceneRefreshPrompt();
    return original.call(b, ev);
  };
  return true;
}

setTimeout(ffSceneStyleInstall, 0);

window.FF_SCENE_SETTINGS = FF_SCENE_SETTINGS;

function _ffPolyArea(pts) {
  let a = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) a += pts[j].x * pts[i].y - pts[i].x * pts[j].y;
  return Math.abs(a) / 2;
}
