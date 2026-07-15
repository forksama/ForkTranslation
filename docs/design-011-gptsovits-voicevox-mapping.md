# 设计 011：GPT-SoVITS 与 VOICEVOX 立绘映射

- 日期：2026-07-15
- 状态：已实现（Machine A 侧工具）
- 依赖：plan-010

> 本文档反映**最终落地实现**。最初的草案（角色名下拉、立绘相对仓库根、合成时即写映射）在开发过程中已被取代。最终方案是 plan-010「路径规则」中描述的**双基准目录 / 相对路径**模型。

## 概览

GPT-SoVITS（Gradio WebUI）和 VOICEVOX fork（Electron + Vue 3 + Vuex）都让操作者指定一个**工作目录**和一个**立绘目录**，然后为每段生成的音频关联一张立绘。关联关系写入 `<工作目录>/media/voice/voice-portrait-map.json`，且只存相对路径，因此可跨机器移植。schema（v2）与路径规则见 plan-010。

关键设计决策（最终版）：

- **与 ForkTranslation 解耦。** 立绘选择器可浏览操作者指定的任意文件夹；不依赖 FT 仓库结构或角色名解析。FT 仓库只提供一个*建议的默认立绘目录*。
- **双基准目录，只存相对路径。** `audioRelPath` 相对工作目录；`portraitRelPath` 相对立绘目录。两个基准目录本身都不写进 JSON。
- **多级立绘浏览。** 立绘目录可位于任意层级（例如 `怪文书素材`），操作者逐级深入子文件夹（`1.立绘/10 燐羽立绘`）找到图片。

---

## 共享 Python 库：`scripts/voice_mapping/`

一个被 GPT-SoVITS 桥接模块使用的小型包（也可供任意 Python 侧工具使用）。VOICEVOX **不用**它——它在 TypeScript 侧重新实现了等价逻辑（`src/helpers/voicePortraitMapping.ts`）。

```
scripts/voice_mapping/
  __init__.py     # 导出 Mapping, MappingItem
  mapping.py      # Mapping / MappingItem: load / save / upsert / next_order
```

### `mapping.py`（核心）

`MappingItem` 数据类字段：`order`、`audioFileName`、`audioRelPath`、`portraitRelPath`、`role`、`engine`、`text`。

`Mapping` 类：
- `load_or_create(path)` —— 读取已有 JSON，无则新建空的。
- `save(path)` —— 以 `ensure_ascii=False, indent=2` 写入。
- `upsert(item)` —— 替换同 `order` 的条目，否则追加；随后按 `order` 排序。
- `next_order()` —— `max(order) + 1`。

> 注意：当前库写出的 schema 早于 v2 标记。改动此文件时，应对齐 plan-010 的 v2 schema（`schemaVersion: 2`、`audioPathBase: "workdir"`、`portraitPathBase: "portraitDir"`）。较早的测试文件可能仍是 v1（`threadPathBase`/`portraitPathBase: "repo"`）。

> 历史说明：原设计曾有一个 `roles.py`（基于 `怪文书素材/1.立绘/` 子文件夹名解析角色名）。最终 UI 改为**解耦的文件夹浏览器**后该模块不再被使用，已删除。

---

## Part A：GPT-SoVITS

文件：
- `GPT_SoVITS/voice_portrait_mapping.py` —— 桥接模块（定位共享库，封装映射读写、文件夹列举、gallery 的 HTML/JS/CSS）。
- `GPT_SoVITS/inference_webui.py` —— 推理页 UI 与事件绑定。

### A.1 UI（「立绘映射」折叠面板，位于「前三次结果」下方）

- **工作目录** 文本框 + 打开/新建 按钮。默认 = 最近的 `board-*` thread（若存在 FT 仓库），否则本地兜底路径。
- **立绘目录** 文本框 + 选择立绘目录 按钮。默认 = `怪文书素材/1.立绘`（若存在 FT 仓库）。
- **角色立绘相对目录** 文本框（可手输、多级）+ ↑上级 + 选择 按钮。
- **进入子文件夹** 下拉框 —— 列出当前相对层级下的子文件夹；选一个即深入（`vpm_on_enter_subdir` 把它追加到相对路径）。
- **已选立绘** 文本框（点击缩略图后填入）。
- **立绘缩略图条** —— 自定义 `gr.HTML` + JS（点击选中、方向键、横向滚动、高亮）。图片通过 Gradio 的 `/file=` 端点提供；`allowed_paths` 包含用户主目录，因此任意选中的文件夹都能加载。
- **序号 (order)** 数字框（可编辑）+ **允许覆盖已存在序号** 复选框 + 状态 markdown。

