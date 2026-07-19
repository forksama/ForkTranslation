# D 驱动实现结论

日期：2026-07-19

> 这份文件作为当前 D 驱动改造的统一结论文档。
> 目前先汇总 GPT-SoVITS 侧改动；后续 VOICEVOX 侧改动也继续写入**同一个文件**，不再拆成新的零散摘要。

## 一、当前范围

当前已完成的是：

- **GPT-SoVITS 侧 D 驱动第一阶段实现**
- **VOICEVOX 侧 D 驱动第一轮代码骨架**
- **VOICEVOX macOS 完整打包链路验证**

覆盖文件：
- `GPT-SoVITS/GPT_SoVITS/d_manifest_bridge.py`
- `GPT-SoVITS/GPT_SoVITS/inference_webui.py`
- `GPT-SoVITS/GPT_SoVITS/voice_portrait_mapping.py`
- `voicevox-fork/src/helpers/dDrivenManifest.ts`
- `voicevox-fork/src/components/Dialog/DDrivenBatchFillDialog.vue`
- `voicevox-fork/src/store/audio.ts`
- `voicevox-fork/src/store/type.ts`
- `voicevox-fork/src/store/ui.ts`
- `voicevox-fork/src/components/Talk/ToolBar.vue`
- `voicevox-fork/src/components/Dialog/AllDialog.vue`
- `voicevox-fork/src/components/Talk/AudioCell.vue`
- `voicevox-fork/src/helpers/voicePortraitMapping.ts`

当前仍未覆盖：
- `GPT-SoVITS/GPT_SoVITS/inference_webui_fast.py`
- VOICEVOX 旧 toolbar 设置的自动迁移注入
- VOICEVOX browser 版显式禁用/提示

---

## 二、GPT-SoVITS 已完成改动

### 1. D manifest 接入

已新增 `d_manifest_bridge.py`，负责：
- 读取 `<workdir>/pr-subtitles-D.json`
- 校验 `schema / cues[*].order / role / jaText`
- 构建 `order -> cue`、`role -> orders`
- 计算当前范围内第一条 / 下一条待生成项
- 生成底部序号网格 HTML
- 生成稳定角色配色

结论：
- GPT-SoVITS 现在通过“选择工作目录”间接选择 D
- D 文件路径固定为：`<workdir>/pr-subtitles-D.json`

### 2. 推理页 D 驱动联动

`inference_webui.py` 已接入 D 状态刷新逻辑：
- 工作目录切换时自动加载 D
- 角色筛选、刷新状态、下一条、序号点击都走统一刷新流程
- 选中 cue 后自动回填：
  - `vpm_order`
  - `text = cue.jaText`
  - `text_language = 日文`
- 保存到 mapping 后**不再自动 `order + 1`**，而是只刷新状态

结论：
- 第一阶段已去掉“手输序号、手贴日文台词”的主要重复操作
- 底部导航区已经成为主推进入口，`vpm_order` 仅保留为调试/手动覆盖入口

### 3. 底部导航区

底部导航区已落地：
- 角色筛选
- 刷新状态
- 下一条
- 当前 cue 摘要
- 序号网格

并已满足此前布局约束：
- “下一条”按钮在底部
- 序号列表 / 序号网格在底部

### 4. 立绘图库修正

`voice_portrait_mapping.py` 已按最终语义修正立绘显示行数：
- 不再是纵向滚动大网格
- 改为**保留横向浏览逻辑的多行 strip**
- 保留每张卡片的：
  - 完整立绘图片
  - 底部文件名小字
- 当用户设置 `n` 行时：
  - 从上到下固定 `n` 行
  - 项目按列向右铺开
  - 整体通过左右横向滚动浏览

键盘导航也已同步修正：
- 左右键：跨列移动
- 上下键：列内移动

另外：
- “立绘显示行数”标签已明确标成 `立绘显示行数 (横向滚动)`
- `vpm_gallery_rows` 会写入 UI 配置并恢复

### 5. 序号网格视觉约定

