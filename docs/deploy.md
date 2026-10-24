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

See the README: pick **Generate** or **From image**, make the frame, then
**Export for Pixopik**. What to do with the two files on the Pixopik side is
in [pixopik-export.md](pixopik-export.md).
