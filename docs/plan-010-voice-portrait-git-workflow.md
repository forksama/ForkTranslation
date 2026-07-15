# 计划 010：语音立绘映射 Git 工作流

- 日期：2026-07-15
- 状态：Machine A 侧工具已实现；Machine B（Premiere UXP）MVP 已实现
- 范围：按 thread 的语音生成、立绘映射、Git 同步、以及 Premiere UXP 导入

## 背景

当前 ForkTranslation 工作流会为每个 thread 产出 A/B/C/D 制品，再用 B 和 C/D 生成语音与 Premiere 字幕。语音生成在 A 机器上进行，Premiere Pro 合成在 B 机器上进行。

主要瓶颈是立绘选择。在生成 GPT-SoVITS 语音时，操作者其实已经决定了参考语音和情绪，那正是选择对应立绘的最佳时机。如果把立绘选择拖到 B 机器上做 Premiere 时再选，操作者往往得重新阅读或重听整段上下文。

选定的方向是：让每个 `domains/gakumasu/threads/board-xxxx/` 目录成为一个完整的、受 git 管理的工作包。A 机器把生成的语音文件和语音-立绘映射写进同一个 thread 目录。B 机器拉取仓库、打开对应的 Premiere 工程，运行一个 UXP 插件读取映射，通过匹配音频片段文件名把立绘铺到一条新的视频轨上。

## 仓库决策

thread 目录纳入 git 跟踪，不再是仅本地的草稿制品。

这是有意为之，因为语音生成依赖 B 译文和 C/D 字幕制品，而 Premiere 合成依赖生成的语音文件和映射文件。Git push/pull 成为 A 机器与 B 机器之间的交接机制。

二进制媒体用 Git LFS 管理。本仓库已通过 `.gitattributes` 跟踪这些常见媒体类型：

- `*.wav`
- `*.png`
- `*.jpg`
- `*.jpeg`
- `*.webp`
- `*.mp4`

A 机器和 B 机器在拉取或推送含媒体的提交前，都应安装并初始化 Git LFS。

## Thread 目录结构

每个 thread 内使用如下结构：

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

如对调试或可复现有用，也可把生成日志放在 `media/voice/logs/` 下。

## 路径规则

映射文件使用两个各自独立的基准目录，由操作者在每台机器上自行选择。映射文件本身只存**相对路径**——绝不存绝对路径，也绝不存基准目录本身：

- **工作目录**（工作目录）：某个 thread/board 语音工作的根。音频存放在 `<工作目录>/media/voice/audio/` 下，并以相对工作目录的 `audioRelPath` 记录。
- **立绘目录**（立绘目录）：包含角色立绘子文件夹的根。立绘以相对立绘目录的 `portraitRelPath` 记录（例如 `1-咲季立绘.1/开心.png`）。

这样设计是有意的，因为操作者跨两代机器工作（语音生成在 A 机器、Premiere 合成在 B 机器），这些目录的绝对位置在两台机器上几乎总是不同的。通过只存相对路径、由每个工具在运行时各自选择基准目录，映射文件保持完全可移植。

**重要——立绘目录必须在三方工具间指向相同的逻辑基准层级**（GPT-SoVITS、VOICEVOX、Premiere UXP 插件）。绝对路径**无需一致**（每台机器可把立绘放在任意位置）；必须对应的是相对路径解析所依据的*基准层级*。例如，若 A 机器把 `portraitRelPath` 记为 `1.立绘/10 燐羽立绘/开心.png`（相对于 `.../怪文书素材` 这个立绘目录），那么 B 机器也必须把它的立绘目录指向它自己那份 `怪文书素材`（而非 `怪文书素材/1.立绘`），否则相对路径无法解析。工作目录与 `audioRelPath` 同理。每个工具都必须清楚地展示它正在使用的这两个目录，以便操作者保持基准层级对齐。

建议的默认立绘目录：`怪文书素材/1.立绘/`（存在 ForkTranslation 仓库时）。工作目录默认为最近的 `domains/gakumasu/threads/board-*` 目录，无仓库时用本地兜底路径。

Premiere 时间线匹配应使用 `audioFileName` 而非绝对音频路径，因为 B 机器上的 Premiere 可能不保留 A 机器的路径。相对的 `audioRelPath` 仍会记录，以便 UXP 插件校验期望的音频确实存在于所选工作目录下。

