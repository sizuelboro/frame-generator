'use strict';
/* =========================================================================
   FrameForge Studio - 15-download.js
   download fallback for preview panes
   -------------------------------------------------------------------------
   Part of one ordered classic-script bundle. These files share the global
   scope on purpose and MUST stay in the order listed in index.html.
   ========================================================================= */

/* --------------------------- download fallback ---------------------------
   Preview panes and sandboxed iframes (Notion file preview, Edge/Chrome file
   preview) silently block programmatic downloads. We still hand the user a
   real link they can click, and tell them what happened. */

const _embedded = (() => { try { return window.top !== window.self; } catch (e) { return true; } })();

function showDownloadCard(url, name) {
  const back = uiBackdrop();
  back.style.zIndex = '10000';
  const card = uiEl('div', 'dlg');
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-modal', 'true');
  card.appendChild(uiEl('div', 'dlg-title', 'Your file is ready'));
  card.appendChild(uiEl('div', 'dlg-sub', 'This preview pane blocks automatic downloads. Use the button below, or open FrameForge in a normal browser tab for one-click saving.'));
  const file = uiEl('div', 'dlg-file');
  file.innerHTML = '<svg class="ic"><use href="#i-file"/></svg>';
  file.appendChild(uiEl('span', '', name));
  card.appendChild(file);
  const row = uiEl('div', 'dlg-acts');
  const open = uiEl('a', 'btn', 'Open in new tab');
  open.href = url; open.target = '_blank'; open.rel = 'noopener';
  const save = uiEl('a', 'btn primary', 'Save ' + (name.split('.').pop() || 'file').toUpperCase());
  save.href = url; save.download = name;
  const close = uiButton('Close', false);
  close.onclick = () => back.remove();
  back.onmousedown = (e) => { if (e.target === back) back.remove(); };
  row.appendChild(close); row.appendChild(open); row.appendChild(save);
  card.appendChild(row);
  back.appendChild(card);
  document.body.appendChild(back);
  save.focus();
}

download = function (blobOrUrl, name) {
  const url = typeof blobOrUrl === 'string' ? blobOrUrl : URL.createObjectURL(blobOrUrl);
  let clicked = false;
  try {
    const a = document.createElement('a');
    a.download = name;
    a.href = url;
    a.rel = 'noopener';
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    a.remove();
    clicked = true;
  } catch (e) { clicked = false; }
  // In a preview pane the click above is swallowed, so always offer a real link.
  if (_embedded || !clicked) showDownloadCard(url, name);
  else setTimeout(() => { if (typeof blobOrUrl !== 'string') URL.revokeObjectURL(url); }, 20000);
};

if (_embedded) {
  setTimeout(() => toast('Preview pane detected · downloads will open a Save link. Open the file in a browser tab for direct saving.'), 1600);
}
