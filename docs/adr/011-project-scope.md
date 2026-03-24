# ADR-011: プロジェクトスコープ

## Status
Accepted

## Context
現在は全プロジェクトの記憶が1つの DB に混在している。cc-mem search で stock-api の設計判断を検索すると keiba の記憶がヒットする。recall でも無関係なプロジェクトが表示される。

### 選択肢
1. **プロジェクト別 DB** — `~/.cc-mem/<project>/memory.db`
2. **1DB + project カラム** — memories テーブルに project カラム追加

### 判断
**1DB + project カラム** を採用する。

理由:
- DB を分けると重複排除が DB 間で効かない
- プロジェクト横断検索ができなくなる
- マイグレーションが単純（ALTER TABLE ADD COLUMN）
- gc, export, stats も project フィルタだけで対応可能

## Decision

### 1. memories テーブルに project カラムを追加
```sql
ALTER TABLE memories ADD COLUMN project TEXT DEFAULT '';
```
既存データは `project = ''`（全プロジェクト共通）。

### 2. プロジェクト名の決定方法
- 環境変数 `CLAUDE_PROJECT_DIR`（Claude Code が設定する CWD）から推測
- なければ `process.cwd()` のベースネーム
- `CC_MEM_PROJECT` 環境変数で明示的に上書き可能

### 3. save 時に project を自動設定
- Hook 経由で save が呼ばれる → CWD = プロジェクトルート
- `process.cwd()` のベースネームを project として保存

### 4. search / recall をプロジェクトスコープに
- デフォルトで現在のプロジェクトの記憶のみ検索
- `--all` オプションで全プロジェクト横断検索
- recall も現在のプロジェクトの直近セッションのみ表示

## Acceptance Criteria
1. save 時に project カラムが自動設定される
2. search はデフォルトで現在のプロジェクトのみ検索
3. search --all で全プロジェクト横断検索
4. recall は現在のプロジェクトの直近セッションのみ
5. recall --all で全プロジェクト
6. 既存データ（project=''）は全プロジェクトからアクセス可能
7. DB マイグレーションが自動実行される

## Test Plan
1. 異なる project の Q&A を保存 → project 指定で検索 → 該当プロジェクトのみヒット
2. --all で全プロジェクト検索
3. 既存データ（project=''）が検索にヒットすること
4. recall のプロジェクトスコープ

## Consequences
### メリット
- 検索精度が大幅向上（無関係なプロジェクトの記憶が混ざらない）
- recall が「このプロジェクトの前回」だけになる
- 横断検索も可能（--all）
### デメリット
- マイグレーション必要（既存 DB の ALTER TABLE）
- Hook の CWD に依存（正しくない場合がある）
