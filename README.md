# ForkTranslation

多领域翻译知识库与工作流仓库。根目录只做入口引导；具体作品、社区或题材的翻译规则、术语和上下文，请进入对应 `domains/<domain>/README.md`。

## 从这里开始

1. 先确定翻译所属领域。
   - 当前已有领域：`domains/gakumasu/`（学园偶像大师 / gakumasu）。
2. 阅读对应领域 README，确认默认上下文、稳定知识和单次翻译工作目录的使用方式。
   - 学马仕领域入口：`domains/gakumasu/README.md`。
3. 翻译执行时优先加载领域内会直接改变译文的稳定知识。
   - 通常是 `stable/style-guide.md`、`stable/translation-decisions.md`、角色概要、命中的术语和本串相关关系。
4. 调研记录、来源整理和脚本说明只按需查询，不默认塞进翻译上下文。

## 目录导航

```text
ForkTranslation/
├─ README.md          ← 根入口与跨领域约定
├─ domains/           ← 各翻译领域的稳定知识和单次翻译工作目录
│  └─ gakumasu/       ← 学马仕领域
├─ docs/              ← 调研档案、交接记录和归档资料
├─ scripts/           ← 仓库级格式转换、校验等自动化脚本
└─ userscripts/       ← 网页抽取、导出等辅助脚本
```

## 根层约定

- 新增作品、社区或题材时，在 `domains/` 下建立独立领域目录，并提供该领域自己的 `README.md`。
- `domains/<domain>/stable/` 存放可复用的稳定知识；单次翻译才需要的信息放进该领域的 `threads/` 工作目录。
- `docs/` 记录建设过程和调研依据，但不自动视为翻译执行上下文。
- 根 README 不承载具体译名、角色口吻或术语决策；这些内容应下沉到对应领域。
