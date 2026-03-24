import type { Database } from "bun:sqlite";
import type { QAChunk } from "../chunker";
import { bufferToVector, cosineSimilarity } from "../embedder";

export interface DedupResult {
  unique: Array<{ chunk: QAChunk; embedding: Float32Array | null }>;
  duplicateCount: number;
}

export async function dedup(
  db: Database,
  chunks: Array<{ chunk: QAChunk; embedding: Float32Array | null }>,
  options?: {
    threshold?: number;
  },
): Promise<DedupResult> {
  const threshold =
    options?.threshold ??
    (process.env.CC_MEM_DEDUP_THRESHOLD
      ? parseFloat(process.env.CC_MEM_DEDUP_THRESHOLD)
      : 0.95);

  // DB から embedding NOT NULL な全レコードを取得
  const rows = db
    .query("SELECT embedding FROM memories WHERE embedding IS NOT NULL")
    .all() as Array<{ embedding: Buffer }>;

  const dbVectors = rows.map((row) => bufferToVector(row.embedding));

  const unique: Array<{ chunk: QAChunk; embedding: Float32Array | null }> = [];
  let duplicateCount = 0;

  for (const item of chunks) {
    if (item.embedding === null) {
      // embedding が null ならチェックスキップ → unique
      unique.push(item);
      continue;
    }

    let isDuplicate = false;
    for (const dbVec of dbVectors) {
      const similarity = cosineSimilarity(item.embedding, dbVec);
      if (similarity >= threshold) {
        isDuplicate = true;
        break;
      }
    }

    if (isDuplicate) {
      duplicateCount++;
    } else {
      unique.push(item);
    }
  }

  return { unique, duplicateCount };
}
