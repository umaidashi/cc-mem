# ADR-012: キー自動抽出とキーベース検索

## Status
Accepted

## Context
会話には STOCK-6302, PR #2714, GitHub URL 等の識別子が頻出する（JIRA 202種/1,150件、PR 78種/598件）。現在のハイブリッド検索（FTS5 trigram + ベクトル）はこれらを「テキストの一部」として扱うが、キーは完全一致で引きたいもの。

## Decision
### 1. memory_keys テーブルを追加
```sql
CREATE TABLE memory_keys (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  memory_id INTEGER NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
  key_type TEXT NOT NULL,  -- 'jira', 'pr', 'github_pr', 'github_issue', 'confluence'
  key_value TEXT NOT NULL  -- 'STOCK-6302', '#2714', etc.
);
CREATE INDEX idx_memory_keys_value ON memory_keys(key_value);
CREATE INDEX idx_memory_keys_type ON memory_keys(key_type);
```

### 2. 保存時にキーを自動抽出
pipeline.ts の processSave 内で、各 Q&A チャンクから正規表現でキーを抽出し memory_keys に INSERT。

抽出パターン:
- JIRA: `[A-Z]{2,}-\d+` (STOCK-6302)
- PR: `#\d{3,}` (#2714)
- GitHub PR: `github.com/.+/pull/\d+`
- GitHub Issue: `github.com/.+/issues/\d+`
- Jira URL: `atlassian.net/browse/[A-Z]+-\d+`
- Confluence: `atlassian.net/wiki/\S+`

### 3. 検索時のキー検出
search のクエリが キーパターンに一致する場合、通常のハイブリッド検索の前に memory_keys から完全一致で候補を取得し、スコアをブーストする。

## Acceptance Criteria
1. save 時に Q&A からキーが自動抽出され memory_keys に保存される
2. `cc-mem search "STOCK-6302"` でそのチケットに関する Q&A が上位にヒット
3. `cc-mem search "#2714"` で PR に関する Q&A が上位にヒット
4. キーが含まれない通常クエリは従来通りハイブリッド検索
5. 既存データの再 import でキーが抽出される

## Consequences
### メリット
- チケット番号やPR番号でピンポイント検索可能
- 同一チケットに関する議論をグルーピングできる
### デメリット
- memory_keys テーブル追加（マイグレーション）
- 保存時の処理が若干増える