底部 D 导航区序号网格已按最新约束修正：

#### 未生成项
- 背景色：白色 `#ffffff`
- 不再使用透明背景
- 角色差异主要通过边框色和文字色体现

#### 已生成项
- 背景色：浅灰色 `#e5e7eb`
- 不再按角色使用不同背景底色
- 角色差异继续通过边框色和文字色保留

#### 角色区分度
- 已提高不同角色的边框色 / 文字色饱和度与对比度
- 当前选中项继续用更强的激活边框强调

结论：
- 在浅色主题下，未生成与已生成状态现在可以肉眼区分
- 不同角色的区别主要靠边框和文字，不靠背景色

### 6. Mapping 读写回退

由于 ForkTranslation 当前不再提供共享 Python `voice_mapping` 包：
- 已在 `voice_portrait_mapping.py` 内补本地 `Mapping / MappingItem` 回退实现
- 保持以下接口仍可正常工作：
  - `load_or_create`
  - `next_order`
  - `upsert`
  - `save`

结论：
- GPT-SoVITS 侧现在不再硬依赖共享 Python 包
- 仍遵守同一份 `voice-portrait-map.json` 契约字段

---

## 三、当前已知约束与取舍

### 1. 多角色项目的当前取舍
当前第一阶段只解决：
- `order` 自动填充
- `jaText` 自动回填

尚未做自动绑定：
- `role -> preset_name`
- `role -> portrait_rel_dir`
- `role -> ref_audio / prompt_text / prompt_language`

结论：
- 多角色项目当前仍推荐按角色模式工作
- “全部”模式更适合查缺补漏，不适合直接跨角色连续生产

### 2. D 选择方式
当前不是单独选 D 文件，而是：
- 选工作目录
- 自动读取 `<workdir>/pr-subtitles-D.json`

如果后续需要更直观的 UI，可再补：
- 工作目录
- D 文件路径（自动带出，可手动改）

---

## 四、验证结论

已完成的验证包括：
- `py_compile` 检查通过：
  - `GPT_SoVITS/d_manifest_bridge.py`
  - `GPT_SoVITS/voice_portrait_mapping.py`
  - `GPT_SoVITS/inference_webui.py`
- 用真实样例验证：
  - 能读取 `pr-subtitles-D.json`
  - 能得到 roles / generated orders / 当前 focus order / next pending order
  - 本地 mapping 回退可成功写入并再次读取 `voice-portrait-map.json`
  - 序号网格 HTML 已确认同时输出：
    - `background:#ffffff`（未生成）
    - `background:#e5e7eb`（已生成）

已知旧提示：
- `inference_webui.py` 仍有既有 `SyntaxWarning`：`re.split("(\d+)", s)`
- 这是旧代码问题，不影响当前 D 驱动功能

---

## 五、后续追加约定

从现在开始，后续 **VOICEVOX 侧改动也追加到这份文件**，建议按下面结构继续补：

- `## 六、VOICEVOX 已完成改动`
- `## 七、跨引擎统一约定更新`
- `## 八、剩余问题 / 下一阶段`

也就是说：
- GPT-SoVITS 改动：继续写这里
- VOICEVOX 改动：也写这里
- 不再为每个小改动单独新建摘要文件作为主结论

---

## 六、VOICEVOX 侧设计结论（repo grounded）

本次不是直接实现，而是基于真实 `voicevox-fork` 仓库补齐 **VOICEVOX 侧 D 驱动 Phase 1 设计**。

已核对的关键落点包括：
- `src/main.ts`
- `src/components/App.vue`
- `src/components/Talk/TalkEditor.vue`
- `src/components/Talk/ToolBar.vue`
- `src/components/Talk/AudioCell.vue`
- `src/components/Dialog/AllDialog.vue`
- `src/components/Dialog/SettingDialog/SettingDialog.vue`
- `src/helpers/voicePortraitMapping.ts`
- `src/store/audio.ts`
- `src/store/ui.ts`
- `src/store/type.ts`
- `src/type/preload.ts`
- `src/domain/project/schema.ts`

