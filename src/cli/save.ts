import { chunkTranscript } from "../chunker";
import { initDb } from "../db/schema";
import { embedBatch, vectorToBuffer } from "../embedder";
import { filterChunks } from "../filter";
import { dedup } from "../dedup";

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

  // 3. chunkTranscript() でQ&Aチャンクに分割
  const rawChunks = chunkTranscript(input);

  if (rawChunks.length === 0) {
    console.error("[cc-mem] 保存するメモリがありません");
    return;
  }

  // 4. フィルタリング（短文 + 軽量応答を除外）
  const filterResult = filterChunks(rawChunks);

  if (filterResult.filtered > 0) {
    const reasons = [...filterResult.reasons.entries()]
      .map(([k, v]) => `${k}: ${v}`)
      .join(", ");
    console.error(
      `[cc-mem] ${rawChunks.length}件中${filterResult.filtered}件を除外 (${reasons})`,
    );
  }

  if (filterResult.kept.length === 0) {
    console.error("[cc-mem] 保存するメモリがありません");
    return;
  }

  // 5. embedBatch() で全チャンクをベクトル化
  const texts = filterResult.kept.map((c) => `${c.question}\n${c.answer}`);
  let embeddings: (Float32Array | null)[] | null = null;

  try {
    embeddings = await embedBatch(texts);
  } catch (err) {
    console.error(
      `[cc-mem] embedding に失敗しました。embedding なしで保存します: ${err instanceof Error ? err.message : err}`,
    );
    embeddings = null;
  }

  // 6. DB 接続
  const db = initDb();

  // 7. 重複排除
  const chunksWithEmbeddings = filterResult.kept.map((chunk, i) => ({
    chunk,
    embedding: embeddings && embeddings[i] ? embeddings[i]! : null,
  }));

  const dedupResult = await dedup(db, chunksWithEmbeddings);

  if (dedupResult.duplicateCount > 0) {
    console.error(
      `[cc-mem] ${dedupResult.duplicateCount}件の重複をスキップ`,
    );
  }

  if (dedupResult.unique.length === 0) {
    console.error("[cc-mem] 保存するメモリがありません（全て重複）");
    return;
  }

  // 8. トランザクション内で全チャンクを INSERT
  const insert = db.prepare(
    "INSERT INTO memories (session_id, question, answer, embedding) VALUES (?, ?, ?, ?)",
  );

  const insertAll = db.transaction(() => {
    for (const { chunk, embedding } of dedupResult.unique) {
      const embeddingBuf = embedding ? vectorToBuffer(embedding) : null;
      insert.run(sessionId, chunk.question, chunk.answer, embeddingBuf);
    }
  });

  insertAll();

  // 9. 保存件数を stderr に表示
  console.error(
    `[cc-mem] ${dedupResult.unique.length}件のメモリを保存しました (session: ${sessionId})`,
  );
}
