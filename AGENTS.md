# Agent Instructions

This repository is a translation workflow repository. Before translating or editing any domain work product, read the root `README.md`, then the relevant `domains/<domain>/README.md`, then the relevant domain workflow.

Agent-only helper tools live in `tools/`; read `tools/README.md` before doing A/B/C cross-checking, floor extraction, or other agent-side review automation. Keep user-facing workflow scripts in `scripts/`.

## Hard Stop: Long Translation Checkpoints

For any long `translation-B.md` work, do not translate the whole file in one pass unless the user explicitly asks for a full one-pass translation.

- Translate only about 1000-2000 Chinese characters at a time.
- Stop only at a complete source post/floor; never stop in the middle of one post.
- After each checkpoint, pause and ask the user to audit or edit the style.
- Treat the user's edits as the style sample for the next checkpoint.
- If the user says "continue", continue only to the next checkpoint, not to the end of the file.

This checkpoint rule overrides the general impulse to complete the whole translation end to end.

## Checkpoint Pause Message

When stopping for user audit, use a short formatted message instead of a vague "please review":

```markdown
**Checkpoint**
- 已完成：`<file>` 到 `<post/floor range>`，约 `<N>` 字中文译文。
- 请你做：审校这段的文风、句式密度、修辞强度、称呼和角色口吻；可以直接改文件，也可以只指出问题。
- 你回复：说“继续”表示按当前风格推进到下一个 checkpoint；贴修改意见则先按你的意见回修。
- 后续工作：我会吸收你的审校风格，继续下一段；B 审定后才进入 C/D 字幕。
```

Keep the message concise and update the file/range/status fields accurately.
