# ADR-005: cc-mem import コマンド

## Status
Accepted

## Context
cc-mem は Stop Hook でセッション終了時に自動保存するが、Hook 導入以前のセッションログは取り込まれていない。`~/.claude/projects/` に260セッション分のログがあるが、手動で1つずつ `cat | cc-mem save` するのは非現実的。

## Decision
`cc-mem import` コマンドを追加する。

### 基本動作
- `~/.claude/projects/` 配下の全 `.jsonl` ファイルを走査
- `subagents/` ディレクトリ内のファイルは除外
- 各ファイルを `cc-mem save` と同じパイプライン（chunk → filter → embed → dedup → store）で処理
- 重複排除が効くので、何度実行しても安全（冪等）

### オプション
- `--dry-run`: 実際には保存せず、何件取り込まれるか表示
- `--project <name>`: プロジェクト名（部分一致）でフィルタ
- `--verbose`: 各ファイルの処理結果を表示

### 出力（stderr）
```
[cc-mem import] 260 sessions found
[cc-mem import] Processing: stock-api/ee583385.jsonl ...
[cc-mem import] 21 chunks → 9 filtered → 12 saved (0 duplicates)
...
[cc-mem import] Complete: 180 memories saved from 260 sessions (45 filtered, 12 duplicates)
```

## Acceptance Criteria
1. `cc-mem import` で `~/.claude/projects/` 配下の全セッションログを取り込む
2. `subagents/` 内のファイルは除外される
3. `--dry-run` で保存せずに件数のみ表示
4. `--project stock-api` でプロジェクト名フィルタ
5. 重複排除により何度実行しても結果が同じ（冪等）
6. 処理結果のサマリが stderr に表示される
7. Ollama 未起動でも動作する（embedding なしで保存）

## Test Plan
1. テスト用ディレクトリに JSONL ファイルを配置して import を実行
2. subagents/ 内のファイルが除外されることを確認
3. --dry-run で DB に書き込まれないことを確認
4. --project フィルタが部分一致で動作することを確認
5. 2回実行して2回目は重複スキップされることを確認

## Consequences
### メリット
- 過去の全セッションを一括で記憶に取り込める
- 冪等なので安心して再実行可能
### デメリット
- 260セッション × embedding で初回実行に時間がかかる（数分〜）
