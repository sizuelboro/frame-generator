# FrameForge Worker — hardening v7.3.1

Backward-compatible safeguards added:

- JSON responses are non-cacheable and include content-sniffing and referrer protections.
- Asset responses include content-sniffing protection.
- Frame and asset dimensions must be finite and no larger than 16384 px.
- Native paths require one M command, supported Canva commands, finite coordinates, and a closing Z.
- PNG/JPEG data URLs are checked against their actual file signatures.
- Existing 12 MB per-image limit, Bearer-token authorization, folder behavior, API routes, and response shapes remain unchanged.

Architecture note: manifest.json and folders.json remain single R2 objects. Keep writes to one active creator session at a time, or add a Durable Object before enabling concurrent multi-user publishing.
