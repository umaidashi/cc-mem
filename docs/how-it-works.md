# 仕組みの詳細

cc-mem の save と search がどのように動作するかを解説します。

## 全体アーキテクチャ

```
  Claude Code セッション
         |
         | Stop Hook 発火
         v
  ┌──────────────────────────────────────────────────┐
  │  echo "$CLAUDE_CONVERSATION" | cc-mem save       │
  └──────────────────────────────────────────────────┘
         |
         v
  ┌─────────────┐    ┌─────────────┐    ┌──────────────┐
  │   Chunker   │───>│  Embedder   │───>│   SQLite DB  │
  │ (Q&A分割)   │    │ (Ollama)    │    │ (memories +  │
  │             │    │             │    │  FTS5 index) │
  └─────────────┘    └─────────────┘    └──────────────┘
                                               |
                                               v
                          ┌──────────────────────────────────────┐
                          │          cc-mem search               │
                          │                                      │
                          │  ┌──────────┐    ┌───────────────┐  │
                          │  │  FTS5    │    │ Vector Search │  │
                          │  │ (trigram)│    │ (cosine sim)  │  │
                          │  └────┬─────┘    └──────┬────────┘  │
                          │       │                 │           │
                          │       v                 v           │
                          │    ┌────────────────────────┐      │
                          │    │    RRF (Rank Fusion)   │      │
                          │    └───────────┬────────────┘      │
                          │                │                    │
                          │                v                    │
                          │    ┌────────────────────────┐      │
                          │    │   Time Decay (30日)    │      │
                          │    └───────────┬────────────┘      │
                          │                │                    │
                          │                v                    │
                          │          最終スコア順に出力         │
                          └──────────────────────────────────────┘
```

---

## Save の詳細

### ステップ 1: stdin からの読み取り

Claude Code の Stop Hook が発火すると、環境変数 `$CLAUDE_CONVERSATION` の内容がパイプで `cc-mem save` に渡されます。この内容は JSONL 形式で、各行が1つのメッセージです。

```jsonl
{"type":"system","message":{"content":"You are Claude..."}}
{"type":"human","message":{"content":"SQLiteの全文検索について教えて"}}
{"type":"assistant","message":{"content":"SQLiteにはFTS5という..."}}
{"type":"human","message":{"content":"trigramトークナイザとは？"}}
{"type":"assistant","message":{"content":"trigramは文字列を3文字ずつ..."}}
```

### ステップ 2: Q&A チャンク分割 (Chunker)

JSONL を解析し、human/assistant メッセージを Q&A ペアに分割します。LLM は使わず、ルールベースで処理します。

```
入力メッセージ列:
  [human] [human] [assistant] [human] [assistant]

分割ルール:
  1. human メッセージが連続する場合は結合して1つの Q にする
  2. 直後の assistant メッセージを A にする
  3. assistant が続かない human は破棄する
  4. system メッセージは無視する

結果:
  Chunk 1: Q = human+human, A = assistant
  Chunk 2: Q = human,       A = assistant
```

具体的な処理フロー:

```
  JSONL パース
       |
       v
  type でフィルタ (system を除外)
       |
       v
  content 抽出 (string | text block[] を統一)
       |
       v
  連続 human を結合 + 次の assistant とペアリング
       |
       v
  QAChunk[] を返却
```

`message.content` はテキスト文字列の場合と、`{type: "text", text: "..."}` の配列の場合があり、どちらにも対応しています。

### ステップ 3: ベクトル化 (Embedder)

各チャンクの `question + "\n" + answer` を Ollama の embedding API でベクトル化します。

- モデル: `nomic-embed-text` (768次元)
- バッチ処理: 最大32テキストずつ API に送信
- API エンドポイント: `POST {OLLAMA_URL}/api/embed`

```
  "SQLiteの全文検索について教えて\nSQLiteにはFTS5という..."
       |
       v
  Ollama /api/embed
       |
       v
  Float32Array (768次元ベクトル)
       |
       v
  Buffer に変換して SQLite の BLOB カラムに保存
```

**Ollama が未起動の場合:** エラーをキャッチし、embedding を `null` にして保存を続行します。FTS5 インデックスは常に作成されるため、全文検索は利用可能です。

### ステップ 4: SQLite への保存

