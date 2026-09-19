# FrameForge Canva App

> Part of the FrameForge monorepo. Version history is in
> [`CHANGELOG.md`](../CHANGELOG.md); architecture, deployment, the cloud
> library and the buyer checklist are in [`docs/`](../docs/).
> Canva path budgets come from `shared/frameforge-limits.js` — never
> hardcode them.

Private Canva app that inserts a group containing:

1. a Canva shape whose fill has `dropTarget: true` (the frame opening), and
2. a transparent PNG overlay above it.

The app uses Canva's current App Scripts toolchain and outputs the standalone JavaScript bundle Canva expects.

## Requirements

- Node.js 24 (recommended)
- npm 11
- Chrome or Firefox for local preview
- A Canva Developer account

## Install and run

```bash
npm install
npm start
```

The Canva development bundle is served at `http://localhost:8080`. It is not a normal website, so preview it from Canva rather than opening it directly.

## Canva Developer Portal

1. Go to **Your apps → Create an app**.
2. Choose the audience you need. Development/preview mode is sufficient for personal testing.
3. Under **App source**, choose **Development URL**.
4. Enter `http://localhost:8080`.
5. Enable scope `canva:design:content:write`.
6. Click **Preview**, then **Open** when Canva asks to connect the app.
7. In Chrome, allow local-network access if prompted.

For HMR, copy the `.env` values from **Security → Credentials → .env file**, then restart `npm start`.

## Add a FrameForge mockup

1. Export the transparent overlay PNG from FrameForge.
2. Host the full PNG and thumbnail on a public HTTPS URL. Canva's backend cannot download media from localhost.
3. Save the FrameForge design JSON.
4. Convert it:

```bash
node tools/from-frameforge.mjs design.json "Floral Arch 01" arch-01
```

5. Copy the printed object into `src/mockups.json`.
6. Replace `YOUR-SITE` with the real HTTPS host.
7. Restart/reload the preview and click **Add**.

The converter accepts polygon-like `points`, `corners`, `vertices`, `quad`, or rectangle coordinates. It removes duplicate points, simplifies closed outlines, and validates Canva's 2 KB path limit.

## Prepare a sellable template

1. Insert the mockup using the app.
2. If necessary, ungroup once.
3. Keep the frame shape unlocked.
4. Lock only the overlay artwork.
5. Test drag/drop and crop behavior.
6. Publish a Canva template link.
7. Open that link from a separate buyer-style Canva account and run the checklist in `BUYER-TEST.md`.

## Important claims and limits

- Canva documents that a shape with an empty `dropTarget: true` fill is a frame and accepts dropped images/videos.
- Canva documents that created shapes are native Canva shapes.
- The app is needed to insert new mockups; inserted native elements are stored in the design.
- Do **not** promise buyer compatibility until the separate-account template test passes. Canva documentation does not explicitly guarantee every template-sharing/account-plan combination.
- Shapes allow 1–30 paths, at most 2 KB combined path data, one `M` per path, no `Q` commands, and closed paths.
- A full-size transparent overlay can affect hit-testing. Locking the overlay and testing the final template copy are mandatory.
- Current Canva setup guidance recommends Node.js 24/npm 11; the old Node 18 + Vite-only setup is outdated.

## Build a bundle

```bash
npm run build
```

Use the generated standalone JavaScript bundle for Code upload when you no longer want to depend on a local development server.


## Admin-token safety

Browsing and adding frames is public/read-only. Folder creation, rename, move, and delete actions require the Worker admin token. Keep the Canva app owner-only when using those controls, clear the token after administration, and never distribute the token with a buyer template.
