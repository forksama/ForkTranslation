# 计划 012：D 驱动的语音生成工作流

- 日期：2026-07-19
- 状态：ForkTranslation 侧已实现 D 落盘；GPT-SoVITS 侧已完成第一阶段；VOICEVOX 侧已完成第一轮代码骨架并验证完整打包链路
- 依赖：`plan-010`、`design-011`、`domains/gakumasu/workflows/thread-translation.md`
- 范围：补强 `C -> D` 的日语落盘，并让 GPT-SoVITS / VOICEVOX 读取 D 作为语音生成输入；字幕导入继续读取 D

## 背景

现在的 `pr-subtitles-D.json` 主要是字幕面向的机器格式。它能给 Premiere 用，但对语音生成还不够“可直接消费”：

- `C` 里虽然有 `ja-read`，但当前转换脚本只校验它存在，不把它写进 D。
- GPT-SoVITS / VOICEVOX 目前更像是“生成后再手工补信息”的流程。
- 语音生成完成态已经有 `voice-portrait-map.json`，但它只能告诉我们“哪些序号已生成”，不能直接告诉语音工具“下一条该做哪一段”。

这次想补的是一条更顺的链路：

`C` 提供人工可审的 cue 切分和日语原文，`D` 变成统一的 cue manifest，语音工具和字幕工具都从 D 读。

## 目标

- `D` 同时服务字幕导入和语音生成。
- 语音生成不再手填序号和日语台词。
- GPT-SoVITS 支持按角色、按序号的单条推进。
- GPT-SoVITS 的“下一条”按钮和序号列表放在页面最下方。
- GPT-SoVITS 的立绘图库支持多行滚动，且可由用户调节显示行数。
- VOICEVOX 支持按角色多选的批量填表。
- 当前是否“已生成”继续以最新 mapping 文件为准，而不是只看 UI 内存状态。

## 现状与分工

| 产物 | 作用 | 当前状态 |
|---|---|---|
| `C` | 人工可读的字幕 cue 草稿 | 已有 `ja-read`，但只做校验 |
| `D` | 给机器读的 cue manifest | 已补 `jaText` / `jaBlocks`，可作为统一入口 |
| `voice-portrait-map.json` | 语音生成完成态与音频路径记录 | 可判断序号是否已生成 |
| Premiere UXP | 读取 D 生成字幕 | 已在读 D |
| GPT-SoVITS / VOICEVOX | 语音生成 | GPT-SoVITS 已按 D 单条推进；VOICEVOX 已完成按角色批量预填骨架 |

## 关键设计

### 1. D 继续是统一入口

`D` 不只给 Premiere 用，也要给语音工具用。它仍然以 `order` 为主序，按 `role` 区分说话人，保持和 C 的播放顺序一致。

建议先做**向后兼容扩展**：保留现有 `fork-pr-subtitles-d/v1` 的字幕字段，在每个 cue 上新增 voice-ready 的日语字段；等以后真有必要，再考虑升新 schema。

新增字段建议：

- `jaText`：该 cue 的日语台词，供语音引擎直接读取。
- `jaLines` 或 `jaBlocks`：保留 `ja-read` 的原始分块，便于调试和回查。

字幕侧继续使用：

- `line1` / `line2` / `lines` / `text`

语音侧主要使用：

- `order`
- `role`
- `jaText`

### 2. `C -> D` 必须补齐日语抽取

转换脚本不能再只验证 `ja-read` 存在，而不落盘。

它需要做的事：

- 读取每个 cue 下的 `ja-read` / `jp-read` / `read-ja`。
- 把日语整理成 D 可消费的结构。
- 继续保留中文字幕字段不变。
- 继续把缺失 `ja-read` 视为错误。

这里不要退回去拿 `B` 当语音输入。`B` 仍然是人工审校稿，`D` 才是机器入口。

### 3. GPT-SoVITS 的目标交互

GPT-SoVITS 推理页增加一个按 D 驱动的序号面板 `X`：

