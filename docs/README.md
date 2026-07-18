# Docs

`docs/` 保存项目建设过程中的依据材料，不作为默认执行入口。新会话如果要开始实际工作，优先从根 [README.md](../README.md)、对应领域 README、`workflows/` 或 `scripts/` 的 README 进入。

## 目录

- `research/`：调研记录、历史结论、API 边界和方案探索。用于追溯为什么这么做，不直接当作操作手册。
- `design/`：已经落地或曾经落地的架构设计、跨工具工作流设计。
- `handoff/`：一次会话到下一次会话的交接记录。仅在续接对应旧任务时读取。

可复用执行流程应放到根 `workflows/`、领域内 `domains/<domain>/workflows/`，或脚本旁边的 `RUNBOOK.md`。
