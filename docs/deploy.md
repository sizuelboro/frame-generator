# Deploy

## Studio frontend

Cloudflare Pages, project `canvaforge`.

1. Rebuild the generated limits file: `npm run build:limits`.
2. Upload the deployment root. It must contain `index.html`, `js/`,
   `mockups/` and `_headers`.
3. Open `https://canvaforge.pages.dev` and hard-refresh (Ctrl+Shift+R).

`js/` must ship with `index.html`. The Studio is a bundle of ordered classic
scripts, so a missing file breaks the page.

## Creator workflow

1. Open or build the mockup in the Studio.
2. Keep **Advanced → Auto bleed** at 6px to start; 8px suits rough or torn
   edges. It is a maximum, not a forced amount - opacity along each opening
   vertex is measured and thin borders automatically get less.
3. **Trim canvas.**
4. **Export ▾ · Export overlay PNG** for the overlay and `frame-coords.json`.