### 1. Phase 1 主结论

VOICEVOX 侧 **不建议照抄 GPT-SoVITS 的底部“下一条”导航**。

更符合当前仓库结构的方案是：
- 在 `TalkEditor` 顶部工具栏增加一个 **D 批量预填**入口
- 通过全局对话框完成：
  - 读取 `<workdir>/pr-subtitles-D.json`
  - 角色多选
  - `role -> VOICEVOX voice` 分配
  - cue 预览与“仅未生成”过滤
- 预填完成后，把结果回写到现有 `AudioCell` 列表
- 导出仍然复用现有 VPM 批量导出链路

### 2. 推荐新增 / 改动文件

建议新增：
- `src/helpers/dDrivenManifest.ts`
  - 负责 D manifest 读取、校验、索引、按角色汇总、按最新 mapping 计算 pending cues

建议修改：
- `src/components/Talk/ToolBar.vue`
  - 新增 `D 批量预填` 按钮
- `src/components/Dialog/AllDialog.vue`
  - 注册新的 D 工作台对话框
- `src/store/ui.ts`
  - 管理新对话框开关状态
- `src/store/type.ts`
  - 增加新 action / mutation / dialog 状态 / `AudioItem` 的 D 元信息
- `src/type/preload.ts`
  - 增加 toolbar tag
- `src/domain/project/schema.ts`
  - 让 `AudioItem` 的 D 元信息可持久化到项目文件
- `src/store/audio.ts`
  - 做固定 `order` 的 cue upsert、最新 mapping 状态读取、导出 role 修正
- `src/helpers/voicePortraitMapping.ts`
  - 抽出“读取最新 generated orders”公共接口
- `src/components/Talk/AudioCell.vue`
  - 可选增加 `D#order / role` 轻量 badge

### 3. 这次设计识别出的关键冲突点

#### A. 现有插入逻辑会破坏 D.order
`src/store/audio.ts` 里的：
- `INSERT_AUDIO_ITEM`
- `INSERT_AUDIO_ITEMS`
- `COMMAND_PUT_TEXTS`

都会重算 / 归一化 `exportFileNameIndex`。

但 D 驱动里：
- `exportFileNameIndex` 实际上就是 `cue.order`
- 也是 mapping 和导出命名的关键主键

所以第一阶段不能直接复用 `COMMAND_PUT_TEXTS` 作为最终导入路径，必须新增“保留固定 order”的 upsert 逻辑。

#### B. 现有 mapping role 来源不对
当前 `VPM_MULTI_GENERATE_AND_SAVE_AUDIO` 写 mapping 时，`role` 来自：
- `getters.VOICE_NAME(audioItem.voice)`

D 驱动模式下应改成：
- `audioItem.dCueMeta?.role ?? getters.VOICE_NAME(audioItem.voice)`

否则 mapping 里保存的是音色名，不是脚本角色名。

#### C. Phase 1 应明确偏 Electron 工作流
当前 browser backend 对本地目录工作流支持不完整；结合现有 VPM 设计，VoiceVox 侧 D 驱动 Phase 1 应优先落在 Electron 版。

---

## 七、跨引擎统一约定更新

基于本次 VOICEVOX 设计，补充两条跨引擎统一约定：

1. **`voice-portrait-map.json` 里的已生成判断仍只看 `order`，且必须以最新文件为准。**
2. **D 驱动模式下，写回 mapping 的 `role` 应优先保留 D 中的脚本角色，而不是各引擎内部当前选中的 voice 名。**

---

## 八、VOICEVOX 已完成改动（2026-07-19 首轮代码骨架）

