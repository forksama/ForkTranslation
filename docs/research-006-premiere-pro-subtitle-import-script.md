# 调研档案 006：Premiere Pro 标记区间字幕导入脚本

- 档案编号：Research-006
- 建档日期：2026-07-14
- 状态：已落地脚本
- 脚本路径：`scripts/import-pr-subtitles-to-premiere.jsx`
- PR 2022 兼容性：可生成并导入 SRT，但不能自动创建字幕轨。

## 目标

在 Premiere Pro 当前激活的序列中，按时间轴 marker 区间导入 `pr-subtitles-D.json`：

- 运行脚本后弹窗选择 D JSON。
- 读取 `cues[].order` 与 `cues[].lines`。
- 第 1、2 个 marker 之间放 `order: 1` 的字幕；第 2、3 个 marker 之间放 `order: 2`；依此类推。
- 如果 marker 不够覆盖全部 cue，则只导入当前 marker 能覆盖的前 `marker 数 - 1` 条 cue。
- 支持分批导入：脚本会读取上次成功导入写出的状态文件，并询问“时间线上已经有多少条 cue”，随后从下一条 cue 开始继续生成 SRT。
- 通过生成临时 SRT，再用 Premiere 的 caption 导入接口创建 Subtitle 字幕轨。
- 在 PR 2022 这类没有 `sequence.createCaptionTrack()` 的版本中，脚本会退化为只生成 SRT 并导入项目面板，字幕轨需要手动从 SRT 创建。

## API 调研结论

Premiere ExtendScript 的关键可用接口：

- `app.project.activeSequence` 能取得当前激活序列。
- `sequence.markers.getFirstMarker()` / `getNextMarker()` 能按时间读取序列 marker。
- `marker.start.seconds` 能取得 marker 开始时间的秒数。
- `app.project.importFiles()` 能把生成的 `.srt` 导入项目面板。
- `sequence.createCaptionTrack(projectItem, 0, Sequence.CAPTION_FORMAT_SUBTITLE)` 能从 SRT 项目素材新建 Subtitle caption track。

关键限制：

- PR 2022 / v22.x 的 ExtendScript DOM 没有 `sequence.createCaptionTrack()`；脚本只能生成并导入 SRT，不能自动把 SRT 放成字幕轨。
- ExtendScript 没有稳定公开 API 用来删除 caption track。
- ExtendScript 也没有稳定公开 API 用来清空 caption track 内的字幕条目。
- ExtendScript 没有稳定公开 API 用来读取当前 caption track 里已有多少条字幕。
- UXP 的 `CaptionTrack` 当前能读轨信息、改轨名/静音，并能用 `getTrackItems()` 读取 track item，但 Adobe 社区 2025-07-30 的官方回复仍说明 caption property 的访问和修改 API 还在建设中，不能依赖它完成“清空字幕内容后重建”。
- Premiere Pro UXP 对 PR 2022 不适用。Adobe 的 UXP changelog 显示 Premiere Pro UXP 在 v25.2 才开始 Public Beta，v25.6 才发布 1.0，因此 PR 2022 无法通过 UXP 脚本弥补字幕导入 API。

因此当前脚本采取保守实现：自动生成并导入新 Subtitle 字幕轨；如果当前序列已有字幕轨，脚本不能直接检测或修改它，而是通过脚本自己的状态文件和用户确认来做分批导入。每次继续导入都会新增一条 Subtitle 字幕轨，不能把字幕追加进旧字幕轨。

在 PR 2022 中，最后一步需要手动完成：脚本生成并导入 SRT 后，在 Premiere 里用该 SRT 创建字幕轨。脚本会询问是否把状态推进到本次范围末尾；只有确认已经手动导入或准备按这个范围继续时才点 OK。

## 使用方式

1. 在 Premiere Pro 中打开项目，并激活要导入字幕的序列。
2. 在时间轴上打 marker。全量导入时，260 条 cue 需要 261 个 marker；分批导入时，有 80 个 marker 就会导入前 79 条 cue。
3. 如果要替换旧字幕轨，先在时间轴中手动删除旧字幕轨；如果要分批追加，可以保留旧字幕轨。
4. 运行 `scripts/import-pr-subtitles-to-premiere.jsx`。
5. 在文件选择弹窗中选择 `pr-subtitles-D.json`。
6. 脚本会询问已经导入的 cue 数。默认值来自同目录的 `*-premiere-state.json`；如果没有状态文件，默认是 `0`。
7. 脚本会在 JSON 同目录生成一个 `*-premiere-Cxxxx-Cyyyy-YYYYMMDD-HHMMSS.srt`，导入项目面板，并在支持的 PR 版本中创建 Subtitle 字幕轨。
8. 在 PR 2022 中，脚本会提示自动创建字幕轨不可用；需要手动用生成的 SRT 创建字幕轨。
9. 成功后脚本会更新同目录的 `*-premiere-state.json`，下次运行会默认从下一条 cue 继续。PR 2022 fallback 模式下，脚本会先询问是否推进状态。

## 输入校验

脚本会检查：

- JSON 必须包含 `cues` 数组。
- cue 的 `order` 必须从 1 连续递增到 `cues.length`。
- 每条 cue 必须有非空 `lines`、`line1`/`line2` 或 `text`。
- 当前序列 marker 数必须至少是 2。
- 被使用的相邻 marker 区间必须是正时长。
- 用户输入的“已导入 cue 数”必须是非负整数，不能超过当前 marker 能覆盖的 cue 数。

如果 marker 比需要的更多，脚本只使用前 `cue 数 + 1` 个 marker，并提示尾部多余 marker 会被忽略。如果 marker 不足，脚本只导入能由现有 marker 覆盖的 cue，并提示还剩多少 cue 未导入。

## 来源

- Premiere Pro Scripting Guide：`Sequence.createCaptionTrack()` 说明：<https://ppro-scripting.docsforadobe.dev/sequence/sequence/#sequencecreatecaptiontrack>
- Premiere Pro Scripting Guide：`MarkerCollection` 说明：<https://ppro-scripting.docsforadobe.dev/collection/markercollection/>
- Premiere Pro Scripting Guide：`Time.seconds` 说明：<https://ppro-scripting.docsforadobe.dev/other/time/>
- Premiere Pro Scripting Guide：`Project.importFiles()` 说明：<https://ppro-scripting.docsforadobe.dev/general/project/#projectimportfiles>
- Adobe Developer：UXP `CaptionTrack` 说明：<https://developer.adobe.com/premiere-pro/uxp/ppro-reference/classes/captiontrack>
- Adobe Developer：Premiere Pro UXP changelog：<https://developer.adobe.com/premiere-pro/uxp/ppro-changelog/>
- Adobe Community：Caption API 仍在建设中、尚无可用 caption property 修改 API 的官方回复：<https://community.adobe.com/questions-729/issue-accessing-caption-items-via-captiontrack-api-in-premiere-pro-uxp-scripting-1419037>
