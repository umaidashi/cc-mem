import { initDb } from "../db/schema";
import { processSave } from "../pipeline";

function generateSessionId(): string {
  const now = new Date();
  const ts = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
    "_",
    String(now.getHours()).padStart(2, "0"),
    String(now.getMinutes()).padStart(2, "0"),
    String(now.getSeconds()).padStart(2, "0"),
  ].join("");
  const rand = String(Math.floor(Math.random() * 10000)).padStart(4, "0");
  return `sess_${ts}_${rand}`;
}

export async function save(): Promise<void> {
  // 1. stdin から全テキストを読み取る
  const input = await Bun.stdin.text();
  if (!input.trim()) {
    console.error("[cc-mem] stdin が空です");
    process.exit(1);
  }

  // 2. セッションID を生成
  const sessionId = generateSessionId();

  // 3. DB 接続
  const db = initDb();

  // 4. パイプライン実行
  const result = await processSave(input, db, sessionId);

  // 5. stderr にログ出力
  if (result.embeddingError) {
    console.error(
      `[cc-mem] embedding に失敗しました。embedding なしで保存します: ${result.embeddingError}`,
    );
  }

  if (result.saved === 0 && result.filtered === 0 && result.duplicates === 0) {
    console.error("[cc-mem] 保存するメモリがありません");
    return;
  }

  if (result.filtered > 0) {
    const reasons = [...result.filterReasons.entries()]
      .map(([k, v]) => `${k}: ${v}`)
      .join(", ");
    console.error(
      `[cc-mem] ${result.filtered + result.saved + result.duplicates}件中${result.filtered}件を除外 (${reasons})`,
    );
  }

  if (result.duplicates > 0 && result.saved === 0) {
    console.error("[cc-mem] 保存するメモリがありません（全て重複）");
    return;
  }

  if (result.duplicates > 0) {
    console.error(
      `[cc-mem] ${result.duplicates}件の重複をスキップ`,
    );
  }

  if (result.saved > 0) {
    console.error(
      `[cc-mem] ${result.saved}件のメモリを保存しました (session: ${result.sessionId})`,
    );
  }
}
