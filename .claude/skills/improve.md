---
description: cc-mem の改善ループを実行する。TODO.md の未完了項目から次の改善を選び、ADR → テスト → 実装 → 検証の TDD ループを回す。
user_invocable: true
---

# /improve — cc-mem 改善ループ

## 手順

1. `TODO.md` を読み、未完了の最優先項目を確認
2. ADR を `docs/adr/NNN-title.md` に作成（Acceptance Criteria 必須）
3. 受け入れテストを `tests/` に作成
4. `bun test` で Red を確認
5. 実装
6. `bun test` で Green を確認（リグレッションも）
7. 実データで検証: `cc-mem save` / `cc-mem search` を実セッションログで実行
8. `TODO.md` の該当項目にチェック

## 実データテスト方法

```bash
# セッションログの取り込み
cat ~/.claude/projects/<project>/<session>.jsonl | cc-mem save

# 検索テスト
cc-mem search "検索クエリ"

# ノイズチェック
cc-mem stats
```

## 注意
- 1ループで1つの改善に集中する
- ADR 番号は連番（現在 004 まで使用済み）
- 並行可能な作業は Agent tool で並行実行
