# Native Canva frame optimizer

- Native drop-zone output only; no automatic Smart Mask fallback.
- Official combined safe path budget: 1980 UTF-8 bytes.
- Relative integer coordinates are derived from quantized absolute points.
- Encoder selects compact l/h/v commands and removes optional separators.
- Simplifier strongly protects concave notches and inner contours.
- Publish is blocked if combined native path data exceeds the safe budget.
