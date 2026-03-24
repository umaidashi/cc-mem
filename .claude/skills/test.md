---
description: cc-mem の全テストを実行し、結果をレポートする
user_invocable: true
---

# /test — テスト実行

## 手順

1. 全テスト実行: `bun test tests/`
2. 結果サマリを表示（pass/fail/skip）
3. FAIL がある場合は原因を調査

## テストファイル一覧
- `tests/filter.test.ts` — ADR-001/002: 短文・軽量応答フィルタ
- `tests/dedup.test.ts` — ADR-003: 重複排除
- `tests/cleaning.test.ts` — ADR-004: テキストクリーニング

## 注意
- Ollama 未起動時は dedup テストの一部が skip される（正常動作）
- テスト追加時は既存テストのリグレッションを必ず確認