## 映射 Schema

使用 `media/voice/voice-portrait-map.json`：

```json
{
  "schemaVersion": 2,
  "audioPathBase": "workdir",
  "portraitPathBase": "portraitDir",
  "items": [
    {
      "order": 1,
      "audioFileName": "1-saki.wav",
      "audioRelPath": "media/voice/audio/1-saki.wav",
      "portraitRelPath": "1-咲季立绘.1/开心.png",
      "role": "咲季",
      "engine": "gpt-sovits",
      "text": "B 中对应句子"
    }
  ]
}
```

基准目录标记（`audioPathBase` / `portraitPathBase`）只是语义标签——真实目录由每个工具在运行时选择，**不写进文件**。

必需字段：

- `order`：B 句子的顺序，从 1 开始。
- `audioFileName`：用于 Premiere 片段匹配的精确文件名。
- `audioRelPath`：相对**工作目录**的音频路径。
- `portraitRelPath`：相对**立绘目录**的立绘路径。
- `role`：说话人/角色名（可从立绘子文件夹派生）。
- `engine`：`gpt-sovits` 或 `voicevox`。
- `text`：用于生成该段语音的 B 句子。

推荐的唯一性规则：

- 同一映射文件内 `order` 唯一。
- 同一映射文件内 `audioFileName` 唯一。
- 音频文件名使用无前导 0 的数字前缀 + 原始下载风格名，例如 `1-你好.wav`、`12-P.wav`。

追加/更新行为：

- 若已存在相同 `order` 的条目，则更新该条目。
- 若已存在相同 `audioFileName` 的条目，除非是同一 `order`，否则替换前应警告。
- 写入后保持数组按 `order` 排序。

> 兼容性说明：`domains/gakumasu/threads/board-test/` 里的测试映射仍标记为 `schemaVersion: 1`，但实际字段已经使用当前 UXP 所需的相对路径契约（`audioPathBase`、`audioRelPath`、`portraitRelPath`、`audioFileName`）。UXP 端不应按版本号硬分支；实际只依赖 `audioRelPath` / `portraitRelPath` / `audioFileName` 这些字段。

## Machine A 计划

A 机器负责语音生成。**状态：已实现**（GPT-SoVITS WebUI 与 VOICEVOX fork）。具体的组件/action 改动见 `design-011`。

两个工具都提供两个基准目录选择器，外加逐条的立绘选择：

- **工作目录** 选择器 —— 决定音频写入位置，以及 `audioRelPath` 的基准。
- **立绘目录** 选择器 —— 存放角色立绘子文件夹的根；`portraitRelPath` 的基准。建议默认 `怪文书素材/1.立绘/`。
- **立绘选择器** —— 一个多级文件夹浏览器（面包屑 + 子文件夹导航 + 手输多级相对路径 + 缩略图网格），因此即使立绘目录设在较高层级（如 `怪文书素材`），也能到达任意嵌套的立绘（如 `1.立绘/10 燐羽立绘/开心.png`）。工具存储相对立绘目录的路径。

GPT-SoVITS 实现：

- 工作目录 + 立绘目录选择器，以及合成控件附近的立绘缩略图条（自定义 HTML gallery，通过 `gr.Blocks(head=...)` 注入，因为 `gr.HTML` 不执行内联 `<script>`）。
- 映射文件位于 `<工作目录>/media/voice/voice-portrait-map.json`，自动创建/追加。
- 映射写入发生在操作者点击某个（可选裁剪过的）音频槽位旁的「保存到映射」时——**不**在每次合成时自动写。这样操作者可以先试听/裁剪。保存的音频会反映波形裁剪结果。
- 每次保存后 `order` 自动前进到 `当前 order + 1`（而非映射的最大 order），因为角色的 order 可能是稀疏/跳号的。操作者可随时编辑序号框。
- 若目标 `order` 已存在，保存会被拦截并警告，除非操作者勾选「允许覆盖已存在序号」。

VOICEVOX 实现：

