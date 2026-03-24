# cc-mem

**Claude Code が「昨日の議論」を覚えている世界。**

毎朝セッションを開くたび、同僚が記憶喪失になっている——cc-mem はその問題を解決する。セッション終了時に会話を自動保存し、次のセッションで過去の文脈をシームレスに検索・参照できる長期記憶システム。

```
$ cc-mem search "認証基盤の設計判断"

## Memory Search Results (3件)
---
### #1 [82%] (2026-03-20) session: sess_20260320_143010_1234
**Q:** JWT と セッションベース、どちらにする？
**A:** スケーラビリティとマイクロサービス間の認証を考慮し JWT を採用。
   ただしリフレッシュトークンのローテーションは必須...
```

## Why cc-mem?

Claude Code は強力な開発パートナーだが、セッションが切れると全てを忘れる。CLAUDE.md にルールは書ける。でも「3日前にあの設計を却下した理由」「先週の議論で決めたAPI仕様」は書けない。

cc-mem は **経験の蓄積** を担う。ルールブックではなく、記憶。

## Features

- **Zero effort** — セッション終了時に Hook が自動発火。手動操作なし
- **100% local** — SQLite 1ファイル + Ollama。外部サービス・API 不要
- **Zero token cost** — ルールベースでチャンク化。バックグラウンドでLLMを消費しない
- **Hybrid search** — FTS5 キーワード検索 × ベクトル検索 × RRF で高精度な検索
- **Project scope** — 検索は自動的に現在のプロジェクトにスコープ。`--all` で横断検索も可能
- **Natural decay** — 半減期30日。古い記憶は自然にフェードアウト
- **Smart filtering** — 短文・定型応答を自動除外。「はい」「OK」「ありがとう」のようなノイズは保存しない
- **Deduplication** — 同じ話題を繰り返し聞いても重複は自動スキップ（コサイン類似度 ≥ 0.95）

## How it works

```
Session ends (Stop Hook)
  │
  ├─ Chunk:   会話を Q&A ペアに分割 (rule-based, no LLM)
  ├─ Filter:  短文 (<100字) + 軽量応答 (定型Q&A) を除外
  ├─ Embed:   Ollama でローカルベクトル化
  ├─ Dedup:   既存メモリとの重複チェック (cosine ≥ 0.95)
  └─ Store:   SQLite に保存 (memories + FTS5 index)

Search (manual or CLAUDE.md driven)
  │
  ├─ Scope:   デフォルトで現プロジェクト（--all で横断）
  ├─ Search:  FTS5 trigram + vector cosine similarity
  ├─ Merge:   RRF (Reciprocal Rank Fusion, k=60)
  ├─ Decay:   time decay (half-life: 30 days)
  └─ Return:  上位N件を 0-100% スコア付きで返却
```

## Demo

### 会話を保存する

セッション終了時に自動実行される。手動で試す場合：

```bash
# セッション終了時に自動実行（手動操作不要）
# テスト用に手動実行する場合:
cat session.jsonl | cc-mem save
```

出力例:

```
[cc-mem] 21件中9件を除外 (short: 9)
[cc-mem] 12件のメモリを保存しました (session: sess_20260324_110910_8322)
```

> 21件のQ&Aペアから短文9件を自動除外し、12件の有用な記憶だけを保存。

重複排除の動作:

```
$ echo '...(同じ会話を再投入)...' | cc-mem save

[cc-mem] 1件の重複をスキップ
[cc-mem] 保存するメモリがありません（全て重複）
```

### キーワードで検索する

```bash
$ cc-mem search "React Hook"

## Memory Search Results (2件)
---
### #1 [95%] (2026-03-24) session: sess_20260324_110910_8322
**Q:** ReactのuseStateとは？
**A:** useStateはReactのHookで、関数コンポーネントに状態管理を追加します。
---
### #2 [78%] (2026-03-24) session: sess_20260324_110910_8322
**Q:** useEffectとの違いは？
**A:** useStateは状態の保持と更新、useEffectは副作用の管理です。
```

> スコアは RRF スコアを 0-100% に正規化した値。相対的な関連度を示す。

### 意味で検索する -- キーワードが一致しなくても見つかる

```bash
$ cc-mem search "データベースのパフォーマンス"

## Memory Search Results (2件)
---
### #1 [88%] (2026-03-24) session: sess_20260324_110910_8322
**Q:** SQLiteのWALモードについて教えて
**A:** WAL (Write-Ahead Logging) は読み書きの並行性を向上させるジャーナルモードです...
---
### #2 [65%] (2026-03-24) session: sess_20260324_110910_8322
**Q:** Bunのパフォーマンスの秘密は？
**A:** BunはJavaScriptCoreエンジンを使用し、Zigで実装されています...
```

> 「データベースのパフォーマンス」というキーワードは保存データに含まれていない。ベクトル検索が意味的な類似性を捉えて WAL モードや Bun の性能に関する記憶を引き当てている。

### 前後の文脈つきで検索する

