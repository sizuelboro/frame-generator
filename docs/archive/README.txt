FRAMEFORGE AUTO-SAFE BLEED (ALPHA-AWARE)

Deploy this ZIP to Cloudflare Pages. Keep index.html at the deployment root.

NEW
- Toolbar control: Auto bleed: 6px
- 6px is the maximum, not a forced amount.
- FrameForge renders the overlay and checks alpha/opacity along every opening vertex.
- Thick opaque borders can use the full bleed.
- Thin borders automatically receive less bleed.
- If an opaque border ends, the drop zone stops before the outer transparent edge.
- If alpha inspection fails, FrameForge publishes without bleed for safety.
- The overlay artwork itself is never modified.
- Alpha-aware points are used for Publish to Canva Dev and frame-coords.json export.

DEPLOY
1. Cloudflare Dashboard -> Workers & Pages -> canvaforge.
2. Create deployment / Upload assets.
3. Upload this ZIP.
4. Open https://canvaforge.pages.dev and hard-refresh with Ctrl+Shift+R.

USE
1. Open/build the mockup normally.
2. Keep Auto bleed at 6px initially (8px maximum for rough edges).
3. Fit canvas.
4. Publish using the same exact name to replace the cloud entry.
5. In the Canva app, Refresh library.
6. Insert a NEW copy to test; already inserted Canva elements do not update automatically.

SILHOUETTE FRAME
- Add or select an image, then click Silhouette frame.
- Transparent PNGs are traced from alpha automatically.
- Opaque solid backgrounds are removed from connected canvas edges using the chosen tolerance.
- The source layer is hidden (not deleted) and one polygon frame is created.
- Select that frame and Publish to Canva Dev; no source photo or overlay is baked into the Canva element.
- Cuts connected to the outside are preserved. Fully enclosed holes remain subject to Canva path limitations.


v6.3 multi fidelity correction
------------------------------
- Preserves open/transparent gaps between legs and arms/body.
- Preserves small white cut-outs and separated hair strands.
- Uses dedicated aligned path budgets for upper hair/body and lower legs.
- Packs water into more native paths without aggressive straight-line simplification.
- All generated paths contain one M and remain below 2048 bytes.
- Single silhouette and Pick opening branches are unchanged.
