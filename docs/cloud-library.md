# Live Cloudflare library

Paste the deployed Worker URL into the Canva app panel and click **Refresh
library**. Frames published from the Studio appear without editing
`mockups.json` or rebuilding the app.

The Worker URL is remembered in the browser. Browsing and adding frames needs
no credentials.

The admin token is required only for creator-side actions - folder
management, moving frames, deletion, and publishing. It is held for the
current browser session only and never written to disk. Never share it with
buyers or collaborators; the Studio shows it in a masked field and the Canva
app offers **Clear token**.

If fetches are blocked, allow the Worker hostname in the Canva Developer
Portal's external/network URL settings and reload the preview. If admin
writes return 403, the calling origin is missing from the Worker's
`ALLOWED_ORIGINS`.