1つのトランザクション内で全チャンクを INSERT します。

```sql
INSERT INTO memories (session_id, question, answer, embedding)
VALUES (?, ?, ?, ?)
```

INSERT トリガーにより、FTS5 インデックス (`memories_fts`) にも自動同期されます。

**データベーススキーマ:**

```
memories テーブル
├── id          INTEGER PRIMARY KEY AUTOINCREMENT
├── session_id  TEXT NOT NULL        -- "sess_20250101_120000_1234"
├── question    TEXT NOT NULL        -- human の発言
├── answer      TEXT NOT NULL        -- assistant の発言
├── created_at  TEXT NOT NULL        -- datetime('now')
└── embedding   BLOB                -- Float32Array のバイナリ (nullable)

memories_fts (FTS5 仮想テーブル)
├── question    -- trigram トークナイザでインデックス
└── answer      -- trigram トークナイザでインデックス
```

---

## Search の詳細

検索は FTS5 とベクトル検索のハイブリッドで、RRF (Reciprocal Rank Fusion) でスコアを統合した後、時間減衰を適用します。

### ステップ 1: FTS5 全文検索

SQLite FTS5 の trigram トークナイザを使った全文検索です。

```
  クエリ: "SQLite 全文検索"
       |
       v
  エスケープ: '"SQLite" "全文検索"'  (各トークンを引用符で囲む)
       |
       v
  SELECT rowid, rank FROM memories_fts
  WHERE memories_fts MATCH ?
  ORDER BY rank
       |
       v
  BM25 スコア順の候補リスト
```

**trigram トークナイザの特徴:**
- テキストを3文字ずつスライスしてインデックス化
- 日本語を含む任意の言語に対応（形態素解析不要）
- 部分一致検索が可能
- 最低3文字以上のクエリが必要

### ステップ 2: ベクトル検索

クエリ文字列を Ollama でベクトル化し、保存済みの全ベクトルとコサイン類似度を計算します。

```
  クエリ: "SQLite 全文検索"
       |
       v
  Ollama embed -> queryVec (768次元)
       |
       v
  全 memories の embedding を取得
       |
       v
  各ベクトルとの cosine similarity を計算
       |
       v
  類似度降順でソート
```

**コサイン類似度の計算:**

```
            a . b
cos(a,b) = ─────────
            |a| * |b|
```

### ステップ 3: RRF (Reciprocal Rank Fusion)

FTS5 とベクトル検索の結果を統合します。

```
  FTS5結果:    [docA:rank1, docB:rank2, docC:rank3, ...]
  Vector結果:  [docB:rank1, docD:rank2, docA:rank3, ...]
       |
       v
  RRF スコア = Σ 1/(k + rank)    ※ k = 60

  docA: 1/(60+1) + 1/(60+3) = 0.01639 + 0.01587 = 0.03226
  docB: 1/(60+2) + 1/(60+1) = 0.01613 + 0.01639 = 0.03252
  docC: 1/(60+3)                                 = 0.01587
  docD:            1/(60+2)                      = 0.01613
```

RRF は異なる検索手法のランキングを公平に統合する手法です。パラメータ `k=60` は、上位ランクと下位ランクの差を緩やかにする平滑化定数です。

### ステップ 4: 時間減衰 (Time Decay)

新しい記憶ほど重要視するため、RRF スコアに時間減衰係数を掛けます。

```
                    経過日数 / 30
  decay = (0.5)

  最終スコア = RRF スコア * decay
```

| 経過日数 | 減衰係数 |
|---|---|
| 0日 (今日) | 1.000 |
| 7日 | 0.851 |
| 14日 | 0.724 |
| 30日 | 0.500 |
| 60日 | 0.250 |
| 90日 | 0.125 |

半減期は30日です。30日前の記憶はスコアが半分になり、60日前は1/4になります。

### ベクトル検索が使えない場合

Ollama が未起動でベクトル検索ができない場合、FTS5 の結果のみで RRF が計算されます。FTS5 単独でも trigram インデックスによる検索は十分に機能します。

---

## データの保存先

```
~/.cc-mem/
└── memory.db        -- SQLite データベース (WAL モード)
```

WAL (Write-Ahead Logging) モードにより、読み取りと書き込みの並行処理が可能です。
