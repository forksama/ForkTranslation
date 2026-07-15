# ForkTranslation PR Subtitles UXP

This is a Premiere Pro UXP panel for the PR subtitle workflow.

It can:

- choose a `pr-subtitles-D.json` file;
- read the active sequence markers;
- generate one SRT per cue role and import those SRTs into the Project panel.

It cannot currently:

- create a Subtitle caption track;
- delete an existing caption track;
- clear caption items from an existing track;
- append new caption items to an existing track.

Those operations are not exposed in the current public Premiere UXP API. The
plugin therefore stops at generating and importing role-split SRT files.

## Load

1. Open Adobe UXP Developer Tool.
2. Make sure Premiere Pro 25.6 or newer is running.
3. Enable Developer Mode in both UXP Developer Tool and Premiere Pro.
4. Restart Premiere after enabling Developer Mode in Premiere.
5. Add this folder as a plugin:
   `scripts/premiere-uxp-pr-subtitles`
6. Load the plugin into Premiere Pro 25.6 or newer.
7. Open the panel named `PR Subtitles`.

## Use

1. Click `Choose Subtitle JSON` and select a `pr-subtitles-D.json` file.
2. Click `Choose Output Folder` and select the generated SRT destination.
3. Activate the Premiere sequence whose markers define subtitle intervals.
4. Click `Generate SRTs`.

The original `ForkTranslation: Generate Role Subtitle SRTs` command remains
available and uses the same generation logic with file-picker dialogs.

It groups cues by `role`, writes one SRT per role, keeps the original sequence
timecodes from the marker intervals, and imports all generated SRT files into
the Project panel. Create one Subtitle track from each SRT manually, then apply
the matching Track Style to each track.

If UDT says `No applications are connected to the service`, Premiere has not
connected to UDT yet. Check the Premiere version, Developer Mode, and whether
UDT is running with administrator privileges.

The plugin will save an SRT such as:

```text
pr-subtitles-D-role-旁白-C0001-C0255-20260714-153000.srt
```

Create the Subtitle track from that SRT manually unless Adobe adds public UXP
APIs for caption-track creation and caption-item editing.