- 序号方格仍是正方形，中间显示数字。
- 方格颜色来自该序号所属角色。
- 当前序号再加一层高亮外框。
- 已生成序号用统一的浅色填充。
- 可以直接点击某个序号切换当前序号。
- 保留“是否允许覆盖当前序号”。
- “下一条”按钮放在页面最下方。
- 序号列表也放在页面最下方，作为底部导航区的一部分。

角色选择：

- 角色来自 D。
- 可选某个角色，或选择“全部”。
- 角色为“全部”时，序号按全局顺序推进。

推进逻辑：

- 生成完成后不自动递增。
- 由“下一条”按钮显式推进。
- 角色模式下，跳到当前角色的下一条待生成语音。
- “全部”模式下，跳到全局下一条。
- 到 D 上限后，提示“已经到最后一条”。
- 当前序号如果已在 mapping 中且未勾选覆盖，生成按钮应阻止写入；勾选覆盖后才允许更新。

数据刷新：

- 序号面板的已生成状态必须以**最新** mapping 文件为准。
- 不是只在加载页面时读一次。
- 每次刷新状态、切换序号、点击“下一条”前，都应重新看最新 mapping。

### 4. GPT-SoVITS 侧的落地设计（基于当前仓库）

下面这一节不是抽象草图，而是基于当前 `GPT-SoVITS` 仓库的真实入口和代码职责来定的。

#### 4.1 当前仓库里已经存在的切入点

当前外部仓库的相关结构如下：

- `webui.py`
  - 总入口页。
  - `1C-推理` 只是“打开推理 WebUI”的控制面板。
  - 它实际启动的是 `GPT_SoVITS/inference_webui.py` 或 `GPT_SoVITS/inference_webui_fast.py`。
- `GPT_SoVITS/inference_webui.py`
  - 当前**标准推理页**。
  - 已经包含：模型切换、预设管理、参考音频、目标文本、合成结果、历史结果、立绘映射 UI、保存到 mapping 的按钮。
  - 这是本次 D 驱动能力的主落点。
- `GPT_SoVITS/voice_portrait_mapping.py`
  - 已经封装了：工作目录模型、mapping 路径推导、是否已存在某 order、立绘目录浏览、gallery HTML/CSS/JS、音频复制到工作目录、写入 mapping。
  - 这是“已生成状态刷新”和“立绘图库改造”的自然落点。
- `GPT_SoVITS/inference_webui_fast.py`
  - 当前只接了 `TTS_infer_pack/TTS.py` 的加速推理链路。
  - 还没有立绘映射和 D 驱动面板。
  - 第一阶段**不建议**把 D 驱动直接做在 fast 版上。
- `GPT_SoVITS/TTS_infer_pack/TTS.py`
  - 负责文本预处理、prompt cache、batch / split_bucket / parallel_infer 等推理内核。
  - 它适合作为“真正执行合成”的底层，但不适合作为 D 驱动 UI 状态机的承载点。

结论：

- **Phase 1 只改 `inference_webui.py`。**
- **`voice_portrait_mapping.py` 负责 mapping / 立绘图库 / 最新状态读取。**
- **新增一个 D manifest bridge 模块，专门处理 D 的读取、索引、推进。**
- `inference_webui_fast.py` 暂不接入；必要时在入口提示“D 驱动模式请使用标准推理页”。

#### 4.2 新增一个 D manifest bridge，而不是把逻辑塞进现有 mapping 模块

建议新增模块，例如：

- `GPT_SoVITS/d_manifest_bridge.py`

职责只做 D 相关，不做音频推理、不做 mapping 写入：

- 从工作目录推导 D 路径：默认 `<workdir>/pr-subtitles-D.json`。
- 校验 D 至少存在：`schema`、`cues[*].order`、`cues[*].role`、`cues[*].jaText`。
- 构建索引：
  - `order -> cue`
  - `role -> [orders]`
  - `all_roles`
- 提供面板所需的只读查询：
  - `list_roles()`
  - `get_cue(order)`
  - `list_orders(role | all)`
  - `next_pending_order(role | all, generated_orders, current_order)`