```bash
$ cc-mem search --context "SQLite FTS5"

## Memory Search Results (1件)
---
### #1 [92%] (2026-03-24) session: sess_20260324_110910_8322
  [before] Q: SQLiteのWALモードについて教えて
  [before] A: WAL (Write-Ahead Logging) は読み書きの並行性を向上させる...
**Q:** FTS5のtrigramトークナイザとは？
**A:** trigramは文字列を3文字ずつスライスしてインデックス化する方式で...
  [after] Q: 日本語検索でも使える？
  [after] A: はい、trigram は言語に依存しないため日本語でも問題なく...
```

> `--context` を付けると、同一セッション内の前後の Q&A を表示。議論の流れを把握できる。

### 全プロジェクト横断検索

```bash
$ cc-mem search --all "認証設計"

## Memory Search Results (3件)
...
```

> デフォルトでは現在のプロジェクト（CWD の basename）にスコープされるが、`--all` で全プロジェクトを横断検索できる。

### 過去のセッションログを一括取り込み

```bash
$ cc-mem import --dry-run
Sessions found: 42
Sessions processed: 42
Total saved: 0
Total filtered: 0
Total duplicates: 0

$ cc-mem import
Sessions found: 42
Sessions processed: 42
Total saved: 215
Total filtered: 48
Total duplicates: 3
```

> `~/.claude/projects/` 配下の全セッションログを一括取り込み。重複排除済みなので何度実行しても冪等。

### 実際の Claude Code セッションでの動作

5セッション（合計87,000行）を取り込んだ結果:

- チャンク化: 109 Q&A ペアを抽出
- フィルタ: 24件除外（short: 24）
- 保存: 85件の記憶を蓄積
- DB サイズ: 4.0 KB

### 統計を確認する

```bash
$ cc-mem stats

cc-mem stats
────────────────────────────
Memories:     7
Sessions:     3
With vectors: 7
DB size:      4.0 KB
Oldest:       2026-03-24 01:42:35
Newest:       2026-03-24 01:42:56
DB path:      /Users/yu.oishi/.cc-mem/memory.db
```

## Quick start

```bash
# 前提: Bun + Ollama
brew install oven-sh/bun/bun ollama

# セットアップ
git clone <repo> && cd cc-mem
bun install
ollama pull nomic-embed-text
bun link

# 過去のセッションログを一括取り込み（既存ユーザー向け）
cc-mem import --dry-run   # まずは件数を確認
cc-mem import             # 実行

# Claude Code に Hook を追加 (~/.claude/settings.json)
# → docs/configuration.md を参照
```

詳細は [docs/getting-started.md](docs/getting-started.md) へ。

## cc-mem vs CLAUDE.md

|  | CLAUDE.md | cc-mem |
|---|---|---|
| 役割 | ルールブック | 経験の記憶 |
| 内容 | コーディング規約、技術スタック | 過去の議論、設計判断の経緯 |
| 更新 | 手動 | 自動 |
| 検索 | 全文読み込み | ハイブリッド検索 |
| 例 | 「テストは Jest で書く」 | 「Jest より Vitest を選んだ理由」 |

**CLAUDE.md は「何をすべきか」、cc-mem は「なぜそうなったか」。** 補完関係にある。

## Tech stack

| Component | Technology |
|---|---|
| Runtime | [Bun](https://bun.sh) (TypeScript) |
| Database | SQLite (Bun built-in) + FTS5 trigram |
| Embedding | [Ollama](https://ollama.ai) + nomic-embed-text |
| Search | FTS5 + cosine similarity + RRF |
| Time decay | Half-life 30 days — `0.5^(days/30)` |

**依存パッケージ: 0。** Bun 内蔵の SQLite と Ollama の HTTP API だけで動く。

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `CC_MEM_OLLAMA_URL` | `http://localhost:11434` | Ollama の URL |
| `CC_MEM_EMBED_MODEL` | `nomic-embed-text` | 埋め込みモデル名 |
| `CC_MEM_PROJECT` | CWD の basename | プロジェクトスコープ名（search のデフォルトスコープ） |
| `CC_MEM_MIN_CHUNK_LENGTH` | `100` | 短文フィルタの閾値（文字数） |
| `CC_MEM_DEDUP_THRESHOLD` | `0.95` | 重複排除のコサイン類似度閾値 |

## Documentation

| Doc | Description |
|---|---|
| [Getting Started](docs/getting-started.md) | 5分で動かすクイックスタート |
| [How it Works](docs/how-it-works.md) | 内部アーキテクチャの詳細解説 |
| [Configuration](docs/configuration.md) | Hook・環境変数・CLAUDE.md の設定 |
| [Troubleshooting](docs/troubleshooting.md) | よくあるトラブルと解決方法 |
| [FAQ](docs/faq.md) | よくある質問 |

## Inspired by

[sui-memory](https://zenn.dev/noprogllama/articles/7c24b2c2410213) — Python 版の長期記憶システム。同じ思想を TypeScript + Bun + Ollama でゼロから再実装。

## License

MIT
