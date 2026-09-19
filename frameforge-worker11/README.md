# FrameForge Cloudflare Library

> Part of the FrameForge monorepo. Version history is in
> [`CHANGELOG.md`](../CHANGELOG.md); architecture, deployment, the cloud
> library and the buyer checklist are in [`docs/`](../docs/).
> Canva path budgets come from `shared/frameforge-limits.js` — never
> hardcode them.

A private creator-side API that stores FrameForge overlays and frame manifests in Cloudflare R2. The Canva app reads the public library; publish/delete operations require an admin token.

## One-time Cloudflare setup

1. Install Node.js 22 or 24.
2. Open this folder in a terminal and run `npm install`.
3. Sign in with `npx wrangler login`.
4. Create the bucket: `npx wrangler r2 bucket create frameforge-library`.
5. Create a strong private token, then run `npx wrangler secret put ADMIN_TOKEN` and paste that token when prompted. Do not put it in source code or share it.
6. Deploy with `npm run deploy`.
7. Copy the final HTTPS URL, such as `https://frameforge-library.<your-subdomain>.workers.dev`.
8. Verify `<worker-url>/api/frames` opens and returns JSON.

If `frameforge-library` is already used in your account, choose another R2 bucket name and update `bucket_name` in `wrangler.jsonc`.

## Connect FrameForge

1. Deploy the included FrameForge folder to Cloudflare Pages (project `canvaforge`, live at https://canvaforge.pages.dev).
2. Click **Library settings**.
3. Paste the Worker URL and the same admin token.
4. Build a frame, click **Fit canvas**, and choose padding.
5. Click **Publish to Canva Dev**, give it a name, and wait for success.

The token is held only for the current browser tab/session. The Worker URL is remembered locally.

## Connect the Canva development app

1. Run `npm install` and `npm start` in the Canva app folder.
2. In Canva Preview, paste the Worker URL.
3. Click **Refresh library**.
4. Click **Add** on any frame.

If Canva blocks the Worker request, add the Worker hostname to the app's allowed external/network domains in the Canva Developer Portal, then reload Preview.

## Security

- Keep `ADMIN_TOKEN` private.
- GET endpoints are public because Canva must fetch the images.
- POST and DELETE require `Authorization: Bearer <ADMIN_TOKEN>`.
- Use a separate Worker/R2 bucket for production if you later make the creator tool multi-user.


## Production hardening notes

- Frame dimensions are limited to 16384 px and native paths are validated for finite coordinates, one `M`, supported commands, and a closing `Z`.
- Uploaded data URLs must contain real PNG/JPEG signatures and remain under 12 MB per image.
- JSON responses are non-cacheable and include basic content-sniffing protection.
- The manifest remains a single R2 object. Keep creator writes to one active publishing session at a time; use a Durable Object or another serialized metadata service before enabling concurrent multi-user publishing.
