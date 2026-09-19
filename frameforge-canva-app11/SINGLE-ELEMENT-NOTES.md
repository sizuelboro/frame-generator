# Single-element frame architecture

This build does not create a Canva group.

It creates one native Canva shape with multiple paths:

1. A full-canvas path filled with the transparent floral overlay image.
2. The traced opening path configured as `dropTarget: true`.

Expected result: Canva shows one shape element, while a user can drag an image into the opening and adjust that image fill. There is no separate overlay layer to lock or expose in Layers/Position.

This relies on Canva's documented support for multi-path shapes, image-filled paths, and drop-target paths. Final drag/drop, crop, template-copy, and buyer-account behavior must still be tested in Canva Preview before selling.
