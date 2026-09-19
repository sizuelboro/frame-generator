FRAMEFORGE CANVA OVERLAY ORDER FIX

Problem fixed:
With opening bleed enabled, Canva rendered the expanded photo path above the artwork because the drop-target paths came after the overlay path.

Fix:
Drop-target paths are now created first (underneath), and the transparent overlay artwork path is created last (on top). Bleed can extend beneath the border without covering the artwork.

Install:
1) Delete the damaged test element from the Canva design.
2) Stop npm start with Ctrl+C.
3) Copy this ZIP's src/app.tsx over:
   C:\xampp\htdocs\frameforge\frameforge-canva-app\src\app.tsx
4) Run npm start again.
5) Reload the Canva app panel.
6) Refresh library and Add a NEW copy of the frame.

No Worker or Cloudflare Pages redeploy is required for this fix.
