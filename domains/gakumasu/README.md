# 学马仕（gakumasu）领域

`domains/gakumasu/` 是本仓库中"学园偶像大师"作品相关翻译资产的领域根目录。目录布局遵循 [Research-004 §6](../../docs/research-004-gakumas-thread-translation-formats-and-knowledge-layout.md#6-推荐仓库目录结构)，首版内容规格遵循 [Research-005](../../docs/research-005-gakumas-stable-knowledge-first-version-spec.md)。

## 目录结构

```
gakumasu/
├─ README.md                       ← 本文件
├─ stable/                         ← 稳定知识（作品/角色/术语/风格/社区）
│  ├─ common-background.md         ← 共通剧情背景骨架
│  ├─ style-guide.md               ← 翻译风格指南（称呼、符号、语气等）
│  ├─ glossary.csv                 ← 术语表（角色/组合/内容/系统/梗）
│  ├─ characters.md                ← 全角色概要（人物地图）
│  ├─ character-profiles/          ← 主角级独立详述
│  │  └─ rinha.md                  ← 贺阳燐羽（首版仅此一份）
│  ├─ community-expressions.md     ← 社区表达与黑话
│  ├─ relationships.md             ← 角色关系集中登记
│  ├─ translation-decisions.md     ← 已作出的翻译决策
│  └─ sources.md                   ← 权威来源与作者名单
└─ threads/                        ← 各串的翻译工作目录（按需创建）
   └─ board-<boardId>-<short>/     ← 每个串一个子目录
      ├─ source-A.md               ← 油猴脚本导出的标准输入
      ├─ context-pack.md           ← 本串专用上下文包
      ├─ translation-B.md          ← 完整译文（审校用）
      ├─ pr-subtitles-C.jsonl      ← PR 字幕 cue
      ├─ review-notes.md           ← 审校记录
      └─ final.md                  ← 定稿汇总
```

## 使用惯例

- 强 agent 翻译时的最小上下文包见 [Research-004 §8](../../docs/research-004-gakumas-thread-translation-formats-and-knowledge-layout.md#8-强-agent-翻译时的上下文包)。
- 稳定知识变动统一走 `stable/`；本次翻译才需要的信息进 `threads/<xxx>/context-pack.md`，不要污染 stable。
- 术语增删和译名冲突登记在 `stable/glossary.csv` 与 `stable/translation-decisions.md` 之间闭环。
- `character-profiles/` 只为当前或短期内的翻译项目主人公新建；其他角色出现时靠 `characters.md` 提供最小可翻译信息。

## 首版范围

首版锚定到 **2 周年（2026-05）**：主线剧情、现役担当、基础系统均以 2 周年周边已实装的版本为准。此后新增内容作为增量补充。

首版**不建**的文件：`songs.md`、`cards.md`、`events.md`、`honorifics-and-pronouns.md`、`deprecated-terms.md` —— 遇到需要时再拆。理由见 [Research-005 §11](../../docs/research-005-gakumas-stable-knowledge-first-version-spec.md#11-首版不创建的文件)。