- 同样的工作目录 + 立绘目录选择器（在设置里），外加「役割で立絵を自動填充」开关。
- 每个 `AudioCell` 里有一个行内立绘缩略图；点击它打开一个网格选择弹窗（多级文件夹浏览器）。
- 开启时，为某一行选择立绘会自动填充所有同角色（`voice.speakerId`）且尚无立绘的行。
- `order` 使用每行的 `exportFileNameIndex`（文本框右侧的数字框）。
- 导出只为成功生成的音频写映射条目。**单选与多选（批量）导出共用同一套 VPM 逻辑**——只要设了工作目录，两者都把音频写到 `<工作目录>/media/voice/audio/` 并更新映射（不再回退到普通保存对话框导出）。
- 覆盖已存在的映射 order 前，会弹确认框列出冲突的 order，要求操作者确认。

两个工具都把音频写到 `<工作目录>/media/voice/audio/`、映射写到 `<工作目录>/media/voice/voice-portrait-map.json`。只存相对路径；工作目录和立绘目录本身绝不写进 JSON。

## Machine B 计划

B 机器负责 Premiere Pro 合成。

新的 Premiere UXP 插件应：

1. 让用户选择 `voice-portrait-map.json`（其父目录的父目录即工作目录），或让用户直接选择工作目录。
2. 让用户选择**立绘目录**（必须与 GPT-SoVITS、VOICEVOX 所用的相同逻辑基准——需提醒操作者这一点）。
3. 让用户选择当前序列里的源音频轨。
4. 读取该轨上的音频片段，按 basename 与 `audioFileName` 匹配。
5. 通过 `工作目录 + audioRelPath` 定位音频、`立绘目录 + portraitRelPath` 定位立绘；校验二者都存在。
6. 把去重后的立绘图片导入 Project 面板。
7. 创建或选择目标视频轨。
8. 把每个立绘片段摆放到对应音频片段的起始时间。
9. 每个立绘从对应音频头持续到下一段音频头；最后一个立绘持续到自身音频尾。
10. 报告未匹配的音频片段、未使用的映射行、缺失的立绘文件、以及重复文件名。

因为基准目录是按工具运行环境选择的，操作者**必须**确保 Premiere UXP 里选的立绘目录与 GPT-SoVITS、VOICEVOX 所用的立绘根相对应，否则 `portraitRelPath` 无法解析。

摆放插件稳定后，合并或复用现有的图片底部脉冲逻辑，使一个操作既能摆放立绘又能施加弹跳动画。

**参考数据**：`domains/gakumasu/threads/board-test/` 已提交入库，是一次端到端测试的真实产物（含 GPT-SoVITS 与 VOICEVOX 两种引擎的音频 + 一个映射文件），可作为编写 UXP 插件时的样例。

## Git 工作流

每台机器的初始设置：

```powershell
git lfs install
git lfs pull
```

A 机器交接：

```powershell
git status
git add domains/gakumasu/threads/board-xxxx-short-title
git commit -m "Add board xxxx voice media and portrait map"
git push
```

B 机器接收：

```powershell
git pull
git lfs pull
```

B 机器开始 Premiere 工作前，确认期望的 `.wav` 是真实媒体文件而非 Git LFS 指针文件。如果是指针，再跑一次 `git lfs pull`。

## 实施阶段

1. 仓库准备
   - 把 thread 目录纳入 git 跟踪。
   - 媒体文件放在 Git LFS 下。
   - 记录本工作流。

2. Machine A 工具改动 —— **已完成**
   - 给 GPT-SoVITS 增加立绘选择与映射写入。
   - 给 VOICEVOX 增加批量 + 单个立绘选择与映射写入。
   - 使用共享映射 schema（v2，双基准目录）。

3. Machine B UXP MVP —— **已实现**
   - 读取映射 JSON。
   - 按文件名匹配已有音频片段。
   - 导入并把立绘摆放到一条新视频轨。
   - 前一立绘延续到下一段音频头，最后一个立绘结束于自身音频尾。
   - 插件路径：`scripts/premiere-uxp-portrait-map-importer/`

4. Machine B UXP 完善
   - 增加校验汇总和保存日志。
   - 增加重复/缺失文件诊断。
   - 把摆放与现有的底部脉冲动画流程结合。

5. 端到端验证
   - 测试一条 GPT-SoVITS 偶像台词。
   - 测试一条 VOICEVOX 非偶像台词。
   - 测试同一说话人多条台词配不同立绘。
   - 测试缺失立绘与重复文件名的诊断。
   - 测试从 A 机器 push、在 B 机器 pull。
