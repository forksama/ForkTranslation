# Review Notes

## Completed

- Copied source A from the external image/source directory into this thread directory.
- Built `context-pack.md` with stable context and local decisions.
- Translated all 15 selected posts into `translation-B.md`.
- Reviewed B once for natural Chinese phrasing and fixed mechanical `プロデュース` renderings.
- Generated `pr-subtitles-C.md` from finalized B text.
- Added required `ja-read` blocks to every cue in `pr-subtitles-C.md`.
- Ran `scripts/convert-pr-subtitles.js` to produce `pr-subtitles-D.json`.

## Verification

- Converter command:

```powershell
node scripts\convert-pr-subtitles.js domains\gakumasu\threads\board-5276402-kayo-rinha-retirement-live\pr-subtitles-C.md --source-a domains\gakumasu\threads\board-5276402-kayo-rinha-retirement-live\source-A.md --translation-b domains\gakumasu\threads\board-5276402-kayo-rinha-retirement-live\translation-B.md
```

- Result: `255` cues written to `pr-subtitles-D.json`.
- Errors: none.
- Warnings: line-length warnings from the script's 15-20 character soft target, plus two false-positive embedded-speaker warnings:
  - `被学园长一句「拜托了」...`
  - `以「如果现在实装的话」为前提...`

## Review Points

- This is a fan-created "what if" route for `学P × 贺阳燐羽`, not official剧情.
- `はみ出し` in P0015 is translated as `越界` to preserve the euphemistic fanfic/dice tone without over-explaining.
- `小さな野望が宿っていた` is translated as `小小的野望已经寄宿其中`; the original implication is intentionally left ambiguous.
- `Campus mode！！` is normalized in translation to `『Campus mode!!』`; source text remains unchanged in `原：` / `ja-read`.
- `NIA` is translated as `N.I.A` per glossary.