- 统一做角色颜色分配：同一个 `role` 在整个页面生命周期内颜色稳定。
- 生成序号面板所需的 view model，而不是让 `inference_webui.py` 自己拼一堆字典。

这样分层的原因是：

- `voice_portrait_mapping.py` 现在已经同时管“目录浏览 + gallery + mapping IO”；再把 D 解析塞进去会越来越像杂物间。
- D 驱动的核心是“manifest 索引 + 当前状态推进”，它和 mapping 是协作关系，不是同一种数据源。
- 后续如果 VOICEVOX 也想复用同一套推进规则，可以直接照着这个模块的接口抄一份 TypeScript 版本，而不是从 Gradio 事件里拆逻辑。

#### 4.3 页面布局怎么改

现有 `inference_webui.py` 中，“立绘映射”面板在文本区和输出区之间，且序号输入框是普通数字框。新设计不建议把所有东西都塞在一处，而是拆成两层：

1. **配置层（中部）**
   - 保留工作目录、立绘目录、角色立绘相对目录、立绘图库、覆盖开关、状态栏。
   - 它们仍然属于“立绘映射 / D 驱动配置”。
   - 这里更像 setup 区，不承担主导航。

2. **导航层（底部）**
   - 放在“输出语音 + 历史语音槽位”之后，也就是页面最下方。
   - 包含：
     - 当前角色筛选下拉
     - 当前 cue 摘要（`order / role / jaText` 的首行）
     - “刷新状态”按钮
     - “下一条”按钮
     - 序号网格/列表
   - 用户补充要求里的“下一条按钮放最下方、序号列表放最下方”就在这一层落实。

这样做的好处：

- 上半部分还是“配模型 / 配参考 / 合成”；不会把主推理区挤乱。
- 下半部分才是“D 驱动工作台”；用户能在听完结果、确认立绘后，再直接切下一条。
- 当前 repo 已有 4 个音频槽位的保存动作；把导航沉到底部后，动作路径更自然：
  - 合成 -> 试听 / 裁剪 -> 保存到 mapping -> 刷新状态 / 下一条。

#### 4.4 立绘图库改造：从单行横条改成可调行数的多行网格

当前 `voice_portrait_mapping.py` 的 `generate_gallery_html()` 和 `GALLERY_CSS` 使用的是：

- 单行横向缩略图条
- `overflow-x: auto`
- 左右键导航

这对图片少的时候够用，但在 `怪文书素材` 里会很难找图。新设计改成：

- **多行网格**，不是单行条带。
- **纵向滚动**，不是只横向滚。
- 新增一个“显示行数”控件，例如 `vpm_gallery_rows`，默认 3 或 4。
- 用户改行数时，只更新 gallery 容器高度，不重算业务状态。
- 继续保留点击选中、高亮、懒加载。

建议实现方式：

- `generate_gallery_html(folder, selected_path="", rows=3)`
  - HTML 输出改为 grid 容器。
- `GALLERY_CSS`
  - 用 CSS 变量控制行数，例如 `--vpm-gallery-rows`。
  - 单张图保持固定缩略图宽高，整体容器按“行数 × 单元高度”算高度。
- `GALLERY_JS`
  - 点击选图、同步 `vpm_gallery_bridge` 的逻辑可以继续复用。
  - 左右键导航可保留，但要改成二维网格下的“上一张 / 下一张”而不是强依赖横向 strip。
- `ui_config.json`
  - 持久化 `vpm_gallery_rows`，避免每次打开都要重调。

这里不建议把“行数”做成响应式自适应黑盒，因为用户明确说了要能自己改，说明这不是纯视觉细节，而是工作流控制项。

#### 4.5 D 驱动状态机

D 驱动不是“加载一次 D 然后在前端内存里乱跳”，而是一个**每次动作都可重算的轻状态机**。

最少要有这些状态：

- `workdir`
- `d_path`
- `current_role_filter`（某角色 / 全部）
- `current_order`
- `current_cue`
- `generated_orders`（每次都从最新 mapping 读，不做单一真相缓存）

关键规则：

