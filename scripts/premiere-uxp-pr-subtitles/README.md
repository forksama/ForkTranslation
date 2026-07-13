# ForkTranslation PR Subtitles UXP

This is a Premiere Pro UXP experiment for the PR subtitle workflow.

It can:

- choose a `pr-subtitles-D.json` file;
- read the active sequence markers;
- read existing caption track count and caption item count;
- generate only the next missing cue range when markers are incomplete;
- save a ranged SRT file;
- import that SRT into the Project panel.

It cannot currently:

- create a Subtitle caption track;
- delete an existing caption track;
- clear caption items from an existing track;
- append new caption items to an existing track.

Those operations are not exposed in the current public Premiere UXP API. The
plugin therefore uses the existing caption item count only to decide which cue
range to generate next.

## Install For Testing

1. Open Adobe UXP Developer Tool.
2. Make sure Premiere Pro 25.6 or newer is running.
3. Enable Developer Mode in both UXP Developer Tool and Premiere Pro.
4. Restart Premiere after enabling Developer Mode in Premiere.
5. Add this folder as a plugin:
   `scripts/premiere-uxp-pr-subtitles`
6. Load the plugin into Premiere Pro 25.6 or newer.
7. In Premiere, run:
   `ForkTranslation: Generate Incremental Subtitle SRT`

If UDT says `No applications are connected to the service`, Premiere has not
connected to UDT yet. Check the Premiere version, Developer Mode, and whether
UDT is running with administrator privileges.

The plugin will save an SRT such as:

```text
pr-subtitles-D-premiere-C0080-C0119-20260714-153000.srt
```

Create the Subtitle track from that SRT manually unless Adobe adds public UXP
APIs for caption-track creation and caption-item editing.
