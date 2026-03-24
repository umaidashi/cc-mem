# cc-mem

Claude Code の長期記憶システム。TypeScript + Bun + Ollama でローカル完結。

## Tech Stack

- Runtime: Bun (TypeScript)
- DB: SQLite (Bun built-in) + FTS5 trigram
- Embedding: Ollama + nomic-embed-text
- Search: FTS5 + cosine similarity + RRF + time decay (30d half-life)

## Project Structure

```
src/
├── cli/          # CLI コマンド (save, search, import, gc, stats)
├── db/           # SQLite スキーマ (schema.ts)
├── chunker/      # Q&A チャンク化 + テキストクリーニング
├── embedder/     # Ollama embedding API 連携
├── filter/       # 短文・軽量応答フィルタ
├── dedup/        # 重複排除
└── search/       # 複合検索エンジン (FTS5 + vector + RRF)
tests/            # 受け入れテスト (bun test)
docs/adr/         # Architecture Decision Records
```

## Commands

```bash
bun test                           # 全テスト実行
bun test tests/X.ts                # 個別テスト
cc-mem save                        # stdin から会話保存（Hook 自動）
cc-mem search <query>              # 記憶検索（デフォルト: 現プロジェクト）
cc-mem search --all <query>        # 全プロジェクト横断検索
cc-mem search --context <query>    # 前後の会話つき検索
cc-mem search --limit N <query>    # 件数指定
cc-mem import                      # 一括取り込み（--dry-run, --project, --verbose）
cc-mem gc                          # 古いメモリ削除（--older-than, --session, --dry-run）
cc-mem stats                       # 統計表示
```

## Development Rules

- 改善は ADR → 受け入れテスト(Red) → 実装(Green) の TDD ループで行う
- ADR は `docs/adr/NNN-title.md` に配置
- テストは `tests/` に配置、`bun:test` を使用
- 改善ロードマップは `TODO.md` で管理
- Ollama が起動していないとき embedding 関連テストはスキップされる

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `CC_MEM_OLLAMA_URL` | `http://localhost:11434` | Ollama URL |
| `CC_MEM_EMBED_MODEL` | `nomic-embed-text` | Embedding model |
| `CC_MEM_PROJECT` | CWD の basename | プロジェクトスコープ名 |
| `CC_MEM_MIN_CHUNK_LENGTH` | `100` | 短文フィルタ閾値 |
| `CC_MEM_DEDUP_THRESHOLD` | `0.95` | 重複排除閾値 |