1. **选择工作目录时**
   - 同时尝试加载 `<workdir>/pr-subtitles-D.json`。
   - 如果 D 缺失或格式不对，状态栏直接报错，不再只给一个 `order=1` 的空白默认值。

2. **切换角色筛选时**
   - 重新从 D 得到该角色的 order 列表。
   - 再读取最新 mapping，求“该角色第一个未生成的序号”。
   - 如果该角色全做完，则停在该角色最后一条并提示“该角色已完成”。

3. **点击某个序号时**
   - 直接把 `current_order` 切到该序号。
   - 从 D 回填 `text = cue.jaText`。
   - 同步 cue 摘要区。
   - `text_language` 应自动切成“日文”，避免用户还要手改。

4. **点击“下一条”时**
   - 先重新读最新 mapping。
   - 再基于当前 role filter 找下一个未生成序号。
   - 找不到就提示“已经到最后一条”或“当前角色已全部完成”。
   - 只切换当前 cue，不自动合成。

5. **点击“保存到映射”时**
   - 仍然沿用现有保存逻辑：复制音频到工作目录、写/更 mapping。
   - 但保存后**不再自动把序号改成 `order + 1`**。
   - 只刷新最新 mapping 状态，让底部导航区决定下一步怎么走。

这是这次设计里最重要的一条：

> “自动 +1”属于旧的手工输入时代；进入 D 驱动后，推进权应该交给“下一条”按钮和 D 本身，而不是交给一个普通数字框。

#### 4.6 序号网格怎么表示状态

序号网格建议至少区分 4 种状态：

- **未生成**：角色色浅底 / 普通边框
- **当前选中**：角色色 + 强高亮外框
- **已生成**：统一浅灰或去饱和底色，避免误以为仍待做
- **当前且已生成**：保留高亮外框，但底色走“已生成”态

补充规则：

- 网格里的颜色映射按 `role` 稳定生成，不要每次刷新变色。
- 默认仍然 10 个一行即可；图片图库改多行，不代表序号网格也要改成瀑布流。
- 角色为“全部”时，网格按全局 `order` 顺序展示；角色过滤时，只显示该角色自己的 order。

#### 4.7 与当前 repo 的冲突点，需要明确改掉

基于现有代码，至少有这些地方会和新方案冲突：

1. `vpm_on_workdir_change()`
   - 现在会直接把 `vpm_order` 设成 `vpm_next_order(workdir)`。
   - 新方案里应该改成：优先按 D 选中“当前 scope 下下一条待生成 cue”。

2. `vpm_save_slot_to_mapping()`
   - 现在保存后会返回 `order + 1`。
   - 新方案里应该只返回“状态刷新后的当前 order”，默认不前进。

3. `vpm_order` 本身的角色
   - 现在它是主入口。
   - 新方案里它退化成“可手工覆盖的调试输入框”；真正主入口是 D 底部导航区。

4. `inference_webui_fast.py`
   - 现在没有 mapping 和 D 面板。
   - 第一阶段不接，避免在两套 UI 上同时维护同一套 D 状态机。

#### 4.8 对多角色项目的实际取舍

当前 GPT-SoVITS 推理页已经有“预设”系统，但它还没有“D 角色 -> 预设 / 参考音频 / 立绘目录”自动绑定层。

因此 Phase 1 的实际取舍应当是：

- **D 负责自动填 `order` 和 `jaText`。**
- **模型 / 预设 / 参考音频仍由用户控制。**
- 多角色场景下，推荐按角色模式工作；“全部”模式更适合查缺补漏，而不是跨角色连续生产。

也就是说：

- 这次先把“手输序号、手贴日文台词”去掉。
- 不强行在第一版里把“跨角色自动换预设”也一起做掉。

如果后面确实需要，再补一层本地配置，例如：

- `role -> preset_name`
- `role -> portrait_rel_dir`

但这不属于本计划第一阶段的必需项。

### 5. VOICEVOX 的目标交互

VOICEVOX 增加一个 D 驱动的批量入口，重点是“先把表填好”：

