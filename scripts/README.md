# Scripts

仓库级辅助脚本说明。

## convert-pr-subtitles.js

字幕流程里的 C -> D 转换脚本。它读取 `pr-subtitles-C.md`，校验 cue 顺序、角色、来源引用和 `ja-read` 审校块，然后输出给 Premiere 工具读取的 `pr-subtitles-D.json`。同时会把 `ja-read` 提取成 D 内的 `jaText` / `jaBlocks`，供后续语音工具读取。

这个脚本不由 UXP 插件直接调用；通常由 agent 或人工在生成/审校 C 后运行：

```powershell
node scripts\convert-pr-subtitles.js domains\gakumasu\threads\board-xxx\pr-subtitles-C.md `
  --source-a domains\gakumasu\threads\board-xxx\source-A.md `
  --translation-b domains\gakumasu\threads\board-xxx\translation-B.md
```

## premiere-uxp-workflow-panel/

Premiere Pro UXP 工作流面板。现役面板集中承载音频导入、立绘映射导入、字幕 SRT 生成、时间线计划、轨道模板克隆和图片底部脉冲等功能。旧的分散 JSX 脚本和独立 UXP 试验插件已被删除或并入此面板。

入口文档：[premiere-uxp-workflow-panel/README.md](premiere-uxp-workflow-panel/README.md)

## standing_images/

立绘批处理脚本组。下一次处理 `怪文书素材/1.立绘` 时，优先阅读：

- [standing_images/README.md](standing_images/README.md)：脚本组总览、执行顺序、默认目录和安全约定。
- [standing_images/RUNBOOK.md](standing_images/RUNBOOK.md)：完整操作流程和常用命令。

脚本入口：

- `scripts/standing_images/trim_alpha_edges.py`：裁掉 `半身像` 和 `七分像` 外圈透明边。
- `scripts/standing_images/generate_half_body_2.py`：按 `半身像-2` 示例比例，从 `七分像` 生成审核用 `半身像-2`，并二次裁透明边。
- `scripts/standing_images/promote_half_body_2.py`：审核后将 `半身像-2` 合并回 `半身像`，目标已存在则跳过，并清空源文件。

## balance_wav_directory.py

批量平衡一个目录下的 WAV 语音片段响度。脚本适合短对白、台词、语音包一类素材；它使用有效 RMS 近似响度，不依赖 ffmpeg，也不是严格 LUFS 测量。

默认行为：

```text
audio/*.wav           归一化后的同名文件
audio/original/*.wav  未归一化的源文件
```

也就是说，运行后原来的音频路径保持不变，Premiere、映射文件或其他流程继续引用 `audio/*.wav` 即可；未处理前的源文件会被归档到 `original` 子目录。

常用命令：

```powershell
# 先预览每个文件会调整多少，不写文件
python scripts\balance_wav_directory.py "C:\path\to\audio" --dry-run

# 默认模式：归一化文件留在原目录，源文件移入 original
python scripts\balance_wav_directory.py "C:\path\to\audio"

# 指定目标响度，而不是使用目录中位数
python scripts\balance_wav_directory.py "C:\path\to\audio" --target-dbfs -18

# 指定源文件归档目录名
python scripts\balance_wav_directory.py "C:\path\to\audio" --archive-dir original-raw

# 只输出归一化副本，不移动源文件
python scripts\balance_wav_directory.py "C:\path\to\audio" --out-dir balanced
```

注意事项：

- 支持 16-bit 和 32-bit PCM WAV。
- 默认目标响度是当前目录内所有非静音文件的中位数。
- 会限制正向增益，避免削波；因此个别峰值很高的文件可能不会完全到达目标响度。
- 如果默认模式下 `original` 中已经存在同名文件，脚本会拒绝覆盖。需要重新试验时，换一个 `--archive-dir`，或先手动整理旧归档。
- 使用 `--recursive` 时，脚本会跳过归档目录和 `--out-dir` 目录，避免反复处理已生成文件。
