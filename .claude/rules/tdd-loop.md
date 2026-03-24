---
description: cc-mem の改善・機能追加時の開発プロセス
globs: ["src/**", "tests/**"]
---

# TDD 改善ループ

cc-mem の改善・機能追加は以下のループで行う:

1. **ADR 策定** — `docs/adr/NNN-title.md` に意思決定を記録
   - Context, Decision, Acceptance Criteria, Test Plan, Consequences を含める
2. **受け入れテスト作成 (Red)** — `tests/` に ADR の Acceptance Criteria をコードに落とす
   - `bun test` で全件 FAIL を確認
3. **実装 (Green)** — テストが PASS するように実装
   - `bun test` で全件 PASS を確認
4. **実データ検証** — 実際の Claude Code セッションログで動作確認
5. **TODO.md 更新** — 完了項目にチェック

## 注意

- テストは `import { describe, test, expect } from "bun:test"` を使う
- Ollama 依存テストは `describe.skip` でスキップ可能にする
- 実装前にテストを書く。実装とテストを同時に書かない
- 既存テストのリグレッションを必ず確認する（`bun test tests/`）
