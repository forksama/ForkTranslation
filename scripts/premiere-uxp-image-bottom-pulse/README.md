# Premiere UXP Image Bottom Pulse

Development UXP panel for applying a bottom-anchored height pulse to image clips
on selected Premiere Pro video tracks.

## Load

1. Open Premiere Pro 2026 or a version with UXP plugin support.
2. Enable Developer Mode in Premiere Pro preferences and restart Premiere.
3. Open Adobe UXP Developer Tool.
4. Add this plugin manifest:
   `scripts/premiere-uxp-image-bottom-pulse/manifest.json`
5. Load the plugin, then open the panel named `Image Bottom Pulse`.

## Use

- `Video tracks`: `1`, `1,3`, `1-3`, or `all`.
- `Start height`: default `1.035`, meaning 103.5% of the base height.
- `Pulse duration (s)`: the first N seconds of the clip used for the height
  pulse. Default `0.5`; supports decimals such as `0.15`, `0.5`, or `1.25`. Longer values
  stretch the same fast-out / slow-end rate curve, so the bounce slows down.
- `Base scale %`: blank means auto; enter `100` to force `105 -> 100`.
- `Rate curve`: cubic-bezier control points as `x1,y1,x2,y2`. The default
  `0.19,1,0.22,1` is a strong fast-out / slow-end pulse curve.
- `Curve samples`: how many segments to use when approximating the curve with
  real keyframes. Default `8` creates 9 Scale Height keyframes.

The panel writes Motion parameters through UXP actions inside a project
transaction:

- Position: bottom center
- Anchor Point: bottom center
- Uniform Scale: off
- Scale Width: preserved
- Scale Height keys: sampled from the rate curve between
  `0s = base * multiplier` and `pulse duration = base`

UXP exposes Bezier interpolation mode, but not graph-editor Bezier handles. The
panel approximates the requested velocity curve by sampling the cubic-bezier
curve into multiple Scale Height keyframes.
