# Plan 010: Voice Portrait Mapping Git Workflow

- Date: 2026-07-15
- Status: planned
- Scope: per-thread voice generation, portrait mapping, Git sync, and Premiere UXP import

## Background

The current ForkTranslation workflow produces per-thread A/B/C/D artifacts, then
uses B and C/D to generate voice and Premiere subtitles. Voice generation happens
on machine A, while Premiere Pro assembly happens on machine B.

The main bottleneck is portrait selection. While generating GPT-SoVITS voice, the
operator already decides the reference voice and emotion, which is also the best
moment to choose the matching standing portrait. If portrait selection is delayed
until Premiere work on machine B, the operator often has to reread or relisten to
the whole context.

The chosen direction is to make each `domains/gakumasu/threads/board-xxxx/`
directory a complete git-managed work package. Machine A writes generated voice
files and voice-to-portrait mappings into the same thread directory. Machine B
pulls the repository, opens the matching Premiere project, and runs a UXP plugin
that reads the mapping and lays portraits onto a new video track by matching
audio clip file names.

## Repository Decision

Thread directories are tracked by git. They are no longer local-only drafting
artifacts.

This is intentional because voice generation depends on the B translation and
C/D subtitle artifacts, and Premiere assembly depends on the generated voice
files and mapping file. Git push/pull becomes the handoff mechanism between
machine A and machine B.

Binary media is handled by Git LFS. This repository already tracks these common
media types through `.gitattributes`:

- `*.wav`
- `*.png`
- `*.jpg`
- `*.jpeg`
- `*.webp`
- `*.mp4`

Machine A and machine B should both have Git LFS installed and initialized before
pulling or pushing media-heavy commits.

## Thread Directory Layout

Use this layout inside each thread:

```text
domains/gakumasu/threads/board-xxxx-short-title/
  source-A.md
  context-pack.md
  translation-B.md
  pr-subtitles-C.md
  pr-subtitles-D.json
  review-notes.md
  final.md
  media/
    voice/
      audio/
        0001-saki.wav
        0002-p.wav
        0003-saki.wav
      voice-portrait-map.json
```

Optional generated logs can also live under `media/voice/logs/` if they are
useful for debugging or reproducibility.

## Path Rules

The mapping file uses two path bases:

- Audio files are relative to the current thread directory.
- Portrait files are relative to the ForkTranslation repository root.

This avoids absolute paths and keeps the workflow portable across machines.

Premiere timeline matching should use `audioFileName`, not an absolute audio
path, because Premiere on machine B may not preserve machine A paths. The
relative `audioRelPath` is still recorded so the UXP plugin can validate that the
expected audio exists in the checked-out thread package.

## Mapping Schema

Use `media/voice/voice-portrait-map.json`:

```json
{
  "schemaVersion": 1,
  "threadPathBase": "thread",
  "portraitPathBase": "repo",
  "items": [
    {
      "order": 1,
      "audioFileName": "0001-saki.wav",
      "audioRelPath": "media/voice/audio/0001-saki.wav",
      "portraitRelPath": "怪文书素材/1.立绘/1-咲季立绘.1/开心.png",
      "role": "咲季",
      "engine": "gpt-sovits",
      "text": "B 中对应句子"
    }
  ]
}
```

Required fields:

- `order`: the B sentence order, starting from 1.
- `audioFileName`: the exact file name used for Premiere clip matching.
- `audioRelPath`: thread-relative audio file path.
- `portraitRelPath`: repository-root-relative portrait image path.
- `role`: speaker or role name.
- `engine`: `gpt-sovits` or `voicevox`.
- `text`: the B sentence used to generate the voice.

Recommended uniqueness rules:

- `order` must be unique inside one mapping file.
- `audioFileName` must be unique inside one mapping file.
- Audio file names should use a zero-padded numeric prefix, such as
  `0001-saki.wav`.

Append/update behavior:

- If an item with the same `order` already exists, update that item.
- If an item with the same `audioFileName` already exists, warn before replacing
  it unless it is the same `order`.
- Keep the array sorted by `order` after writing.

## Machine A Plan

Machine A owns voice generation.

GPT-SoVITS rough change:

- Add a portrait selector near the reference voice/emotion controls.
- Let the user choose whether mapping writes append to the current mapping file
  or creates a new mapping file for the current batch.
- Do not prompt for the mapping mode on every download.
- When a voice file is successfully generated, write or update one mapping item.

VOICEVOX rough change:

- Add one portrait selector per batch row, next to the text or speaker row.
- If all rows for the current role have no portrait yet, the first selected
  portrait fills all unset rows for that role.
- During batch export, write mapping items only for successfully generated audio
  files.

Both tools should write audio to:

```text
domains/gakumasu/threads/board-xxxx-short-title/media/voice/audio/
```

Both tools should write mapping to:

```text
domains/gakumasu/threads/board-xxxx-short-title/media/voice/voice-portrait-map.json
```

## Machine B Plan

Machine B owns Premiere Pro assembly.

The new Premiere UXP plugin should:

1. Let the user choose `voice-portrait-map.json`.
2. Infer the thread root from the mapping file path.
3. Let the user choose the ForkTranslation repository root if it cannot infer it.
4. Let the user choose the source audio track in the active sequence.
5. Read audio clips on that track and match each clip by basename against
   `audioFileName`.
6. Validate that every matched mapping item has an existing `portraitRelPath`.
7. Import unique portrait images into the Project panel.
8. Create or choose a target video track.
9. Place each portrait clip at the matched audio clip start time.
10. Trim each portrait clip to the matched audio clip end time.
11. Report unmatched audio clips, unused mapping rows, missing portrait files,
    and duplicate file names.

After the placement plugin is stable, merge or reuse the existing image bottom
pulse logic so one action can place portraits and apply the bounce animation.

## Git Workflow

Initial setup on each machine:

```powershell
git lfs install
git lfs pull
```

Machine A handoff:

```powershell
git status
git add domains/gakumasu/threads/board-xxxx-short-title
git commit -m "Add board xxxx voice media and portrait map"
git push
```

Machine B receive:

```powershell
git pull
git lfs pull
```

Before machine B starts Premiere work, confirm that the expected `.wav` files are
real media files rather than Git LFS pointer files. If they are pointers, run
`git lfs pull` again.

## Implementation Phases

1. Repository preparation
   - Track thread directories in git.
   - Keep media files under Git LFS.
   - Document this workflow.

2. Machine A tool changes
   - Add portrait selection and mapping writes to GPT-SoVITS.
   - Add batch portrait selection and mapping writes to VOICEVOX.
   - Use the shared mapping schema.

3. Machine B UXP MVP
   - Read mapping JSON.
   - Match existing audio clips by file name.
   - Import and place portraits into a new video track.
   - Trim portrait clips to audio clip boundaries.

4. Machine B UXP polish
   - Add validation summary and saved logs.
   - Add duplicate/missing-file diagnostics.
   - Combine placement with the existing bottom-pulse animation flow.

5. End-to-end verification
   - Test one GPT-SoVITS idol line.
   - Test one VOICEVOX non-idol line.
   - Test repeated speaker lines with different portraits.
   - Test missing portrait and duplicate file name diagnostics.
   - Test push from machine A and pull on machine B.