- 读取 D 后，先选角色。
- 角色支持多选。
- 每个角色分配一个语音模型。
- 之后自动把该角色对应的序号、模型、日语台词填进文本框。
- 这个批量入口不自动填图片。

这里的重点是把“人工复制台词 + 手动改序号 + 手动挑模型”变成“选择角色后直接生成”。

## 建议的实现顺序

1. 先补 `C -> D` 的日语字段。
2. 再让语音工具读 D。
3. 先在 GPT-SoVITS 的 `inference_webui.py` 做 D 驱动单条推进。
4. 然后补 GPT-SoVITS 的底部导航区与多行立绘图库。
5. 最后做 VOICEVOX 的批量预填。

## ForkTranslation 里现在已落地的部分

- 已更新 `scripts/convert-pr-subtitles.js` 的数据落盘策略，D 会产出 `jaText` / `jaBlocks`。
- 已更新 `domains/gakumasu/stable/style-guide.md` 和 `domains/gakumasu/workflows/thread-translation.md`，把“D 也承载日语”写进正式约定。
- 已补一份/更新一份示例 D，确保后面实现时有参照物。
- 这份计划继续作为跨仓库统一接口说明，与 `outputs/d-driven-implementation-conclusion.md` 一起维护。

## 外部仓库当前实现状态与后续

### GPT-SoVITS

已完成：
- `GPT_SoVITS/inference_webui.py`
  - 已接入 D manifest bridge
  - 已把 `text` / `order` 回填改成由 D 驱动
  - 已增加底部导航区：角色筛选、刷新、下一条、序号网格
- `GPT_SoVITS/voice_portrait_mapping.py`
  - 已增加最新 mapping 状态读取接口
  - 已把立绘图库改成保留横向浏览逻辑的多行 strip
  - 保存到 mapping 后不再无条件 `order + 1`

当前仍待继续：
- `GPT_SoVITS/inference_webui_fast.py`
  - 第一阶段先不接；至少要明确标注“不支持 D 驱动模式”
- `webui.py`
  - 如有必要，在入口层提示 D 驱动功能只落在标准推理页

### VOICEVOX

已完成：
- `src/helpers/dDrivenManifest.ts`
  - 读取 D manifest、汇总角色、结合最新 mapping 计算 pending cues
- `src/components/Dialog/DDrivenBatchFillDialog.vue`
  - 提供角色多选、`role -> voice` 分配、仅未生成过滤、cue 预览与批量导入
- `src/components/Talk/ToolBar.vue` / `src/components/Dialog/AllDialog.vue`
  - 已接入 `D一括投入` 入口与全局对话框注册
- `src/store/audio.ts`
  - 已新增固定 `cue.order` 的 upsert 路径，并在写回 mapping 时优先保留 D 角色名
- macOS 打包链路
  - 已验证完整包需显式注入 `VOICEVOX_ENGINE_DIR`
  - 正确结果为约 `VOICEVOX.app 2.4GB / DMG 1.9GB`

当前仍待继续：
- 旧 toolbar 设置的迁移注入，避免老用户默认看不到 `D一括投入`
- browser 版入口的显式禁用或提示
- 基于真实样例的端到端导入/导出回归验证
- `role -> preset / portrait` 的长期绑定能力

### 两边共通

- 都要把“最新 mapping 文件”当作已生成状态的唯一来源。
- 都不要把“自动 +1”当成推进逻辑的核心。

## 验收标准

- 任意一个 cue 在 D 中都能拿到可直接给语音引擎使用的日语字段。
- GPT-SoVITS 不需要手输日语台词和序号，就能单条推进。
- GPT-SoVITS 的“下一条”按钮和序号列表位于页面最下方。
- GPT-SoVITS 的立绘图库支持多行滚动，且行数可调。
- GPT-SoVITS 保存到 mapping 后不会偷偷自动跳到错误序号；只有显式点“下一条”才推进。
- VOICEVOX 不需要手工逐条复制台词，就能批量预填。
- Premiere 字幕导入继续照常读 D。
- 已生成状态和“下一条”判断都和最新 mapping 对得上。
