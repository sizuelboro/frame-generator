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

## Publishing never replaces an entry

Every publish creates a new library entry. The Studio sends `createOnly`, so
the Worker refuses to overwrite a frame that already owns that name, and a
name that is taken is numbered instead - `Floral Arch`, `Floral Arch 2`,
`Floral Arch 3`. `Floral Arch 2` becomes `Floral Arch 3`, not
`Floral Arch 2 2`.

The publish dialog reads the library while it is open and says whether the
typed name is free, or which existing frame owns it and what the published
name will be. If that read fails the dialog says so and publishing still
cannot overwrite anything.

This is deliberate: a repeated or mistyped name used to replace a published
frame in place and orphan its R2 assets, so work already built on top of it
broke. Bulk publish has always behaved this way. To actually retire an old
entry, delete it from the Canva app once its replacement is published.

If fetches are blocked, allow the Worker hostname in the Canva Developer
Portal's external/network URL settings and reload the preview. If admin
writes return 403, the calling origin is missing from the Worker's
`ALLOWED_ORIGINS`.
