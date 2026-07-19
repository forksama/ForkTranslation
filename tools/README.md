# Agent Tools

这里放主要给 agent 调用的本地辅助工具。它们服务于取片、审校、交叉检查和上下文整理，不作为用户日常工作流入口；人工或工作流也会直接调用的格式转换、素材处理脚本仍放在 `scripts/`。

新会话如果需要检查 A/B/C 三份文件的对应关系，应先读本文件，再按目标 thread 目录调用相应工具。

## thread-floor-review.js

按楼层或 post ID 抽取同一 thread 中 A、B、C 三份文件的对应内容，用于逐楼互审。

默认读取目标目录下的标准文件：

- `source-A.md`
- `translation-B.md`
- `pr-subtitles-C.md`

常用命令：

```powershell
node tools\thread-floor-review.js domains\gakumasu\threads\board-6197547-rinha-distance-close --floor 5
```

按范围或 post ID：

```powershell
node tools\thread-floor-review.js domains\gakumasu\threads\board-6197547-rinha-distance-close --floor 5-7
node tools\thread-floor-review.js domains\gakumasu\threads\board-6197547-rinha-distance-close --post P0005
```

给 agent 或其他脚本读取 JSON：

```powershell
node tools\thread-floor-review.js domains\gakumasu\threads\board-6197547-rinha-distance-close --floor 5 --json
```

输出会包含：

- A 中对应 `source-A.md` 楼层原文块。
- B 中对应 `translation-B.md` 译文块。
- C 中所有 `source` 指向该 post 的 cue。
- 轻量检查：A/B 日文是否对齐、C 中文是否来自 B、C 的 `ja-read` 是否能回到 A。
