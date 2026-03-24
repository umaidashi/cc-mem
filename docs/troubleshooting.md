# トラブルシューティング

cc-mem でよくあるトラブルとその解決方法です。

---

## Ollama 関連

### Ollama に接続できない

**症状:**
```
[cc-mem] embedding に失敗しました。embedding なしで保存します:
Ollama に接続できません (http://localhost:11434)
```

**原因:** Ollama が起動していない。

**解決方法:**
```bash
# Ollama を起動
ollama serve

# バックグラウンドで起動する場合
ollama serve &
```

macOS で Ollama.app をインストールしている場合は、アプリケーションを起動してください。

> **Note:** Ollama が未起動でも cc-mem save 自体は成功します。embedding なし（`null`）で保存され、FTS5 全文検索のみが利用可能になります。Ollama を後から起動しても、既に保存済みのデータにベクトルは付与されません。

### モデルが見つからない

**症状:**
```
Ollama embedding API がエラーを返しました (HTTP 404)
```

**原因:** embedding モデルがダウンロードされていない。

**解決方法:**
```bash
ollama pull nomic-embed-text
```

カスタムモデルを使用している場合は、環境変数 `CC_MEM_EMBED_MODEL` に指定したモデル名が正しいか確認してください。

---

## bun link 関連

### bun link できない / cc-mem コマンドが見つからない

**症状:**
```bash
$ cc-mem --version
zsh: command not found: cc-mem
```

**解決方法:**

1. `bun link` を cc-mem のプロジェクトディレクトリで実行しているか確認:
```bash
cd /path/to/cc-mem
bun link
```

2. Bun のグローバル bin ディレクトリが PATH に含まれているか確認:
```bash
# Bun のパスを確認
echo $BUN_INSTALL

# ~/.zshrc に追記 (未設定の場合)
export BUN_INSTALL="$HOME/.bun"
export PATH="$BUN_INSTALL/bin:$PATH"
```

3. シェルを再起動:
```bash
source ~/.zshrc
```

### bun install に失敗する

**症状:**
```
error: could not resolve ...
```

**解決方法:**
```bash
# lockfile を削除して再試行
rm bun.lockb
bun install
```

---

## 検索関連

### 検索結果が出ない

**症状:**
```
No memories found for: "検索クエリ"
```

**考えられる原因と対処:**

1. **データがまだ保存されていない**
   ```bash
   cc-mem stats
   # Memories: 0 の場合、まだ何も保存されていない
   ```

2. **クエリが短すぎる (3文字未満)**
   FTS5 trigram トークナイザは最低3文字のクエリが必要です。短いクエリは FTS 検索がスキップされます。
   ```bash
   # NG
   cc-mem search "DB"

   # OK
   cc-mem search "データベース"
   ```

3. **Ollama が未起動でベクトル検索ができない**
   embedding なしで保存されたデータは FTS5 でのみ検索されます。Ollama を起動していても、保存時に embedding が付与されていなければベクトル検索の対象になりません。

4. **時間減衰でスコアが低くなっている**
   30日を半減期として古い記憶のスコアが下がります。`--limit` を増やして試してください:
   ```bash
   cc-mem search --limit 20 "検索クエリ"
   ```

### 検索精度が悪い

**対処法:**

- クエリを具体的にする: 「設計」より「APIのエラーハンドリング設計」の方が精度が上がる
- 日本語と英語を混ぜて試す: FTS5 は trigram なので、キーワードの表記揺れに弱い
- Ollama を起動して保存し直す: ベクトル検索が有効になると意味的な類似度で検索できる

### 保存件数が少なすぎる

**症状:** 会話しているのに `cc-mem stats` の件数が増えない、または期待より少ない。

**考えられる原因と対処:**

1. **短文フィルタの閾値が高すぎる**
   デフォルトでは Q+A 合計100文字未満のチャンクが除外されます。短い会話が多い場合は閾値を下げてみてください:
   ```bash
   export CC_MEM_MIN_CHUNK_LENGTH=50
   ```

2. **軽量応答フィルタで除外されている**
   Q と A の両方が定型パターン（「OK」「了解しました」等）に一致するチャンクは除外されます。Q が充実していれば保存されるため、通常は問題になりません。

3. **重複排除で除外されている**
   同じ内容のチャンクがすでに保存されている場合はスキップされます。これは正常な動作です。

### 重複排除が効きすぎる

**症状:** 似ているが異なる内容の会話が保存されない。

**原因:** 重複排除の閾値（デフォルト 0.95）が低すぎる可能性があります。

**解決方法:** 閾値を上げる（厳しくする）と、より多くのチャンクが保存されます:
```bash
export CC_MEM_DEDUP_THRESHOLD=0.98
```

閾値を `1.0` にすると、完全一致のみスキップします（事実上の無効化）。

---

## Hook 関連

### Hook が発火しない

**症状:** Claude Code を使っても cc-mem にデータが保存されない。

**確認手順:**

1. **settings.json の構文を確認**
   ```bash
   # JSON として valid か確認
   cat ~/.claude/settings.json | python3 -m json.tool
   ```
   JSON にエラーがある場合、Hook 全体が無視されます。

2. **Hook の設定場所を確認**
   Hook は `hooks.Stop` 配列内に設定する必要があります:
   ```json
   {
     "hooks": {
       "Stop": [
         {
           "matcher": "",
           "command": "echo \"$CLAUDE_CONVERSATION\" | cc-mem save 2>/dev/null &"
         }
       ]
     }
   }
   ```

3. **cc-mem コマンドのパスを確認**
   Hook はシェルのサブプロセスで実行されるため、PATH が通っていない可能性があります:
   ```bash
   which cc-mem
   ```
   見つからない場合はフルパスを指定してください:
   ```json
   {
     "command": "echo \"$CLAUDE_CONVERSATION\" | /path/to/cc-mem save 2>/dev/null &"
   }
   ```

4. **手動で Hook コマンドをテスト**
   ```bash
   echo '{"type":"human","message":{"content":"test"}}
   {"type":"assistant","message":{"content":"reply"}}' | cc-mem save
   ```
   このコマンドが成功すれば、cc-mem 自体は正常です。

### 保存されるが stderr のログが Claude Code に表示される

**原因:** `2>/dev/null` が抜けている。

**解決方法:** コマンドの末尾に `2>/dev/null &` を追加してください。

---

## データベース関連

### DB ファイルを削除したい (リセット)

```bash
rm ~/.cc-mem/memory.db
rm -f ~/.cc-mem/memory.db-wal
rm -f ~/.cc-mem/memory.db-shm
```

次回 cc-mem を実行した際に、空のデータベースが自動作成されます。

### DB が破損した

WAL モードで運用しているため、通常は破損しにくい構成です。万が一破損した場合は、上記の手順でリセットしてください。

---

## その他

### Bun のバージョンが古い

cc-mem は Bun の `bun:sqlite` モジュールを使用しています。古いバージョンでは動作しない可能性があります。

```bash
bun --version
# 1.0 以上を推奨

# アップデート
brew upgrade oven-sh/bun/bun
```
