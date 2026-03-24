# ADR-013: 関連メモリ探索（グラフ探索）

## Status
Accepted

## Context
ADR-012 でキー抽出を実装し、memory_keys テーブルに 1,285 件のキーが格納されている。同じキー（STOCK-6302 等）を共有するメモリ同士は暗黙的にグラフで繋がっている。このグラフを探索して「関連するメモリ」を返せると、チケット単位での議論の全体像が見える。

## Decision
`cc-mem search` に `--related` オプションを追加する。

### 動作
1. 通常の hybridSearch で検索結果を取得
2. 各結果から memory_keys を引く
3. 同じキーを持つ他のメモリを取得（1ホップ探索）
4. 共有キー数でランク付け
5. 検索結果の各エントリに related を付与

### 出力例
```
### #1 [100%] (2026-03-24) session: import_ee583385
**Q:** STOCK-6302 のチケットに取り組んでほしい
**A:** stock_compositions関連のDAO処理をトランザクション管理する...
  [related: STOCK-6302] Q: エラーハンドリングの指摘があった（session: import_ee583385）
  [related: STOCK-6302] Q: スプリントは？（session: import_36b0e27a）
  [related: #2714] Q: main から worktree 作って（session: import_2ccc4963）
```

### SQL
```sql
-- memory_id X の関連メモリを取得
SELECT mk2.memory_id, m.question, m.session_id, mk1.key_value,
       COUNT(*) as shared_keys
FROM memory_keys mk1
JOIN memory_keys mk2 ON mk1.key_value = mk2.key_value
JOIN memories m ON m.id = mk2.memory_id
WHERE mk1.memory_id = ? AND mk2.memory_id != ?
GROUP BY mk2.memory_id
ORDER BY shared_keys DESC
LIMIT ?
```

## Acceptance Criteria
1. `--related` なしの場合は既存動作と同じ
2. `--related` ありの場合、各検索結果に関連メモリが付与される
3. 関連メモリは共有キーの数でランク付け
4. 関連メモリには共有キーの値が表示される
5. 自分自身は関連メモリに含まれない
6. 関連メモリは各結果につき最大3件

## Test Plan
1. 同じキーを持つ3件のメモリを保存 → 1件を検索 → 残り2件が related に
2. キーを共有しないメモリは related に含まれない
3. --related なしでは related が undefined

## Consequences
### メリット
- チケット単位で議論の全体像が芋づる式に引ける
- PR → チケット → 関連 PR のように横断的な文脈が見える
### デメリット
- 追加の DB クエリ（検索結果数 × 1回）
