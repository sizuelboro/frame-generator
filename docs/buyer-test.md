# Buyer compatibility test

Automated tests (`npm test`) cover the code. They cannot cover Canva
account-bound behaviour. Run this checklist on a disposable copy of the final
template before making any compatibility promise.

## Seller account

- [ ] Add the mockup from the FrameForge panel.
- [ ] Ungroup if needed; lock only the overlay PNG.
- [ ] Leave the drop-target frame unlocked.
- [ ] Drop an uploaded photo onto the opening.
- [ ] Double-click and confirm crop/zoom/reposition controls.
- [ ] Use Replace and confirm the new photo stays clipped.
- [ ] Save, close and reopen the design.
- [ ] Create the template link.
- [ ] Stop any local app server before buyer testing.

## Separate buyer account

- [ ] Open the template link without installing FrameForge.
- [ ] Create a new design from the template.
- [ ] Drop an uploaded photo onto the opening.
- [ ] Double-click and adjust crop/zoom/reposition.
- [ ] Replace the image.
- [ ] Download a PNG and inspect the clipped edges.
- [ ] Close and reopen the buyer's design.
- [ ] Repeat on Canva Free if that is part of the sales promise.
- [ ] Repeat on mobile if mobile compatibility will be advertised.

## Frames with enclosed holes

- [ ] Confirm no warning badge appears in the panel, or that the reported
      hole count is acceptable.
- [ ] Insert and confirm each hole is genuinely see-through.
- [ ] If holes must be exact, republish as Smart Mask instead.

## Pass condition

Advertise "works like a Canva frame" only if every promised account and
device scenario passes. Record the date, browser or app version, Canva plan,
and a short screen recording as evidence.