已在 `voicevox-fork` 落下第一轮可运行代码骨架，覆盖：
- `src/helpers/dDrivenManifest.ts`
- `src/components/Dialog/DDrivenBatchFillDialog.vue`
- `src/components/Dialog/AllDialog.vue`
- `src/components/Talk/ToolBar.vue`
- `src/components/Dialog/ToolBarCustomDialog.vue`
- `src/components/Talk/AudioCell.vue`
- `src/store/audio.ts`
- `src/store/type.ts`
- `src/store/ui.ts`
- `src/store/utility.ts`
- `src/type/preload.ts`
- `src/domain/project/schema.ts`
- `src/helpers/voicePortraitMapping.ts`

本轮已落实的能力：
1. 可从 `vpmWorkingDir` 读取 `<workdir>/pr-subtitles-D.json`，并按最新 mapping 计算 generated orders / role summaries / pending cues。
2. `TalkEditor` 顶部工具栏已接入 **D一括投入** 入口，并注册全局 `DDrivenBatchFillDialog`。
3. 对话框已支持：
   - 角色多选
   - `role -> voice` 分配
   - “仅导入未生成项”过滤
   - cue 预览
4. `store/audio.ts` 已新增按固定 `cue.order` 的 upsert 路径，避免沿用普通插入逻辑时重排 `exportFileNameIndex`。
5. `AudioItem` 已新增 `dCueMeta`，并持久化到项目 schema；`AudioCell` 也会显示 `D#order · role` 轻量 badge。
6. `VPM_MULTI_GENERATE_AND_SAVE_AUDIO` 写回 mapping 时，`role` 已改为优先使用 `audioItem.dCueMeta?.role`。
7. 已补 `readGeneratedOrdersFromMapping()` 公共接口，统一由最新 `voice-portrait-map.json` 判断完成态。

### 当前验证

已完成：
- `npm --prefix /Users/yuzhangchen/repositories/voicevox-fork run typecheck`
- `npm --prefix /Users/yuzhangchen/repositories/voicevox-fork run lint -- ...`（针对本轮改动文件）

结论：
- 类型检查通过
- 改动文件 lint 通过
- 第一阶段骨架已经从“设计”推进到“可继续迭代的仓库内实现”

### macOS 完整打包验证

已确认 `voicevox-fork` 的 macOS 包不能只跑默认 `electron:build` 就结束，而是必须满足：

- `.env.production` 中 `executionFilePath` 为 `vv-engine/run`
- 显式设置 `VOICEVOX_ENGINE_DIR`
- 指向已解压的引擎目录（本次为 `voicevox_engine_dl/extracted/macos-arm64`，约 2.0GB）

验证结果：
- 缺少引擎注入时，会得到约 `112MB` 的空壳 DMG
- 正确注入引擎后，产物约为：
  - `VOICEVOX.app`：2.4GB
  - `VOICEVOX-999.999.999-arm64.dmg`：1.9GB
- 打包日志中可见大量 `Contents/MacOS/vv-engine/...` 的签名记录，说明引擎已真实进入安装包

### 当前 UI 注意点

- D 入口当前落在 `TalkEditor` 顶部工具栏，按钮名为 **`D一括投入`**。
- 如果老用户顶部仍只看到 `連続再生 / 停止 / 選択音声を書き出し`，通常不是代码没进，而是旧 `toolbarSetting` 覆盖了新的默认布局。
- 当前代码已把 `D一括投入` 加进默认工具栏和工具栏自定义面板，但还没补“旧设置自动迁移注入新按钮”。

---

## 九、剩余问题 / 下一阶段

当前仍未做完的部分主要有：
- 还没有把 D 批量预填做成“按角色自动记忆上次 voice 选择”的长期配置
- 还没有把 browser 版入口显式禁用/提示为仅 Electron 支持
- 还没有补基于真实样例的单元/端到端测试
- 还没有处理“当前编辑器里已存在重复 order 行”的更细粒度冲突提示

下一步最值得继续做的是：
1. 用真实 `pr-subtitles-D.json` + `voice-portrait-map.json` 样例跑一遍端到端验证
2. 补导入冲突提示与覆盖策略
3. 决定是否要把 D 入口默认注入已有 toolbar 设置迁移逻辑
4. 如需量产工作流，再补 `role -> preset / portrait` 的持久化绑定层
