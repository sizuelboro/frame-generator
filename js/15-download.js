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
  const back = document.createElement('div');
  back.style.cssText = 'position:fixed;inset:0;background:rgba(15,17,21,.45);z-index:10000;display:flex;align-items:center;justify-content:center;font:13px/1.45 ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,sans-serif';
  const card = document.createElement('div');
  card.style.cssText = 'background:#fff;border-radius:12px;box-shadow:0 18px 50px rgba(0,0,0,.28);padding:18px;width:380px;max-width:calc(100vw - 32px)';
  const title = document.createElement('div');
  title.style.cssText = 'font-weight:600;font-size:14px;color:#16181d;margin-bottom:6px';
  title.textContent = 'Your file is ready';
  const msg = document.createElement('div');
  msg.style.cssText = 'color:#6b7280;margin-bottom:14px';
  msg.textContent = 'This preview pane blocks automatic downloads. Click the button below — or open FrameForge.html in a normal browser tab for one-click saving.';
  const nameRow = document.createElement('div');
  nameRow.style.cssText = 'font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;background:#f5f6f8;border-radius:7px;padding:7px 9px;margin-bottom:14px;color:#2b2f36;word-break:break-all';
  nameRow.textContent = name;
  const row = document.createElement('div');
  row.style.cssText = 'display:flex;gap:8px;justify-content:flex-end;align-items:center';
  const open = document.createElement('a');
  open.href = url; open.target = '_blank'; open.rel = 'noopener';
  open.textContent = 'Open in new tab';
  open.style.cssText = 'padding:7px 12px;border-radius:8px;border:1px solid #d9dce1;color:#2b2f36;text-decoration:none;font-weight:500';
  const save = document.createElement('a');
  save.href = url; save.download = name;
  save.textContent = 'Save ' + (name.split('.').pop() || 'file').toUpperCase();
  save.style.cssText = 'padding:7px 14px;border-radius:8px;border:1px solid #2f6fed;background:#2f6fed;color:#fff;text-decoration:none;font-weight:500';
  const close = document.createElement('button');
  close.textContent = 'Close';
  close.style.cssText = 'padding:7px 12px;border-radius:8px;border:1px solid #d9dce1;background:#fff;color:#2b2f36;font:inherit;font-weight:500;cursor:pointer';
  close.onclick = () => back.remove();
  back.onmousedown = (e) => { if (e.target === back) back.remove(); };
  row.appendChild(close); row.appendChild(open); row.appendChild(save);
  card.appendChild(title); card.appendChild(msg); card.appendChild(nameRow); card.appendChild(row);
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
