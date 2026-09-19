# FrameForge Canva App — hardening v7.3.1

Backward-compatible safeguards added without changing the normal frame workflow:

- Worker URLs must use HTTPS; localhost HTTP remains available for development.
- Mockup and Smart Mask dimensions must be finite and no larger than 16384 px.
- Smart Mask photo uploads must be images and no larger than 25 MB.
- Native paths require one M command, supported Canva commands, finite coordinates, and a closing Z.
- The admin-token UI now explains that the token is session-only and includes a Clear token action.
- Active folder buttons expose their selected state to assistive technology.
- Documentation now accurately distinguishes public frame browsing from admin-only folder/move/delete operations.

The regular browse, add, update, folder, move, and delete flows are otherwise unchanged.
