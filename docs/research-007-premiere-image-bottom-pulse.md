# Research 007: Premiere Pro image bottom pulse script

- Date: 2026-07-14
- Status: prototype script landed
- Script: `scripts/apply-pr-image-bottom-pulse.jsx`

## Conclusion

Premiere Pro ExtendScript can automate this workflow for normal still-image clips:

- read the active sequence and iterate user-chosen video tracks;
- inspect each track's `clips`;
- identify still images by media path or clip-name extension;
- access each clip's intrinsic Motion component through `TrackItem.components`;
- keyframe Motion parameters through `ComponentParam`;
- assign Bezier interpolation to those keys.

The requested bottom-fixed visual is implemented by moving Motion Position to the
program frame's bottom center and Motion Anchor Point to the image's bottom
center, then animating only height scale from 105% to the original value over
0.15 seconds.

## API limits

The public scripting API exposes interpolation modes, including Bezier, through
`ComponentParam.setInterpolationTypeAtKey()`. It does not expose the same custom
Bezier handle editing available in Premiere's UI graph editor. Therefore the
script sets native Bezier interpolation on the two endpoint keyframes. If a more
mathematically exact inverse-like velocity curve is required, the practical
script-side approach is to add several intermediate scale keyframes sampled from
the target easing curve.

The API documentation also notes that component and parameter display names are
localized. The script searches by known names first and then falls back to value
shape/index heuristics for intrinsic Motion parameters.

## Sources

- Premiere Pro Scripting Guide: Sequence.videoTracks and frame size attributes: <https://ppro-scripting.docsforadobe.dev/sequence/sequence/>
- Premiere Pro Scripting Guide: Track.clips: <https://ppro-scripting.docsforadobe.dev/sequence/track/>
- Premiere Pro Scripting Guide: TrackItem.components, projectItem, start/end: <https://ppro-scripting.docsforadobe.dev/item/trackitem/>
- Premiere Pro Scripting Guide: Component and ComponentParam objects: <https://ppro-scripting.docsforadobe.dev/sequence/component/> and <https://ppro-scripting.docsforadobe.dev/sequence/componentparam/>
- Premiere Pro Scripting Guide: ProjectItem.getMediaPath(): <https://ppro-scripting.docsforadobe.dev/item/projectitem/>
- Premiere Pro Scripting Guide: Time ticks/seconds: <https://ppro-scripting.docsforadobe.dev/other/time/>
