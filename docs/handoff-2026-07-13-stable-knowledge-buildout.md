# 交接文档：学马仕稳定知识库首版建设进度

- 交接日期：2026-07-13
- 上游规格：[Research-004 §6](research-004-gakumas-thread-translation-formats-and-knowledge-layout.md#6-推荐仓库目录结构)（目录结构）+ [Research-005](research-005-gakumas-stable-knowledge-first-version-spec.md)（各文件首版规格，本次会话中已多次修订）
- 交接给：新会话（继续 `domains/gakumasu/stable/` 首版建设）

## 1. 已完成模块（6/9）

按 Research-005 §13 顺序推进，已完成如下文件：

| # | 模块 | 文件路径 | 状态 |
|---|---|---|---|
| 1 | 目录 + README + sources.md | `domains/gakumasu/README.md`, `domains/gakumasu/stable/sources.md` | 已建 |
| 2 | glossary.csv 首版 | `domains/gakumasu/stable/glossary.csv`（66 条，5 大类） | 已建 |
| 3 | style-guide.md | `domains/gakumasu/stable/style-guide.md`（10 章，含书名号规则） | 已建 |
| 4 | characters.md 首版 | `domains/gakumasu/stable/characters.md`（6 大分区，覆盖 20+ 角色） | 已建 |
| 5 | character-profiles/rinha.md | `domains/gakumasu/stable/character-profiles/rinha.md`（贺阳燐羽 profile） | 已建 |
| 6 | relationships.md 首版 | `domains/gakumasu/stable/relationships.md`（10 大区，纯官方关系） | 已建 |

## 2. 剩下的模块（3/9）

按顺序完成：

### Module 7：community-expressions.md 首版

- **规格**：[Research-005 §8](research-005-gakumas-stable-knowledge-first-version-spec.md#8-community-expressionsmd-首版规格)
- **文件路径**：`domains/gakumasu/stable/community-expressions.md`
- **覆盖**：あにまん 掲示板 + B 站中文圈；5ch / X 不入首版
- **分层**：学马仕独有 + 偶像大师系列已有共识；泛宅圈通用（如"曇らせ""湿度"）不入首版
- **意图字段**：不新增独立字段，融入 `context` / `notes`
- **置信度**：三档 `confirmed` / `probable` / `uncertain`（沿用 sources.md §4 判定条件）
- **种子条目**：20–30 条，从 Research-002 燐羽 SS 串 + あにまん 学马仕综合归纳串 抽取
- **提醒**：本文件是社区表达专门文件，允许写二创衍生表达（这一点与 relationships.md "完全不写二创" 不同——见 [[feedback-official-over-fanwork-content]] memory）；但仍遵守"先系列/学マス圈共识，再单串专用"、不过度罗列剧情细节

### Module 8：common-background.md 骨架

- **规格**：[Research-005 §3](research-005-gakumas-stable-knowledge-first-version-spec.md#3-common-backgroundmd-首版规格)
- **文件路径**：`domains/gakumasu/stable/common-background.md`
- **收录范围**：
  - **骨架**：学园结构、Sense/Logic/Anomaly 三大分支、亲爱度机制、组合与个人活动周期、P 与偶像的契约模型
  - **高频事件**：2 周年前主线剧情中翻译时反复被提及的关键节点，只写事件名称与最小必要说明
- **边界约束**：
  - 只写**官方设定**。二创共识不进。
  - 现实运营层（直播、卡池、活动、周年周边）**首版不写**——遇到具体串再进 `context-pack.md`
  - 不复述 wiki，只写"影响翻译判断"的内容
- **时效锚点**：2 周年（2026-05）

### Module 9：translation-decisions.md 空壳

- **规格**：[Research-005 §9](research-005-gakumas-stable-knowledge-first-version-spec.md#9-translation-decisionsmd-首版规格)
- **文件路径**：`domains/gakumasu/stable/translation-decisions.md`
- **预锁定条目**（必须包含）：
  - `SyngUp!` → 保留原文，不中文化（不用"震升!""声扬!"等）
  - **担当名锚定原则**：所有担当中文名一旦在 `glossary.csv` 确定即全项目统一，禁止某个串内单独变体
  - `プロデューサー/P → 学P` 已在 style-guide 锁定，此处只引用不重复
  - **`藤田ことね → 藤田琴音`**（本次会话新增决策，2026-07-13，用户明确指示不用"言音"）
- **scope 字段**：`global` / `character` / `domain-thread` 三档
- **入库门槛**：不预设，按条目性质单独判断

## 3. 项目核心规则（必读）

以下规则来自本次会话累积的用户反馈，已写入 `~/.claude/projects/-Users-yuzhangchen-repositories-ForkTranslation/memory/`，新会话应自动加载。核心 4 条：

1. **调研源优先级**（[[feedback-translation-source-priorities]]）：译名调研不以 B 站 UP 主为中心，优先多渠道文字语料——萌娘百科、Pixiv 百科、贴吧、NGA、gakumas.cn、Seesaa wiki、あにまん。
2. **角色/剧情用日文源**（[[feedback-prefer-japanese-sources-for-content]]）：内容层调研优先看日文百科（Nicovideo/Pixiv/Seesaa）和官方角色页；日文侧的性格分析/讨论/二手总结同样可用；不必执着于第一手官方。
3. **官方优先，二创只举例**（[[feedback-official-over-fanwork-content]]）：character-profiles 以官方设定为主，二创只举 2-3 个代表性简例。**relationships.md 完全不写二创关系**。字数受限时先砍二创。Profile 字数 800-1500 字推荐，允许略超到 2000。
4. **学P × 偶像是并行世界线**（[[project-p-idol-parallel-worldlines]]）：一个 playthrough 只培育一位偶像；不同"学P × 偶像"关系不同时成立。翻译具体串时按其"当前担当偶像"选相应条目。

## 4. 项目核心决策（要在文件里落地的）

以下是已确认但未完全落地到 `translation-decisions.md`（Module 9 待做）的决策：

- `藤田ことね → 藤田琴音`（[[project-translation-kotone]]）：全项目统一，不使用"藤田言音"。`glossary.csv` 已落地。
- `SyngUp!` 保留原文：`glossary.csv` 已注明，`translation-decisions.md` 需正式登记。
- `プロデューサー / P → 学P`：`style-guide.md §3.1` 已锁定。
- **担当名锚定原则**：`glossary.csv` 是全项目统一表；`translation-decisions.md` 需登记该原则。

## 5. Research-005 规格修订记录（本次会话）

以下 spec 已在本次会话中修改，覆盖了原来 Research-005 的部分内容：

- **§5.1 rinami.md 首版不建**：从"首版两位（rinha + rinami）"改为"首版只写 rinha 一位"（用户指示 rinami 详细文档暂不做）
- **§5.2 profile 字数**：从"控制 800-1500 字"改为"推荐 800-1500 字，允许略超到 2000"
- **§5.4 二创偏差**：从"逐项列出"改为"举 2-3 个代表性精简例子，不为写二创压缩官方"
- **§6.5 书名号规则**：从"待定（见 §12 遗留项）"改为"按原文保留 `『』` / `「」` / `《》` / `""` 各自沿用"
- **§12.1 遗留项**：书名号规则已定，指回 §6.5
- **§12.2 权威 UP 主 / 汉化组名单**：已完成调研并落定，见 `sources.md`
- **§13 下一步**：步骤 5 从 "撰写 rinha.md、rinami.md 两份 profile" 改为 "撰写 rinha.md profile（首版仅此一份）"

## 6. 需要注意的问题

- **Module 7 起始时用户中断了 WebFetch 调用**。新会话开始 Module 7 时，先重新做调研——建议查以下来源（**已在 sources.md 登记**，都是文字语料）：
  - GameKee "学园偶像大师黑话术语解析" `gamekee.com/gakumas/624707.html`
  - あにまん 学马仕综合归纳串
  - Nicovideo 大百科 学园偶像大师条目
  - Pixiv 百科 SyngUp!、H.I.F 等条目
- **Module 7 与 rinha profile 的分工**：燐羽相关的二创 SS 串常见倾向（Pラブ / 妹概念 / 心中依附等）已在 `character-profiles/rinha.md §6` 简要登记。community-expressions.md 里若涉及这类内容，**只登记具体的表达 / 短语 / 梗**，不重复 profile 里已有的"倾向分析"。
- **Module 8 与 characters.md 的分工**：characters.md 已含全角色人物地图，common-background.md 只写系统级别的**背景骨架**（学园结构、Sense/Logic 机制、亲爱度系统等）和主线**关键事件名 + 一句说明**，**不复述**任何角色个体信息。
- **Module 9 内容主要来自积累**：本次会话累积的翻译决策（藤田琴音 / SyngUp! / 学P / 担当名锚定）都需要在 Module 9 里正式落地。

## 7. 已有文件位置速查

```
domains/gakumasu/
├─ README.md
└─ stable/
   ├─ sources.md                    ← 已建
   ├─ glossary.csv                  ← 已建
   ├─ style-guide.md                ← 已建
   ├─ characters.md                 ← 已建
   ├─ character-profiles/
   │  └─ rinha.md                   ← 已建（rinami.md 首版不建）
   ├─ relationships.md              ← 已建
   ├─ community-expressions.md      ← 待建（Module 7）
   ├─ common-background.md          ← 待建（Module 8）
   └─ translation-decisions.md      ← 待建（Module 9）
```

## 8. 新会话建议启动方式

```
读 docs/handoff-2026-07-13-stable-knowledge-buildout.md，理解当前进度和规则。然后从 Module 7（community-expressions.md）继续，按 Research-005 §8 规格执行。
```

memory 系统会自动加载 §3 中提到的 4 条 feedback，无需重复说明。
