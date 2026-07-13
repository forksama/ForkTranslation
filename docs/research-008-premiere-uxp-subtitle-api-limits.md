# 调研档案 008：Premiere UXP 字幕 API 边界

- 档案编号：Research-008
- 建档日期：2026-07-14
- 状态：已落地试验插件
- 试验插件路径：`scripts/premiere-uxp-pr-subtitles/`

## 结论

当前公开 Premiere UXP API 不能完整满足“自动创建/删除/清空/追加 Subtitle 字幕轨”的需求。

可做：

- 取得当前项目与激活序列。
- 读取 sequence marker。
- 读取 caption track 数量。
- 读取 caption track 内的 track items，从而估算当前已有字幕条数。
- 生成增量 SRT 并导入 Project panel。

不可做：

- 新建 Subtitle caption track。
- 删除已有 caption track。
- 清空 caption track 里的字幕条目。
- 向已有 caption track 追加字幕条目。

## 对本项目的实际影响

UXP 版脚本可以比 ExtendScript 多做一件重要的事：检测当前已有 caption item 数量。因此它可以自动决定“从第几条 cue 开始生成下一段 SRT”。

但它仍不能把这段 SRT 自动变成时间线里的 Subtitle track，也不能把新字幕追加到旧字幕轨里。当前插件只能生成并导入 SRT，最后的字幕轨创建仍需要人工操作，除非 Adobe 后续开放 caption track 创建与 caption item 写入 API。

## 依据

- UXP `Project.getActiveSequence()` 能取得激活序列。
- UXP `Markers.getMarkers(sequence)` 与 `markers.getMarkers()` 能读取 sequence markers。
- UXP `Sequence.getCaptionTrackCount()` / `getCaptionTrack()` 能读取 caption tracks。
- UXP `CaptionTrack.getTrackItems()` 能读取 track items。
- UXP `Project.importFiles()` 能导入生成的 SRT。
- 当前公开 `Sequence` 与 `CaptionTrack` 文档未列出 create caption track、delete caption track、clear caption items 或 append caption item 这类方法。

## 参考

- Premiere UXP API overview: <https://developer.adobe.com/premiere-pro/uxp/ppro-reference/>
- UXP `Sequence`: <https://developer.adobe.com/premiere-pro/uxp/ppro-reference/classes/sequence>
- UXP `CaptionTrack`: <https://developer.adobe.com/premiere-pro/uxp/ppro-reference/classes/captiontrack>
- UXP `Markers`: <https://developer.adobe.com/premiere-pro/uxp/ppro-reference/classes/markers>
- UXP `Project.importFiles()`: <https://developer.adobe.com/premiere-pro/uxp/ppro-reference/classes/project/#importfiles>
