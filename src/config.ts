import { basename } from "node:path";

export const config = {
  ollamaUrl: process.env.CC_MEM_OLLAMA_URL ?? "http://localhost:11434",
  embedModel: process.env.CC_MEM_EMBED_MODEL ?? "nomic-embed-text",
  minChunkLength: parseInt(process.env.CC_MEM_MIN_CHUNK_LENGTH ?? "100", 10),
  dedupThreshold: parseFloat(process.env.CC_MEM_DEDUP_THRESHOLD ?? "0.95"),
  dbPath: process.env.CC_MEM_DB_PATH ?? undefined, // undefined = default (~/.cc-mem/memory.db)
  project: process.env.CC_MEM_PROJECT ?? basename(process.cwd()),
} as const;
