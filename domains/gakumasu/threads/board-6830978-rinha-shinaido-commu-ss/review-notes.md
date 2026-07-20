# Review Notes

## Completed

- Copied source A into this thread directory via userscript export.
- Built `context-pack.md` with loaded stable context, active translation decisions, and story-specific style notes.
- Translated all 34 posts (thread.title + P0001–P0034) into `translation-B.md` by checkpoint, ~1000–2000 CN characters at a time.
- Reviewed B for natural Chinese phrasing after each checkpoint per user's process rule; refined wording (e.g. `嗓子` over `喉咙`, `范式` for `型`, `容器` for `器`, sharper Rinha lines like `声音又粗又涩`, `毫无保留地释放出来`).
- Generated `pr-subtitles-C.md` from finalized B text, checkpoint-by-checkpoint (3–5 posts per pass), running `tools/thread-floor-review.js` after each pass per user's C-phase workflow requirement.
- Added required `ja-read` blocks to every cue; all Japanese fragments copied verbatim from A/B `原：` lines (full-width `？`, `！` preserved).
- Post-C review pass to enforce style-guide §9.3: split 25 three-line cues into 2 cues each, re-lined 3 single-line cues over 25 chars, further split 1 cue where both lines were over 20 chars.
- Ran `scripts/convert-pr-subtitles.js` to produce `pr-subtitles-D.json`.

## Verification

- Floor-review command:

```cmd
node tools\thread-floor-review.js domains\gakumasu\threads\board-6830978-rinha-shinaido-commu-ss --floor 2-58
```

- Result: 34 `c-translation-match` + 34 `c-ja-match` info records across all posts. No `c-translation-mismatch`, `c-ja-mismatch`, or `c-missing`. 23 `target-missing` warnings are expected — the source only has posts on specific floors (2–11, 14–16, 22–23, 26–27, 29–32, 45–50, 52–58), not every floor number in the range.

- Converter command:

```cmd
node scripts\convert-pr-subtitles.js domains\gakumasu\threads\board-6830978-rinha-shinaido-commu-ss\pr-subtitles-C.md --source-a domains\gakumasu\threads\board-6830978-rinha-shinaido-commu-ss\source-A.md --translation-b domains\gakumasu\threads\board-6830978-rinha-shinaido-commu-ss\translation-B.md
```

- Result: `993` cues written to `pr-subtitles-D.json`.
- Errors: none.
- Warnings:
  - Line-length warnings from the converter's 15-20 character soft target. 46 lines are 21–25 chars (still under the hard cap); no line exceeds 25 chars.
  - `embedded-speaker` false positives on cues where `「一番星」`, `「稳定感」`, `「万能之器」`, `『赛马燐羽』` etc. appear as quoted terms in narration — not unsplit speaker cues.

## Review Points

- Source has explicit speaker labels (`学P「」`, `燐羽「」`, `あさり先生「」`, `手毬「」`, `美鈴「」`, `『アナウンス』`), all mapped to C `role`s: `学P`, `燐羽`, `亚纱里老师`, `手毬`, `美铃`, `广播`. Narration prose → `旁白`.
- Per stable/style-guide, `賀陽さん` in narration and 学P dialogue → `贺阳同学`; subtitle role for Rinha → `燐羽`.
- `SyngUp!`, `一番星` preserved per stable translation decisions. `プリマステラ` → `一番星` in this thread per user's P0020 edit. `優勝ライブ` → `优胜LIVE` in this thread.
- `根緒亜紗里` → `根绪亚纱里`, `あさり先生` → `亚纱里老师`, `プロデューサーくん` in Asari dialogue → `制作人同学`.
- This is a fan-created scouting/亲爱度剧情 route (route: 学P × 贺阳燐羽), not official剧情. See `context-pack.md` for the parallel-worldline framing per `[[project-p-idol-parallel-worldlines]]`.
- User B-review preferences captured through P0012 and P0023 (see `context-pack.md` Story-Specific Notes): concrete Chinese phrasing for body/training prose, sharper self-negation endings, `容器` for empty-but-absorbent `器`, natural pressure/release rhythm in stage prose.
- C-phase workflow instituted this session: checkpoint every ~3–5 posts and run `tools/thread-floor-review.js` to catch drift early. Feedback saved as `[[feedback-c-phase-floor-review-checkpoint]]` for future threads.