gallery 的 JS 通过 `gr.Blocks(head="<script>...</script>")` 注入，**不能**用 `gr.Blocks(js=...)`——后者要求单个函数，遇到 IIFE 会失效。`gr.HTML` 不执行内联 `<script>`，故用 head 注入。

### A.2 多级文件夹浏览

`voice_portrait_mapping.list_subfolders(portrait_dir, rel_dir="")` 列出 `<portrait_dir>/<rel_dir>` 下的子文件夹。UI 辅助函数 `vpm_refresh_reldir` 一次性返回：正规化后的相对目录、子文件夹选项、gallery HTML、清空的 bridge 值。所有导航入口（手输、进入子文件夹、返回上级、原生对话框选择）都汇聚到它。

### A.3 保存到映射（逐槽位）

每个音频槽位（「输出的语音」和三个「前三次结果」）都有一个「💾 保存到映射」按钮。点击时（`vpm_save_slot_to_mapping`）：

1. 读取该槽位当前的文件路径（反映波形裁剪结果）。
2. 若 `order` 已存在且未勾选「允许覆盖已存在序号」→ 警告并中止。
3. 把音频复制进 `<工作目录>/media/voice/audio/`，命名为 `{order}-{原始下载名}`（无前导 0）。
4. `append_mapping_entry(...)` upsert 该条目；`portraitRelPath` 相对立绘目录计算（若在其外则回退为 FT 仓库相对路径或纯文件名）。
5. 序号框自动前进到 `order + 1`。

工作目录和立绘目录持久化到 `ui_config.json`（`vpm_file_path`、`vpm_portrait_dir`），在 `init_ui` 中恢复。

**序号递增语义**：保存后取 `当前 order + 1`（而非映射里的最大 order），因为某个角色的 order 可能是跳号的。操作者可随时手动改序号框。

---

## Part B：VOICEVOX Fork

### B.1 数据模型

`AudioItem`（`src/store/type.ts` 与工程 schema `src/domain/project/schema.ts`）新增可选字段 `portraitPath?: string`（绝对路径；导出时换算为相对立绘目录）。它是 optional，旧工程文件无需迁移即可加载。`conversion.ts` 只处理 song track，因此 talk 的 `audioItems`（及 `portraitPath`）会自动随工程存取。

### B.2 设置（持久化在 `savingSetting`）

加入 zod schema（`src/type/preload.ts`）与 store 默认值（`src/store/setting.ts`）：

- `vpmWorkingDir: string` —— 音频 + 映射基准。
- `vpmPortraitDir: string` —— 立绘相对路径基准。
- `vpmAutoFillByRole: boolean`（默认 true）—— 按角色自动填充立绘。

`SettingDialog.vue` 里的「立絵マッピング」卡片提供两个目录选择器（`showOpenDirectoryDialog`）+ 清除按钮 + 自动填充开关，并附提示：立绘目录的基准层级需在三方之间对应。

### B.3 目录列举 IPC

Electron 沙箱原本缺少目录列举方法，因此新增了一条贯通的 IPC：

- `VPM_LIST_DIRECTORY`（`src/type/ipc.ts`）。
- `Sandbox` 接口上的 `vpmListDirectory`（`src/type/preload.ts`）。
- 渲染进程 preload 接线（`src/backend/electron/renderer/preload.ts`）。
- 主进程 handler（`src/backend/electron/ipcMainHandle.ts`）—— 返回 `{ subDirs, imageFiles }`，跳过疑似 Git LFS 指针（< 500 字节）的文件。
- browser 沙箱桩函数抛出「不支持」。

### B.4 渲染端 helper `src/helpers/voicePortraitMapping.ts`

映射逻辑的 TypeScript 等价实现：`mappingFilePath`、`audioOutputDir`、`toAudioRelPath`、`toPortraitRelPath`、`upsertMappingItem`、`createEmptyMapping`（schema v2），以及 `loadLocalImageObjectUrl`（通过 `readFile` → Blob → object URL 供 `<img>` 显示本地图片）。

