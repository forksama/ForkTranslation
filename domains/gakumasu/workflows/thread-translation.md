# 学马仕论坛串翻译流程

本流程规定 `domains/gakumasu/threads/board-<boardId>-<short>/` 下的工作包如何创建、检查和交付。语言风格、称呼、口吻规则仍以 [`../stable/style-guide.md`](../stable/style-guide.md) 为准。

## 产物结构

```text
threads/board-<boardId>-<short>/
  source-A.md          # 标准输入，来自油猴脚本或人工整理
  context-pack.md      # 本串专用上下文、临时称呼、补充背景
  translation-B.md     # 完整译文，审校用
  pr-subtitles-C.md    # 人工可读字幕 cue 草稿
  pr-subtitles-D.json  # 转换脚本生成的 Premiere 工具输入
  review-notes.md      # 审校、命令、警告、残余风险
  final.md             # 定稿摘要
```

外部抓取目录、图源目录或临时目录只能作为输入来源。交付前必须确认 A/B/C/D 和审校记录已经落在 thread 目录里。

## 执行顺序

1. 读取 `domains/gakumasu/README.md`，按本串命中内容加载稳定知识。
2. 建立或确认 thread 目录，放入 `source-A.md`。
3. 写 `context-pack.md`，记录本串加载了哪些 stable 文件、命中哪些术语、有哪些临时称呼或疑点。
4. 先完成 `translation-B.md`。B 是审校版，必须保留完整译文和逐句日文原文。
5. 通读 B，修正日语腔、漏译、口吻漂移和术语冲突。
6. B 定稿后再生成 `pr-subtitles-C.md`。C 只能做字幕节奏切分、换行和角色拆分，不再改写 B 的中文译文。
7. 运行 `scripts/convert-pr-subtitles.js` 生成 `pr-subtitles-D.json`。
8. 把命令、警告和人工判断写进 `review-notes.md`，最终状态写进 `final.md`。

## B 格式

B 以中文译句为主，每个译句下一行紧跟对应日语原文。推荐固定前缀：

```markdown
译：去年解散的中等部顶级组合 SyngUp!，她就是队长贺阳燐羽。
原：去年解散した中等部トップユニットSyngUp!、そのリーダーが賀陽燐羽だ。
```

- 一句中文译文对应多个日语短句时，`原：` 行可以收纳完整对应原文。
- 一个日语长句拆成多句中文时，每句中文后仍要放对应的日语片段。
- `备注` 可以插在对应译句组之后，但不能打断 `译：` 与下一行 `原：` 的相邻关系。

## C 格式

C 使用标题 + 正文行的 Markdown cue。默认每 cue 1 行，最多 2 行；每行 15-20 个中文字符是舒适区，不是压缩译文的硬指标。

````markdown
## C0001 | 旁白 | P0001
去年解散的中等部顶级组合 SyngUp!，
她就是队长贺阳燐羽。

```ja-read
去年解散した中等部トップユニットSyngUp!、そのリーダーが賀陽燐羽だ。
```
````

- 标题格式为 `## <cue_id> | <role> | <source>`。
- `source` 指向 A/B 中可追溯的位置，如 `P0001`、`thread.title`。
- 同一 cue 内不混入多个角色；需要换角色时必须拆成新 cue。
- `ja-read` / `jp-read` / `read-ja` fenced block 是强制审校信息，必须放在对应 cue 的中文字幕行之后、下一个 cue 标题之前。
- `ja-read` 内的日语必须从 A 或 B 的 `原：` 行逐字复制对应朗读片段，不改字、不统一标点、不补省略号。

## D 转换

当前转换脚本：

```powershell
node scripts\convert-pr-subtitles.js domains\gakumasu\threads\board-xxx\pr-subtitles-C.md `
  --source-a domains\gakumasu\threads\board-xxx\source-A.md `
  --translation-b domains\gakumasu\threads\board-xxx\translation-B.md
```

默认输出同目录 `pr-subtitles-D.json`。D 的 schema 固定为 `fork-pr-subtitles-d/v1`，由脚本生成，agent 不手写。

除了字幕字段，D 还会保留每个 cue 提取出的日语原文：

- `jaText`：从 `ja-read` / `jp-read` / `read-ja` block 提取并拼接的日语文本，供语音工具读取。
- `jaBlocks`：原始日语 block 数组，供调试和回查。

转换脚本会校验 cue 标题、cue 顺序、角色/source 非空、`ja-read` 是否存在、字幕行数、来源引用和 B 覆盖情况。行长偏离通常是 warning；格式错误和缺失 `ja-read` 是 error。

## 审校清单

- A 中每个应翻译楼层都在 B 中出现。
- B 的每句中文都能回看 A 的日文依据。
- C 的中文字幕逐字来自 B 的译文，没有同义改写、删减、压缩或补写。
- C 的 `ja-read` 逐字来自 A 或 B 的 `原：` 行。
- 角色 role、称呼和术语符合 `stable/`。
- 生成 D 后重新检查最终产物路径，不把结果遗留在外部源目录。
