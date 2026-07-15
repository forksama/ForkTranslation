# Premiere UXP Audio Prefix Importer

Development UXP panel for importing numbered WAV files into one empty Premiere
Pro audio track.

It expects file names like:

```text
1-audio.wav
99-audio.wav
```

The panel sorts matching files by the numeric prefix, imports them into the
Project panel, places them on the target audio track starting at the active
sequence playhead, leaves the configured gap after each clip, and creates
sequence markers:

- one marker at the start of each imported audio clip;
- one final marker at the end of the last audio clip plus the same gap value.

## Load

1. Open Premiere Pro 25.6 or newer.
2. Enable Developer Mode in Premiere Pro preferences and restart Premiere.
3. Open Adobe UXP Developer Tool.
4. Add this plugin manifest:
   `scripts/premiere-uxp-audio-prefix-importer/manifest.json`
5. Load the plugin, then open the panel named `Audio Prefix Importer`.

## Use

1. Activate the target Premiere sequence.
2. Move the sequence playhead to the desired start time for the first audio
   file.
3. Choose the folder containing `number-*.wav` files.
4. Set `Gap seconds`, such as `0`, `0.25`, or `1.5`.
5. Choose `Target audio track`:
   - `new`: create/use the next audio track.
   - `auto`: use the first existing audio track with no clip items, or create
     the next track if none are empty.
6. Click `Import To Track`.

The panel does not remove or replace existing clips.

## Notes

- Only files in the selected folder itself are scanned; subfolders are ignored.
- Only `.wav` files matching `number-*.wav` are imported.
- Duplicate numeric prefixes are allowed and are ordered by file name within
  the same prefix.
- Existing sequence markers are left untouched.
- Inserting onto a newly requested track relies on Premiere UXP
  `SequenceEditor.createInsertProjectItemAction`, which creates the target
  track when the supplied audio track index is the next track after the current
  last track.
