# 学马仕（gakumasu）领域

`domains/gakumasu/` 是本仓库中"学园偶像大师"作品相关翻译资产的领域根目录。当前原则是：**默认上下文只放会直接改变译文的规则**，背景、来源、社区梗与调研资料一律按需查询。

## 翻译长文前必须先看

`translation-B.md` 长文翻译采用用户风格校准 checkpoint。除非用户明确要求一次性交付完整 B，否则每完成约 1000-2000 字中文译文必须按完整楼层暂停，请用户审校或改写；收到“继续”时也只推进到下一个 checkpoint，不能直接翻到全文结尾。

每次暂停都必须用固定 checkpoint 提示，简洁列出已完成范围、用户要审校的内容、可选回复方式和后续工作；模板以 `workflows/thread-translation.md` 为准。

## 目录结构

```
gakumasu/
├─ README.md                       ← 本文件
├─ stable/                         ← 翻译执行用稳定知识
│  ├─ common-background.md         ← 剧情/系统背景补充速查（按需）
│  ├─ style-guide.md               ← 翻译风格指南（称呼、符号、语气等）
│  ├─ glossary.csv                 ← 术语表（角色/组合/内容/系统/梗）
│  ├─ characters.md                ← 全角色概要（人物地图）
│  ├─ character-profiles/          ← 主角级独立详述
│  │  └─ rinha.md                  ← 贺阳燐羽（首版仅此一份）
│  ├─ community-expressions.md     ← 社区表达与黑话（按需）
│  ├─ relationships.md             ← 角色关系集中登记（只加载相关条目）
│  └─ translation-decisions.md     ← 已作出的翻译决策
├─ workflows/                      ← 本领域可执行流程
│  └─ thread-translation.md        ← A -> B -> C -> D 翻译与字幕转换流程
├─ reference/                      ← 按需查证的来源、资料站与权威名单
│  └─ sources.md                   ← 中文译名与剧情内容来源
└─ threads/                        ← 各串的翻译工作目录（按需创建）
   └─ board-<boardId>-<short>/     ← 每个串一个子目录
      ├─ source-A.md               ← 油猴脚本导出的标准输入
      ├─ context-pack.md           ← 本串专用上下文包
      ├─ translation-B.md          ← 完整译文（审校用）
      ├─ pr-subtitles-C.md         ← 人工可读的 PR 字幕 cue 草稿
      ├─ pr-subtitles-D.json       ← 转换脚本生成的 PR 脚本输入
      ├─ review-notes.md           ← 审校记录
      └─ final.md                  ← 定稿汇总
```

## 使用惯例

- 强 agent 翻译时，默认只加载：
  - `workflows/thread-translation.md`
  - `stable/style-guide.md`
  - `stable/translation-decisions.md`
  - `stable/characters.md`
  - 本串主角对应的 `stable/character-profiles/*.md`
  - 本串实际涉及的 `stable/relationships.md` 条目
  - 本串命中的 `stable/glossary.csv` 术语
- `stable/common-background.md`、`stable/community-expressions.md` 不默认加载；只有原文实际提到对应事件、系统词、绰号或二创流派时再查。
- 稳定知识变动统一走 `stable/`；本次翻译才需要的信息进 `threads/<xxx>/context-pack.md`，不要污染 stable。
- 术语增删和译名冲突登记在 `stable/glossary.csv` 与 `stable/translation-decisions.md` 之间闭环。
- `character-profiles/` 只为当前或短期内的翻译项目主人公新建；其他角色出现时靠 `characters.md` 提供最小可翻译信息。
- 最终产物统一落在 `threads/board-<boardId>-<short>/`，并使用目录结构中的规范文件名；用户提供的外部源目录、图源目录或临时目录只作为输入来源，交付前必须检查没有把 A/B/C/D 留在外部目录。

## 调研资料

建设过程与调研记录保留在 `docs/` 或 git 历史中，不进入默认翻译上下文。译名来源和权威名单放在 `reference/`，只在需要查证来源等级、译名冲突或资料站时读取。
