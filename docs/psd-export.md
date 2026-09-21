# Photoshop PSD export

`Export ▾ · Photoshop PSD (.psd)` in the Studio. Implemented in
`js/20-psd-export.js`; verified by `npm run test:psd`.

## Why it exists

A native Canva frame clips a dropped image to a path. Canva cannot keystone
that image, so an opening photographed at an angle still looks flat once the
buyer drops artwork in. Photoshop can: a smart object carries a four-corner
transform, so the same opening reads as real perspective. The PSD export is
the deliverable for buyers who work in Photoshop, and the only place
FrameForge can offer perspective-correct artwork placement.

## What the file contains

```
FrameForge Mockup.psd            RGB, 8-bit, PackBits (RLE) compressed
├─ Mockup overlay                normal
├─ Shadow                        multiply, at the layer's own opacity
├─ YOUR DESIGN — double-click to replace   smart object, corner-pinned
├─ Scene                         image, shape and text layers, when present
└─ Background                    white, or omitted when transparent
```

Layers are written bottom-first, exactly as PSD stores them. A layer with no
visible pixels is not written at all. One smart object is written per visible
four-point opening, so a multi-opening mockup exports one replaceable layer
per opening.

The dialog asks for three things:

| Field | Values | Effect |
| --- | --- | --- |
| File name | text | `<name>.psd` |
| Background | `white` / `transparent` | A white `Background` layer, or a 4-channel document with no background layer |
| Placeholder art | `built-in` / `frame` | The built-in "YOUR DESIGN" card, or the artwork currently inside the frame |

## Buyer instructions to ship with the file

1. Open the PSD in Photoshop.
2. Double-click the **YOUR DESIGN** layer thumbnail. The embedded artwork
   opens in its own document.
3. Replace it with your own image, save (`Ctrl/Cmd+S`) and close.
4. The mockup updates, with the perspective, shadow and overlay intact.

Nothing has to be installed, and the file has no links to external assets:
the placeholder is embedded, so the PSD works offline and after being copied.

## Byte layout

Written in the order the format requires:

1. **Header** - `8BPS`, version 1, channel count (3, or 4 when transparent),
   height, width, 8-bit depth, colour mode 3 (RGB).
2. **Colour mode data** - empty for RGB.
3. **Image resources** - empty; Photoshop applies its defaults.
4. **Layer and mask information**
   - layer count, negative when the composite carries transparency;
   - one record per layer: bounds, channel list (`-1` alpha, then R, G, B),
     `8BIM` + blend key, opacity, clipping, flags;
   - per-layer extra data: a single-byte legacy name, `luni` for the exact
     Unicode name, and for a smart object `SoLd` and `PlLd`;
   - per-layer channel data, PackBits per scanline with the row byte counts
     each channel declares;
   - a document-level `lnk2` block holding every embedded smart-object file.
5. **Flattened composite** - PackBits, so any reader that ignores layers still
   shows the mockup.

Blend keys are Photoshop's own four characters: `norm`, `mul ` (with the
trailing space), `scrn`, `dark`, `lite`.

### Smart object

- `SoLd` holds an Adobe descriptor with `Idnt`/`placed` (the UUID that links
  the layer to its embedded file), `Trnf` and `nonAffineTransform` (the four
  opening corners as eight doubles), a `warpNone` warp, `Sz  ` and `Rslt`.
- `PlLd` repeats the identifier and the same eight doubles for readers that
  only understand the older block.
- `lnk2` holds one `liFD` item per smart object: the UUID, the file name,
  `PNGf`, the byte length and the PNG itself.

The layer's own pixels are the placeholder already warped through the opening,
so the mockup looks right even in a reader that ignores smart objects.

## Failure behaviour

| Situation | What happens |
| --- | --- |
| No visible four-point frame | `Create or select a frame first`, nothing is written |
| Opening cannot be corner-pinned (zero area, collapsed edge, non-finite point) | Exported as a pre-warped pixel layer, named as flattened, counted in the toast |
| Canvas over 12 MP | Warns that the build may take a moment, then proceeds |
| Canvas wider or taller than 30,000px | Refused: Photoshop cannot open it |
| Anything throws | Toast with the error; the rest of the Studio is unaffected |

## How it is tested

`tools/test-psd-export.mjs` lifts the pure core out of the bundle between the
`psd-core` markers and evaluates it in a bare Node VM, so no copy of the logic
lives in the test. Every document it builds is then parsed back out of the
bytes: header fields, layer order, blend keys, opacity, bounds, declared
channel lengths against the real data, Unicode names, the `SoLd` descriptor
keys, the corner transform to within 0.01, the `PlLd` doubles, the embedded
PNG signature and contents, the composite decoded back to its pixels, and a
PackBits round trip on random, run-heavy and single-byte data.

It also writes a real sample to the system temp directory and prints the path.
Byte-level checks cannot prove Photoshop is happy, so **open that sample once
after changing the writer**: the layers must appear with the right names and
the smart object must accept a double-click. During development the same file
was cross-checked with an independent PSD parser, which is how the `mult` vs
`mul ` blend key bug was caught before release.

## Deliberately out of scope

PSD import, layer effects, adjustment layers, CMYK, 16-bit, and externally
linked (non-embedded) smart objects. Keeping the writer small is what keeps
this feature isolated from the publishing path.
