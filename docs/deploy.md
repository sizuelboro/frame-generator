# Deploy

## 1. Worker + R2 library

```bash
cd frameforge-worker11
npm install

# one-time bucket
npx wrangler r2 bucket create frameforge-library

# admin credential - never commit this
npx wrangler secret put ADMIN_TOKEN

npx wrangler deploy
```

### Lock the admin routes to your own origins

Edit `vars.ALLOWED_ORIGINS` in `wrangler.jsonc` to a comma-separated list of
exact origins, then redeploy:

```jsonc
"vars": {
  "ALLOWED_ORIGINS": "https://canvaforge.pages.dev,https://app-XXXXXXXX.canva-apps.com"
}
```

- Your Canva app origin is shown in the Developer Portal under **App origin**.
- `GET` requests stay public, so frames already inserted in buyers' designs
  keep loading their assets.
- With the list set, an admin write from any other origin is refused with 403
  even if the caller has a valid token.
- Leaving it empty keeps the previous wide-open behaviour.

### Rate limits

`wrangler.jsonc` declares `ADMIN_LIMIT` (30/min per IP) and `READ_LIMIT`
(300/min per IP). These counters are global. If the bindings are removed the
Worker falls back to a per-isolate bucket, which is only a speed bump - keep
the bindings.

Check the deployment:

```bash
curl https://YOUR-WORKER.workers.dev/api/health
# { "ok": true, "version": "7.4", "pathBudget": 1980,
#   "originLocked": true, "rateLimited": true }
```

## 2. Studio frontend

Cloudflare Pages, project `canvaforge`.

1. Rebuild the generated limits file: `npm run build:limits`.
2. Upload the deployment root. It must contain `index.html`, `js/`,
   `mockups/` and `_headers`.
3. Open `https://canvaforge.pages.dev` and hard-refresh (Ctrl+Shift+R).

`js/` must ship with `index.html`. The Studio is a bundle of ordered classic
scripts, so a missing file breaks the page.

## 3. Canva app

```bash
cd frameforge-canva-app11
npm install
npm run typecheck
npm run build        # -> dist/app.js
```

Upload `dist/app.js` in the Canva Developer Portal, then allow your Worker
hostname under the portal's external/network URL settings, or library fetches
will be blocked in Preview.

## 4. Creator workflow

1. Open or build the mockup in the Studio.
2. Keep **Auto bleed** at 6px to start; 8px suits rough or torn edges. It is
   a maximum, not a forced amount - opacity along each opening vertex is
   measured and thin borders automatically get less. If alpha inspection
   fails, publishing proceeds with no bleed.
3. **Trim canvas.**
4. **Publish to Canva.** Reusing an existing name replaces that entry.
5. In the Canva app, **Refresh library**.
6. Insert a **new** copy to test. Already-inserted elements never update.

## Verify before selling

Run `npm test` for the automated suites, then work through
`docs/buyer-test.md`. Account-bound Canva behaviour cannot be verified
automatically.
