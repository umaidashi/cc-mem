# 設定リファレンス

cc-mem の設定方法をまとめたリファレンスです。

---

## Claude Code Hook の設定

### settings.json の場所

```
~/.claude/settings.json
```

### 基本設定

SessionStart Hook に recall、Stop Hook に save を登録します。

```json
{
  "hooks": {
    "SessionStart": [
      {
        "matcher": "",
        "command": "cc-mem recall 2>/dev/null"
      }
    ],
    "Stop": [
      {
        "matcher": "",
        "command": "echo \"$CLAUDE_CONVERSATION\" | cc-mem save 2>/dev/null &"
      }
    ]
  }
}
```

**各 Hook の役割:**

| Hook | コマンド | 説明 |
|---|---|---|
| `SessionStart` | `cc-mem recall` | セッション開始時に直近3セッションの概要を自動表示 |
| `Stop` | `cc-mem save` | レスポンス生成完了時に会話を自動保存 |

**各フィールドの意味:**

| フィールド | 説明 |
|---|---|
| `matcher` | 空文字列 = 全てのレスポンスで発火。正規表現でフィルタも可能 |
| `command` | 実行されるシェルコマンド |

**コマンドのポイント:**

- `$CLAUDE_CONVERSATION` -- Claude Code が自動的にセットする環境変数。セッションの会話内容が JSON 形式で格納される
- `2>/dev/null` -- stderr を抑制（保存ログが Claude Code の出力に混ざるのを防ぐ）
- `&` -- バックグラウンド実行（Claude Code の応答をブロックしない。save のみ）

### 既存の Hook がある場合

`settings.json` に既に他の Hook が設定されている場合は、各配列に追加します。

```json
{
  "hooks": {
    "SessionStart": [
      {
        "matcher": "",
        "command": "cc-mem recall 2>/dev/null"
      }
    ],
    "Stop": [
      {
        "matcher": "",
        "command": "existing-command"
      },
      {
        "matcher": "",
        "command": "echo \"$CLAUDE_CONVERSATION\" | cc-mem save 2>/dev/null &"
      }
    ]
  }
}
```

### hooks 以外の設定がある場合

`settings.json` に hooks 以外のキーが既にある場合も、`hooks` キーを追加するだけです。

```json
{
  "permissions": {
    "allow": ["Bash(*)"]
  },
  "hooks": {
    "SessionStart": [
      {
        "matcher": "",
        "command": "cc-mem recall 2>/dev/null"
      }
    ],
    "Stop": [
      {
        "matcher": "",
        "command": "echo \"$CLAUDE_CONVERSATION\" | cc-mem save 2>/dev/null &"
      }
    ]
  }
}
```

---

## CLAUDE.md の設定

各プロジェクトの `CLAUDE.md` に cc-mem の使い方を記載すると、Claude Code が自律的に過去の記憶を検索するようになります。

### 推奨テンプレート

リポジトリに同梱されている `CLAUDE.md.example` をベースに記載してください。

```markdown
## Long-term Memory (cc-mem)

このプロジェクトには長期記憶システム cc-mem が導入されています。

### 過去の記憶を検索する
過去のセッションで議論した内容を思い出す必要がある場合:
```bash
cc-mem search "検索クエリ"
```

- 設計判断の経緯を思い出したいとき
- 以前却下した案の理由を確認したいとき
- 過去の議論の文脈を参照したいとき

積極的に活用してください。
```

### 記載のポイント

- **具体的なユースケースを書く** -- 「いつ検索すべきか」を明示することで、Claude Code が適切なタイミングで記憶を参照する
- **「積極的に活用してください」と促す** -- 明示的に指示しないと、Claude Code は cc-mem を使わない傾向がある
- **プロジェクト固有の文脈を追加する** -- 例えば「このプロジェクトのアーキテクチャ決定は cc-mem に記録されています」など

### グローバル vs プロジェクトローカル

| ファイル | スコープ | 用途 |
|---|---|---|
| `~/.claude/CLAUDE.md` | 全プロジェクト共通 | 全プロジェクトで cc-mem を使いたい場合 |
| `{project}/CLAUDE.md` | プロジェクト固有 | 特定のプロジェクトだけで使いたい場合 |

---

## 環境変数

| 変数名 | デフォルト値 | 説明 |
|---|---|---|
| `CC_MEM_OLLAMA_URL` | `http://localhost:11434` | Ollama の API エンドポイント |
| `CC_MEM_EMBED_MODEL` | `nomic-embed-text` | embedding に使用する Ollama モデル |
| `CC_MEM_PROJECT` | CWD の basename | プロジェクトスコープ名。search/recall のデフォルトスコープを上書き |
| `CC_MEM_MIN_CHUNK_LENGTH` | `100` | 短文フィルタの閾値（Q+A の合計文字数がこの値未満のチャンクを除外） |
| `CC_MEM_DEDUP_THRESHOLD` | `0.95` | 重複排除の閾値（既存メモリとのコサイン類似度がこの値以上なら保存をスキップ） |

### 環境変数の設定例

シェルの設定ファイル (`~/.zshrc` など) に追記します。

```bash
# Ollama を別ポートで起動している場合
export CC_MEM_OLLAMA_URL="http://localhost:11435"

# 別の embedding モデルを使う場合
export CC_MEM_EMBED_MODEL="mxbai-embed-large"

# プロジェクト名を明示的に指定する場合（monorepo 等で CWD の basename が不適切なとき）
export CC_MEM_PROJECT="my-service"

# 短文フィルタの閾値を下げる（より短い会話も保存する）
export CC_MEM_MIN_CHUNK_LENGTH=50

# 重複排除を厳しくする（より多くのチャンクを保存する）
export CC_MEM_DEDUP_THRESHOLD=0.98
```

> **Note:** embedding モデルを変更した場合、既存のベクトルとの互換性はありません。既存データの検索精度が低下する可能性があります。

---

## データベースの場所

```
~/.cc-mem/memory.db
```

データベースの場所は現時点では固定です。初回実行時に `~/.cc-mem/` ディレクトリとデータベースファイルが自動作成されます。

---

## CLI コマンド一覧

```bash
cc-mem save                        # stdin から会話保存（Stop Hook で自動実行）
cc-mem search <query>              # 記憶検索（デフォルト: 現プロジェクト、5件）
cc-mem search --all <query>        # 全プロジェクト横断検索
cc-mem search --context <query>    # 前後の会話つき検索
cc-mem search --limit N <query>    # 件数指定
cc-mem import                      # 一括取り込み（~/.claude/projects/ から）
cc-mem import --dry-run            # 取り込み件数の確認のみ
cc-mem import --project <name>     # 特定プロジェクトのみ取り込み
cc-mem recall                      # 直近3セッション概要（SessionStart Hook で自動実行）
cc-mem recall --last N             # 表示セッション数を指定
cc-mem recall --all                # 全プロジェクトのセッションを表示
cc-mem log                         # セッション履歴一覧（デフォルト: 10件）
cc-mem log --last N                # 表示件数を指定
cc-mem gc                          # 古いメモリ削除（デフォルト: 90日以上）
cc-mem gc --older-than 60d         # 日数指定
cc-mem gc --session <id>           # 特定セッション削除
cc-mem gc --dry-run                # 削除件数の確認のみ
cc-mem export                      # JSON エクスポート
cc-mem export --session <id>       # 特定セッションのみ
cc-mem stats                       # 統計情報を表示
cc-mem --help                      # ヘルプを表示
cc-mem --version                   # バージョンを表示
```
