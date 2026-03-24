---
description: Claude Code の transcript (JSONL) フォーマットに関する知見
globs: ["src/chunker/**"]
---

# Claude Code Transcript フォーマット

## 実際のフォーマット（公式ドキュメントと異なる点あり）

- ユーザーメッセージの type は `"user"`（`"human"` ではない）
- assistant の content は配列: `[{type: "text", text: "..."}, {type: "tool_use", ...}, {type: "thinking", ...}]`
- user の content は string の場合が多い
- その他の type: `progress`, `system`, `file-history-snapshot`, `queue-operation`, `pr-link`

## ノイズパターン（クリーニングが必要）

以下は Claude Code のプロトコル上のメタデータで、ユーザーの意図ではない:

- `[Request interrupted by user]` および `[Request interrupted by user for tool use]`
- `<system-reminder>...</system-reminder>`
- `<task-notification>...</task-notification>`
- `<local-command-caveat>...</local-command-caveat>`

これらは `cleanText()` で除去済み。新しいパターンが見つかったら追加すること。