### B.5 立绘选择器

- `PortraitPickerDialog.vue` —— 网格弹窗，含立绘目录输入 + 选择器、**多级文件夹浏览器**（手输相对路径 + 面包屑 `navigateToDepth` + 子文件夹 chips `enterSubDir`）、缩略图网格。object URL 在清理时释放。
- `AudioCell.vue` —— `CharacterButton` 旁的行内 2rem 立绘缩略图；点击打开弹窗。`watch(portraitPath)` 生成/释放 object URL。

### B.6 Store 命令 `COMMAND_SET_AUDIO_PORTRAIT_PATH`

设置某音频项的 `portraitPath`。当 `autoFillByRole` 开启时，同时填充所有 `voice.speakerId` 相同且尚无立绘的行。

### B.7 导出写映射（单选 + 多选统一）

- `VPM_MULTI_GENERATE_AND_SAVE_AUDIO` —— 对每个 audioKey：合成音频、写入 `<工作目录>/media/voice/audio/{exportFileNameIndex}-{DEFAULT_AUDIO_FILE_NAME}`，然后 upsert 一条映射（`audioRelPath` 相对工作目录、`portraitRelPath` 相对立绘目录、`role` = `VOICE_NAME`、`engine: "voicevox"`）。写回前先读取并合并已有映射。返回 `SaveResultObject[]`。
- `MULTI_GENERATE_AND_SAVE_AUDIO` —— 开头若检测到 `vpmWorkingDir` 已设置，则转发到 VPM action；否则维持原逻辑。
- `GENERATE_AND_SAVE_AUDIO`（单选）—— 同理，设了工作目录时转发到 `VPM_MULTI_GENERATE_AND_SAVE_AUDIO([audioKey])`，因此**单选与多选行为一致**（都写映射、都跳过普通保存对话框）。
- `VPM_CHECK_OVERWRITE_ORDERS` —— 返回本次待导出 order 中已存在于映射文件的那些。

### B.8 覆盖确认

`Dialog.ts` 有一个共享的 `confirmVpmOverwriteIfNeeded(audioKeys, actions)` helper，被 `generateAndSaveOneAudioWithDialog` 和 `multiGenerateAndSaveAudioWithDialog` **同时**使用。若有 order 将被覆盖，弹出 `showQuestionDialog` 警告并列出冲突的 order；只有点「上書きして続行」才继续导出。

导出触发点位于 `src/store/ui.ts`（`SHOW_GENERATE_AND_SAVE_ALL_AUDIO_DIALOG`、`SHOW_GENERATE_AND_SAVE_SELECTED_AUDIO_DIALOG`——后者把「多选 >1」导向 multi、单个导向 one）。

---

## Part C：macOS 打包说明

权威构建指南是 voicevox-fork 仓库里的 `docs/build-macos-zh.md`。要点：

- macOS 需把 `.env.production` 的 `executionFilePath` 设为 `vv-engine/run`（非 `run.exe`）。**不要提交**此改动（会破坏 Windows 构建）。
- 下载并解压 VOICEVOX 引擎，然后在打包前 `export VOICEVOX_ENGINE_DIR=<解压目录>/macos-arm64/`。
- 构建：`pnpm run electron:build:compile` 然后 `electron:build:pack`。`afterPack.ts` 做 ad-hoc 签名（从内到外，避免对 `.dist-info` 用 `--deep`）。产物：`VOICEVOX.app`（约 2.4 GB）+ DMG（约 1.9 GB）。

---

## Part D：Premiere UXP 插件（Machine B）—— 待实现

尚未实现。它将选择工作目录 + 立绘目录，按 `audioFileName` 匹配序列中的音频片段，通过 `立绘目录 + portraitRelPath` 定位立绘，把立绘片段摆放/裁剪到视频轨。详见 plan-010「Machine B Plan」。

**参考数据**：`domains/gakumasu/threads/board-test/` 是一次端到端测试的产物（含 GPT-SoVITS 与 VOICEVOX 两种引擎生成的音频 + 一个 `voice-portrait-map.json`），提交入库作为编写 UXP 插件时的真实样例。注意该测试文件的 schema 可能为 v1（早期产物），UXP 端应兼容 v1/v2 两种 base 标记，只依赖 `audioRelPath` / `portraitRelPath` 两个相对路径字段。
