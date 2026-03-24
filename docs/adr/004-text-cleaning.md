# ADR-004: テキストクリーニング

## Status
Accepted

## Context
実際の Claude Code セッションログを取り込んだところ、Q（質問）テキストに以下のノイズが混入していることが判明した:

1. `[Request interrupted by user]` — ユーザーが送信を中断した際のマーカー（Q に6件）
2. `<task-notification>...</task-notification>` — タスク完了通知の XML（Q に5件）
3. `<system-reminder>...</system-reminder>` — システムリマインダーの XML（Q に混入の可能性）
4. `<local-command-caveat>...</local-command-caveat>` — ローカルコマンド実行時の注意文
5. tool_use_id (`toolu_xxx`) や agent_id (`agent-xxx`) などの内部ID

これらは Claude Code のプロトコル上のメタデータであり、ユーザーの意図や議論の内容ではない。保存するとベクトル化の精度が下がり、検索結果のノイズになる。

## Decision
- chunker でテキスト抽出した後、保存前にクリーニング処理を適用する
- クリーニングは `src/chunker/index.ts` の extractText 後段に組み込む
- 以下のルールを適用:
  1. `[Request interrupted by user]` を除去
  2. `<tag-name>...</tag-name>` 形式の XML ブロックを除去（system-reminder, task-notification, local-command-caveat 等）
  3. 自己閉じ XML タグ `<tag-name ... />` も除去
  4. クリーニング後のテキストを trim し、空になった場合はそのメッセージをスキップ

## Acceptance Criteria
1. `[Request interrupted by user]` が Q から除去される
2. `<task-notification>...(複数行)...</task-notification>` が Q から除去される
3. `<system-reminder>...(複数行)...</system-reminder>` が Q から除去される
4. `<local-command-caveat>...</local-command-caveat>` が Q から除去される
5. XML タグ除去後も通常のテキスト部分は保持される（例: `[Request interrupted by user]\n本当の質問` → `本当の質問`）
6. クリーニング後に空になったメッセージはスキップされる
7. A（回答）テキストにもクリーニングが適用される（現時点では該当なしだが将来に備える）
8. 通常のテキスト（XMLタグや特殊マーカーを含まない）は変更されない

## Test Plan
1. `[Request interrupted by user]` 除去テスト
2. 複数行 XML ブロック除去テスト
3. 混在テスト: `[Request interrupted by user]\n実際の質問テキスト` → `実際の質問テキスト`
4. 通常テキストの無変更テスト
5. クリーニング後の空テキストスキップテスト
6. chunkTranscript の統合テスト（ノイズ入り JSONL → クリーンな Q&A）

## Consequences

### メリット
- ベクトル化の精度が向上（ノイズがない純粋なテキストで embedding を計算）
- 検索結果の可読性が向上
- 実データでの保存品質が大幅に改善

### デメリット
- 正規表現によるクリーニングで、ユーザーが意図的に書いた XML 風テキストが除去される可能性（極めて稀）
