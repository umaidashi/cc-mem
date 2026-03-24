# cc-mem

**Claude Code が「昨日の議論」を覚えている世界。**

毎朝セッションを開くたび、同僚が記憶喪失になっている——cc-mem はその問題を解決する。セッション終了時に会話を自動保存し、次のセッションで過去の文脈をシームレスに検索・参照できる長期記憶システム。

```
$ cc-mem search "認証基盤の設計判断"

## Memory Search Results (3件)
---
### #1 [score: 0.0164] (2026-03-20)
Q: JWT と セッションベース、どちらにする？
A: スケーラビリティとマイクロサービス間の認証を考慮し JWT を採用。
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
- **Natural decay** — 半減期30日。古い記憶は自然にフェードアウト

## How it works

```
Session ends (Stop Hook)
  │
  ├─ Chunk:   会話を Q&A ペアに分割 (rule-based, no LLM)
  ├─ Embed:   Ollama でローカルベクトル化
  └─ Store:   SQLite に保存 (memories + FTS5 index)

Next session
  │
  ├─ Search:  FTS5 trigram + vector cosine similarity
  ├─ Merge:   RRF (Reciprocal Rank Fusion, k=60)
  ├─ Decay:   time decay (half-life: 30 days)
  └─ Return:  上位N件をスコア付きで返却
```

## Demo

### 会話を保存する

セッション終了時に自動実行される。手動で試す場合：

```bash
$ echo '{"type":"human","message":{"content":"ReactのuseStateとは？"}}
{"type":"assistant","message":{"content":[{"type":"text","text":"useStateはReactのHookで、関数コンポーネントに状態管理を追加します。"}]}}
{"type":"human","message":{"content":"useEffectとの違いは？"}}
{"type":"assistant","message":{"content":[{"type":"text","text":"useStateは状態の保持と更新、useEffectは副作用の管理です。"}]}}' | cc-mem save

[cc-mem] 2 件のメモリを保存しました (session: sess_20260324_104234_5417)
```

### キーワードで検索する

```bash
$ cc-mem search "React Hook"

## Memory Search Results (2件)
---
### #1 [score: 0.0164] (2026-03-24)
**Q:** ReactのuseStateとは？
**A:** useStateはReactのHookで、関数コンポーネントに状態管理を追加します。
---
### #2 [score: 0.0161] (2026-03-24)
**Q:** useEffectとの違いは？
**A:** useStateは状態の保持と更新、useEffectは副作用の管理です。
```

### 意味で検索する — キーワードが一致しなくても見つかる

```bash
$ cc-mem search "データベースのパフォーマンス"

## Memory Search Results (2件)
---
### #1 [score: 0.0164] (2026-03-24)
**Q:** SQLiteのWALモードについて教えて
**A:** WAL (Write-Ahead Logging) は読み書きの並行性を向上させるジャーナルモードです...
---
### #2 [score: 0.0161] (2026-03-24)
**Q:** Bunのパフォーマンスの秘密は？
**A:** BunはJavaScriptCoreエンジンを使用し、Zigで実装されています...
```

> 「データベースのパフォーマンス」というキーワードは保存データに含まれていない。ベクトル検索が意味的な類似性を捉えて WAL モードや Bun の性能に関する記憶を引き当てている。

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
