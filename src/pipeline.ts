import type { Database } from "bun:sqlite";
import { chunkTranscript } from "./chunker";
import { dedup } from "./dedup";
import { embedBatch, vectorToBuffer } from "./embedder";
import { filterChunks } from "./filter";

export interface SaveResult {
  sessionId: string;
  saved: number;
  filtered: number;
  duplicates: number;
  filterReasons: Map<string, number>;
  embeddingError: string | null;
}

export async function processSave(
  input: string,
  db: Database,
  sessionId: string,
): Promise<SaveResult> {
  // 1. chunkTranscript() でQ&Aチャンクに分割
  const rawChunks = chunkTranscript(input);

  if (rawChunks.length === 0) {
    return {
      sessionId,
      saved: 0,
      filtered: 0,
      duplicates: 0,
      filterReasons: new Map(),
      embeddingError: null,
    };
  }

  // 2. フィルタリング（短文 + 軽量応答を除外）
  const filterResult = filterChunks(rawChunks);

  if (filterResult.kept.length === 0) {
    return {
      sessionId,
      saved: 0,
      filtered: filterResult.filtered,
      duplicates: 0,
      filterReasons: filterResult.reasons,
      embeddingError: null,
    };
  }

  // 3. embedBatch() で全チャンクをベクトル化
  const texts = filterResult.kept.map((c) => `${c.question}\n${c.answer}`);
  let embeddings: (Float32Array | null)[] | null = null;
  let embeddingError: string | null = null;

  try {
    embeddings = await embedBatch(texts);
  } catch (err) {
    embeddingError = err instanceof Error ? err.message : String(err);
    embeddings = null;
  }

  // 4. 重複排除
  const chunksWithEmbeddings = filterResult.kept.map((chunk, i) => ({
    chunk,
    embedding: embeddings && embeddings[i] ? embeddings[i]! : null,
  }));

  const dedupResult = await dedup(db, chunksWithEmbeddings);

  if (dedupResult.unique.length === 0) {
    return {
      sessionId,
      saved: 0,
      filtered: filterResult.filtered,
      duplicates: dedupResult.duplicateCount,
      filterReasons: filterResult.reasons,
      embeddingError,
    };
  }

  // 5. トランザクション内で全チャンクを INSERT
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

  // 6. SaveResult を返す
  return {
    sessionId,
    saved: dedupResult.unique.length,
    filtered: filterResult.filtered,
    duplicates: dedupResult.duplicateCount,
    filterReasons: filterResult.reasons,
    embeddingError,
  };
}
