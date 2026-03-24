const OLLAMA_URL = process.env.CC_MEM_OLLAMA_URL ?? "http://localhost:11434";
const EMBED_MODEL = process.env.CC_MEM_EMBED_MODEL ?? "nomic-embed-text";
const MAX_BATCH_SIZE = 32;

interface OllamaEmbedResponse {
  model: string;
  embeddings: number[][];
}

async function callEmbedAPI(texts: string[]): Promise<number[][]> {
  let res: Response;
  try {
    res = await fetch(`${OLLAMA_URL}/api/embed`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: EMBED_MODEL, input: texts }),
    });
  } catch (err) {
    throw new Error(
      `Ollama に接続できません (${OLLAMA_URL})。Ollama が起動しているか確認してください。\n原因: ${err instanceof Error ? err.message : err}`,
    );
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `Ollama embedding API がエラーを返しました (HTTP ${res.status}): ${body}`,
    );
  }

  const json = (await res.json()) as OllamaEmbedResponse;
  return json.embeddings;
}

/** 単一テキストをベクトル化 */
export async function embed(text: string): Promise<Float32Array> {
  const [vec] = await callEmbedAPI([text]);
  return new Float32Array(vec);
}

/** バッチでベクトル化（最大32テキストずつ処理） */
export async function embedBatch(texts: string[]): Promise<Float32Array[]> {
  const results: Float32Array[] = [];

  for (let i = 0; i < texts.length; i += MAX_BATCH_SIZE) {
    const chunk = texts.slice(i, i + MAX_BATCH_SIZE);
    const embeddings = await callEmbedAPI(chunk);
    for (const vec of embeddings) {
      results.push(new Float32Array(vec));
    }
  }

  return results;
}

/** ベクトルをSQLite保存用のBufferに変換 */
export function vectorToBuffer(vec: Float32Array): Buffer {
  return Buffer.from(vec.buffer, vec.byteOffset, vec.byteLength);
}

/** BufferからFloat32Arrayに復元 */
export function bufferToVector(buf: Buffer): Float32Array {
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  return new Float32Array(ab);
}

/** コサイン類似度計算 */
export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) {
    throw new Error(
      `ベクトルの次元数が一致しません: ${a.length} vs ${b.length}`,
    );
  }

  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  if (denom === 0) return 0;

  return dot / denom;
}
