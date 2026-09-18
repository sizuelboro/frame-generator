# Audit summary — 13 September 2026

## Fixed

- Replaced the generic Vite web-app setup with Canva's current `@canva/app-scripts` standalone-bundle workflow.
- Added `prepareDesignEditor` intent initialization.
- Updated Canva SDK/runtime versions and Node requirement.
- Added runtime feature detection for `addElementAtPoint`.
- Added mockup validation for dimensions, HTTPS media, path count, 2 KB path size, initial `M`, and unsupported `Q` curves.
- Improved error/success states and accessible controls.
- Reworked the converter to support several point/rectangle shapes, closed-polygon simplification, clamped segment distance, duplicate removal, byte counting, and diagnostics.
- Added a separate-account buyer test checklist.
- Corrected the setup and sales language so untested account/device behavior is not guaranteed.

## Verified here

- Official Canva documentation confirms that an empty shape fill with `dropTarget: true` is a frame.
- Official Canva documentation confirms that created shapes are native Canva shapes.
- Official Canva documentation confirms the 1–30 path, 2 KB, closed-path, and no-`Q` limits.
- Converter syntax and sample conversion passed.
- `mockups.json` and `package.json` parse successfully.
- UI static render has no detected overflow or overlap.

## Must be verified in your Canva account

- The configured Netlify overlay and thumbnail URLs return public image responses.
- The app builds after `npm install` on a networked computer.
- Canva Preview inserts the group in your chosen design type.
- The locked-overlay/unlocked-frame arrangement accepts drag/drop reliably.
- A template copy opened from a separate Canva Free account works without the app installed.
- Crop/zoom/reposition, Replace, save/reopen, export, and any promised mobile behavior all pass.

The sandbox used for this audit could not download npm packages or authenticate to the owner's Canva Developer Portal, so those account-bound checks are intentionally not marked as passed.
