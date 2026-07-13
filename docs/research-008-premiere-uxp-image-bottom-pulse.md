# Research 008: Premiere UXP image bottom pulse

- Date: 2026-07-14
- Status: UXP prototype panel landed
- Plugin path: `scripts/premiere-uxp-image-bottom-pulse/`

## Conclusion

UXP can target the same intrinsic Motion parameters as ExtendScript, but the
write model is different. UXP creates `Action` objects and commits them with
`Project.executeTransaction()`. The prototype uses:

- `Project.getActiveProject()` and `project.getActiveSequence()`;
- `sequence.getVideoTrackCount()` and `sequence.getVideoTrack(index)`;
- `track.getTrackItems(Constants.TrackItemType.CLIP, false)`;
- `clip.getComponentChain()` and `chain.getComponentAtIndex(1)` for Motion;
- Motion params by index: Position `0`, Scale Height `1`, Scale Width `2`,
  Uniform Scale `3`, Anchor Point `5`;
- `ComponentParam.createKeyframe()`, `createAddKeyframeAction()`,
  `createSetTimeVaryingAction()`, `createRemoveKeyframeRangeAction()`, and
  `createSetInterpolationAtKeyframeAction()`.
- sampled intermediate Scale Height keyframes to approximate a requested
  cubic-bezier velocity curve, because UXP does not expose graph-editor handles.

This should be more reliable than the ExtendScript version because the changes
are submitted through Premiere's undoable action transaction path.

## Limitation

UXP exposes Bezier interpolation mode for keyframes, but the public API and
`@adobe/premierepro@26.3.0` type definitions do not expose custom temporal
Bezier handles. The panel therefore samples the requested cubic-bezier curve into
multiple Scale Height keyframes. The default `0.19,1,0.22,1` curve gives a
strong fast-out / slow-end recovery.

## Sources

- Adobe Premiere UXP `ComponentParam`: <https://developer.adobe.com/premiere-pro/uxp/ppro-reference/classes/componentparam>
- Adobe Premiere UXP `Project`: <https://developer.adobe.com/premiere-pro/uxp/ppro-reference/classes/project>
- Adobe Premiere UXP `Sequence`: <https://developer.adobe.com/premiere-pro/uxp/ppro-reference/classes/sequence>
- Adobe Premiere UXP manifest: <https://developer.adobe.com/premiere-pro/uxp/plugins/concepts/manifest/>
- Adobe Premiere UXP code samples manifest: <https://github.com/AdobeDocs/uxp-premiere-pro-code-samples/blob/main/metadata/manifest.json>
- Adobe `@adobe/premierepro` type package: version `26.3.0`
