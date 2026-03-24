# ADR-010: SessionStart 自動想起

## Status
Accepted

## Context
現在、Claude が過去の記憶を参照するには CLAUDE.md に「cc-mem search を使え」と書いておき、Claude が自律的に検索する必要がある。しかし実際にはClaude が自発的に検索しないことが多い。

セッション開始時に自動で関連記憶を注入できれば、「前回の続き」が自然に始まる。

## Decision
`cc-mem recall` コマンドを追加し、SessionStart Hook で自動実行する。

### 動作
1. SessionStart Hook が発火
2. `cc-mem recall` が実行される
3. 直近のセッション情報（プロジェクトパス等）をもとに関連記憶を検索
4. 結果を stdout に出力（Claude のコンテキストに注入される）

### recall のロジック
- 直近 N セッション（デフォルト3）の Q&A サマリを取得
- 各セッションの最初と最後の Q を表示（何をやっていたかの概要）
- 出力は Markdown 形式で、Claude が読みやすい形

### 出力例
```markdown
## Recent Memory (cc-mem)

### Session: sess_20260324_110910 (2026-03-24, 12 memories)
- Started with: ReactのuseStateとは？
- Ended with: カスタムHookの作り方は？

### Session: sess_20260323_150000 (2026-03-23, 8 memories)
- Started with: SQLiteのWALモードについて
- Ended with: FTS5 trigram の設定方法

> 過去の記憶を詳しく検索: `cc-mem search "クエリ"`
```

### Hook 設定
```json
{
  "SessionStart": [
    {
      "matcher": "",
      "hooks": [
        {
          "type": "command",
          "command": "cc-mem recall"
        }
      ]
    }
  ]
}
```

## Acceptance Criteria
1. `cc-mem recall` で直近3セッションの概要が stdout に出力される
2. 各セッションに開始Q・終了Q・日付・メモリ件数が含まれる
3. `--last N` で表示セッション数を変更可能
4. メモリが0件の場合は何も出力しない（新規ユーザー）
5. 出力は Markdown 形式
6. 100ms 以内に応答（embedding 不使用、DBクエリのみ）

## Test Plan
1. テスト用DBに複数セッションのデータをINSERT → recall の出力を検証
2. 空DB → 空文字列
3. --last 1 → 1セッションのみ

## Consequences
### メリット
- セッション開始時に自動で前回の文脈が見える
- Claude が自発的に検索しなくても文脈が維持される
- embedding 不使用なので高速
### デメリット
- 毎セッション開始時にトークンを消費（直近3セッション分）
- 不要な場合もある（新しい話題を始めたいとき）
