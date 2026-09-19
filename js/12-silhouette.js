'use strict';
/* =========================================================================
   FrameForge Studio - 12-silhouette.js
   silhouette tracing, hole handling, multi-object paths
   -------------------------------------------------------------------------
   Part of one ordered classic-script bundle. These files share the global
   scope on purpose and MUST stay in the order listed in index.html.
   ========================================================================= */

/* =====================================================================
   SCENE TRACK - AI mockup round-trip
   ---------------------------------------------------------------------
   Kept deliberately separate from the overlay track. Nothing here
   changes how overlays, silhouettes, auto-bleed or shadow layers work.

     1. "Export for AI"    frame -> one ZIP: keyed PNG + prompt + sidecar
     2. (user runs it through ChatGPT / any image model)
     3. "Import AI scene"  scene -> key knocked out, openings retraced,
                                    environmental shadow harvested,
                                    fresh scene document

   The opening is handed to the model as flat pure green instead of
   transparency, because image models fill transparency with invented
   content but leave a large flat block alone. Green is used rather than
   magenta so it never collides with the warm reds and creams that are
   common in frame artwork.

   Shadow IS allowed to fall across the key region. A shadow is
   multiplicative, so shadowed key green keeps r and b near zero and only
   loses brightness - which means the key can be found by hue while the
   brightness drop inside it doubles as a shadow map. That shadow is
   turned into a normal shadow layer, so whatever the buyer drops in gets
   the same window light as the frame around it.
   ===================================================================== */
const FF_SCENE_SIDECAR_KEY = 'frameforge.scene.handoff.v1';
const FF_SCENE_KEY_HEX = '#00FF00';

const FF_SCENE_PROMPT = `You are producing a commercial picture-frame mockup. The attached image
is a finished frame asset. Your job is ONLY to place it into a realistic
photographic environment. You are NOT redesigning it.

The large solid green area is a reserved placeholder. A customer photo
will be inserted into it later by software that finds it by colour. If
that green is damaged, recoloured or covered, the asset is destroyed and
the output is worthless.

== WHAT TO ADD ==
Put the frame in a believable real setting: hung on a textured painted
wall, or standing on a wooden shelf, sideboard, mantelpiece or table.
Light it with soft directional daylight coming from one side, as if from
a window just out of frame. Add, in the same light direction:
  - the cast shadow of window panes, mullions or venetian blinds falling
    across the wall, the frame AND the green area
  - dappled shadows from leaves or a nearby houseplant
  - ambient occlusion where the frame meets the surface behind it
  - a soft contact shadow under or behind the frame
Keep the result photographic: real surface texture, natural colour,
shallow depth of field is fine.

== ABSOLUTE RULES ==
These are not preferences. Breaking any one of them makes the image
unusable, so re-check each before you output.

R1. NOTHING inside the green area. No photo, no picture, no artwork, no
    person, no landscape, no texture, no pattern, no gradient, no noise,
    no reflection, no glass glare, no highlight, no vignette, no logo,
    no text. It stays an empty flat block of colour. Do not "helpfully"
    fill it. Do not treat it as a canvas.

R2. The green area keeps EXACTLY the shape, size, position and corner
    geometry it has in the attached image, relative to the frame. Do not
    shrink it, grow it, round its corners, soften its edges, feather it,
    blur it or move it. Its boundary against the frame must stay crisp.

R3. Shadows MUST continue across the green area rather than stopping at
    the frame's inner edge - but inside shadow the green must stay GREEN
    and only get DARKER. Darker green is correct and expected. Grey,
    grey-green, olive, brown, black, blue-green, teal or desaturated
    green is WRONG. Never add warm or cool colour tints to it. The
    green's red and blue channels must remain near zero everywhere.

R4. Do not redraw, restyle, smooth, sharpen, simplify, embellish or
    reinterpret the frame's border artwork. Reproduce its exact
    silhouette, its scallops or carvings, its colours, its material and
    its fine detail pixel-for-pixel as far as possible. Do not change
    its thickness. Do not add or remove ornament. If you are unsure,
    copy rather than improve.

R5. Keep the ENTIRE frame visible and unobstructed. Do not crop any
    edge. Do not let a plant, leaf, vase, book, hand or any other object
    pass in front of the frame or overlap it. Objects may sit beside or
    behind it only. Shadows falling on it are fine; solid objects are
    not.

R6. Keep the frame's aspect ratio exactly. Do not stretch, squash, skew,
    rotate, tilt or apply perspective to it. Show it flat and square-on
    to the camera.

R7. Output exactly one image. No collage, no variants side by side, no
    frame-within-a-frame, no added border, no text, no caption, no
    watermark, no signature.

== SELF-CHECK BEFORE YOU ANSWER ==
Confirm all of these are true:
  1. Is the green area still completely empty?
  2. Is every green pixel still clearly green, even in deep shadow?
  3. Is the green area the same shape and proportion as the original?
  4. Is the border artwork unchanged?
  5. Is the whole frame visible, uncropped, square-on and unstretched?
  6. Do the shadows cross the green area instead of stopping at it?
If any answer is no, fix it and re-render before replying. If you cannot
satisfy all seven rules, say so in text instead of returning a broken
image.`;

function _ffPolyArea(pts) {
  let a = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) a += pts[j].x * pts[i].y - pts[i].x * pts[j].y;
  return Math.abs(a) / 2;
}
