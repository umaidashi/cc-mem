# クイックスタートガイド

cc-mem を導入して、Claude Code に長期記憶を持たせるまでの手順です。所要時間は約5分です。

## 前提条件

| ソフトウェア | 用途 |
|---|---|
| macOS (Apple Silicon / Intel) | 動作環境 |
| [Homebrew](https://brew.sh/) | パッケージ管理 |
| [Claude Code](https://docs.anthropic.com/en/docs/claude-code) | 対象のCLIツール |

## 1. 依存ツールのインストール

```bash
# Bun (TypeScript ランタイム)
brew install oven-sh/bun/bun

# Ollama (ローカル embedding 生成)
brew install ollama
```

## 2. cc-mem のセットアップ

```bash
# リポジトリをクローン
git clone <repository-url> /path/to/cc-mem
cd /path/to/cc-mem

# 依存パッケージをインストール
bun install

# embedding 用モデルをダウンロード (約274MB)
ollama pull nomic-embed-text

# グローバル CLI として登録
bun link
```

`bun link` が成功すると、どのディレクトリからでも `cc-mem` コマンドが使えるようになります。

## 3. Ollama を起動

```bash
ollama serve
```

バックグラウンドで動かしておく必要があります。別のターミナルで起動するか、`ollama serve &` としてください。

> **Note:** Ollama が起動していなくても cc-mem は動作します。その場合、ベクトル検索が使えず FTS5（全文検索）のみになります。

## 4. 過去のセッションログを取り込み（既存ユーザー向け）

既に Claude Code を使っている場合、`~/.claude/projects/` に蓄積されたセッションログを一括取り込みできます。

```bash
# まずは件数を確認（実際には保存しない）
cc-mem import --dry-run

# 一括取り込みを実行
cc-mem import
```

重複排除済みなので何度実行しても冪等です。特定プロジェクトだけ取り込みたい場合は `--project <name>` を指定できます。

## 5. Claude Code の Hook を設定

`~/.claude/settings.json` を編集して、SessionStart Hook（recall）と Stop Hook（save）を追加します。

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

- **SessionStart Hook:** セッション開始時に `cc-mem recall` を実行し、直近3セッションの概要を自動表示する
- **Stop Hook:** セッション終了時に会話を自動保存する

既に `settings.json` に他の設定がある場合は、各配列に上記オブジェクトを追加してください。詳しくは [設定リファレンス](./configuration.md) を参照してください。

## 6. CLAUDE.md に検索方法を記載

cc-mem を活用したいプロジェクトの `CLAUDE.md` に以下を追記します。

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

サンプルファイル `CLAUDE.md.example` がリポジトリに同梱されています。

## 7. 動作確認

### 保存テスト

```bash
echo '{"type":"human","message":{"content":"テスト質問"}}
{"type":"assistant","message":{"content":"テスト回答"}}' | cc-mem save
```

`[cc-mem] 1 件のメモリを保存しました` と表示されれば成功です。

### 検索テスト

```bash
cc-mem search "テスト"
```

先ほど保存した内容がヒットすれば、セットアップ完了です。

### 統計確認

```bash
cc-mem stats
```

保存件数やDB容量を確認できます。

## 次のステップ

- [仕組みの詳細](./how-it-works.md) -- save/search の内部動作を理解する
- [設定リファレンス](./configuration.md) -- 環境変数やHookの詳細設定
- [トラブルシューティング](./troubleshooting.md) -- 問題が起きたとき
