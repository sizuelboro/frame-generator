# Export for Pixopik

`Export for Pixopik` (toolbar, or `Export ▾`) turns the current design into
one frame for Pixopik's library (Elements → Frames). Code:
`js/23-pixopik-export.js`. Limits: `shared/frameforge-limits.js`.

## What Pixopik expects

A frame in Pixopik is a `FrameDef` (`src/lib/frameShapes.ts` in the Pixopik
repo). Frames exported from here go in `src/lib/customFrames.ts`:

```ts
{
  id: "puffy-crayon",          // also the file name
  label: "Puffy Crayon",       // shown in Elements → Frames
  group: "flowers",            // one of Pixopik's FRAME_GROUPS
  keywords: "crayon kids",     // frame search
  aspect: 1,                   // width / height of the overlay
  overlay: "png",              // public/frames/<id>.png
  clip: [[0.18, 0.21], ...],   // the opening, 0-1 of the frame's box
},
```

Pixopik draws the overlay stretched over the frame's whole box, so the box
*is* the overlay image and `aspect` is its width over height. `clip` becomes
a `SiteFrame.clip` path of integers in a 0-1000 box, and Pixopik's
`isFrameClip` rejects anything with more than 400 points or 6000 characters.

## What the export does

1. **Artwork.** Overlay, shadow, image, text and shape layers are rendered on
   a transparent background. Openings and any preview photo inside them are
   not artwork and never end up in the PNG.
2. **Crop.** The crop box is the union of the artwork's visible pixels
   (alpha above 3) and the opening, so no `Trim canvas` is needed.
3. **Opening.** The chosen opening gets Auto bleed exactly as `Export overlay
   PNG` applies it, is mapped into 0-1 of the crop, snapped to the 0-1000
   grid and, only when it has more than 400 points, simplified with
   Douglas-Peucker. The tolerance starts at half a grid step and grows, so an
   opening already within the limit is kept point for point.
4. **Checks.** The same regex as `isFrameClip`, plus: a name, a valid id that
   is not a built-in Pixopik id, a non-degenerate opening. Any failure keeps
   `Export` disabled and says why. Warnings (large PNG, tiny opening, several
   openings) do not block.
5. **Files.** `<id>.png` and `<id>.frame.txt` (the entry with instructions).
   `Copy entry` puts the entry on the clipboard instead.

A design with an opening but no artwork exports as a plain cut-out frame: an
entry without `overlay` and no PNG.

## Options

| Option | Notes |
| --- | --- |
| Name | Prefilled from the style and shape (Generate) or the artwork's layer name (From image) |
| ID | Follows the name until edited by hand |
| Group | Remembered between exports |
| Opening | Shown only with more than one opening. Largest first. A Pixopik frame holds one opening; the others stay see-through |
| Quality | Longest side of the PNG: 1000, 1600 or 2400 px. The whole canvas is rendered before cropping and capped at 8192 px on its long side, so a huge canvas can come out smaller; the checks say so |

## In Pixopik

1. Copy `<id>.png` to `public/frames/`.
2. Paste the entry into `CUSTOM_FRAMES` in `src/lib/customFrames.ts`.
3. Run `node --test tests/site-elements/custom-frames.test.mjs`: it checks
   the id, group, clip and that the PNG is there.

## Keeping the two repos in step

`FF_PIXOPIK_GROUPS` and `FF_PIXOPIK_BUILTIN_IDS` mirror Pixopik's
`FRAME_GROUPS` and `FRAMES`, and the three `PIXOPIK_*` limits mirror
`isFrameClip`. If Pixopik changes any of them, change them here too.
