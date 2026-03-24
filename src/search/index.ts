import type { Database } from "bun:sqlite";
import { embed, bufferToVector, cosineSimilarity } from "../embedder";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SearchResult {
  id: number;
  sessionId: string;
  question: string;
  answer: string;
  score: number;
  createdAt: string;
}

interface RankedId {
  id: number;
  rank: number;
}

interface MemoryRow {
  id: number;
  session_id: string;
  question: string;
  answer: string;
  created_at: string;
  embedding: Buffer | null;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** RRF smoothing parameter */
const RRF_K = 60;

/** Time-decay half-life in days */
const HALF_LIFE_DAYS = 30;

/** Minimum query length for FTS5 trigram tokenizer */
const MIN_FTS_QUERY_LENGTH = 3;

// ---------------------------------------------------------------------------
// FTS5 keyword search
// ---------------------------------------------------------------------------

/**
 * Escape a user query for FTS5 MATCH by wrapping each token in double quotes.
 * This prevents special characters (*, OR, AND, NEAR, etc.) from being
 * interpreted as FTS operators.
 */
function escapeFtsQuery(query: string): string {
  // Split on whitespace, wrap each token in double quotes, rejoin
  return query
    .split(/\s+/)
    .filter((t) => t.length > 0)
    .map((t) => `"${t.replace(/"/g, '""')}"`)
    .join(" ");
}

function ftsSearch(db: Database, query: string, limit: number): RankedId[] {
  if (query.trim().length < MIN_FTS_QUERY_LENGTH) {
    return [];
  }

  const escaped = escapeFtsQuery(query);
  if (escaped.length === 0) return [];

  try {
    const rows = db
      .query<{ rowid: number; rank: number }, [string]>(
        `SELECT rowid, rank
         FROM memories_fts
         WHERE memories_fts MATCH ?
         ORDER BY rank
         LIMIT ?`,
      )
      .all(escaped);

    // BM25 rank from FTS5 is negative (lower = better). We just need ordinal ranks.
    // The query already orders by rank, so the array index gives us 1-based rank.
    // NOTE: bun:sqlite doesn't support binding limit as param in all cases,
    // so we slice in JS.
    return rows.slice(0, limit).map((r, i) => ({
      id: r.rowid,
      rank: i + 1,
    }));
  } catch {
    // If the FTS query still fails (e.g. empty after escaping), fall back gracefully
    return [];
  }
}

// ---------------------------------------------------------------------------
// Vector search
// ---------------------------------------------------------------------------

async function vectorSearch(
  db: Database,
  query: string,
  limit: number,
): Promise<RankedId[]> {
  const queryVec = await embed(query);

  const rows = db
    .query<{ id: number; embedding: Buffer }, []>(
      `SELECT id, embedding FROM memories WHERE embedding IS NOT NULL`,
    )
    .all();

  const scored: { id: number; similarity: number }[] = [];

  for (const row of rows) {
    const vec = bufferToVector(row.embedding);
    const sim = cosineSimilarity(queryVec, vec);
    scored.push({ id: row.id, similarity: sim });
  }

  // Sort descending by similarity
  scored.sort((a, b) => b.similarity - a.similarity);

  return scored.slice(0, limit).map((s, i) => ({
    id: s.id,
    rank: i + 1,
  }));
}

// ---------------------------------------------------------------------------
// RRF (Reciprocal Rank Fusion)
// ---------------------------------------------------------------------------

function reciprocalRankFusion(
  ...rankLists: RankedId[][]
): Map<number, number> {
  const scores = new Map<number, number>();

  for (const list of rankLists) {
    for (const { id, rank } of list) {
      const prev = scores.get(id) ?? 0;
      scores.set(id, prev + 1 / (RRF_K + rank));
    }
  }

  return scores;
}

// ---------------------------------------------------------------------------
// Time decay
// ---------------------------------------------------------------------------

function timeDecay(createdAt: string): number {
  const created = new Date(createdAt + "Z"); // SQLite datetime is UTC without Z
  const now = new Date();
  const diffMs = now.getTime() - created.getTime();
  const diffDays = diffMs / (1000 * 60 * 60 * 24);
  return Math.pow(0.5, diffDays / HALF_LIFE_DAYS);
}

// ---------------------------------------------------------------------------
// Hybrid search (public API)
// ---------------------------------------------------------------------------

export async function hybridSearch(
  db: Database,
  query: string,
  limit: number = 5,
): Promise<SearchResult[]> {
  // Generous candidate pool for each retriever
  const candidateLimit = limit * 10;

  // Run FTS and vector search
  const ftsResults = ftsSearch(db, query, candidateLimit);
  const vecResults = await vectorSearch(db, query, candidateLimit);

  // Merge with RRF
  const rrfScores = reciprocalRankFusion(ftsResults, vecResults);

  if (rrfScores.size === 0) {
    return [];
  }

  // Fetch full rows for all candidate IDs
  const candidateIds = [...rrfScores.keys()];
  const placeholders = candidateIds.map(() => "?").join(",");
  const rows = db
    .query<MemoryRow, number[]>(
      `SELECT id, session_id, question, answer, created_at, embedding
       FROM memories
       WHERE id IN (${placeholders})`,
    )
    .all(...candidateIds);

  const rowMap = new Map<number, MemoryRow>();
  for (const row of rows) {
    rowMap.set(row.id, row);
  }

  // Compute final score with time decay and sort
  const results: SearchResult[] = [];

  for (const [id, rrfScore] of rrfScores) {
    const row = rowMap.get(id);
    if (!row) continue;

    const decay = timeDecay(row.created_at);
    results.push({
      id: row.id,
      sessionId: row.session_id,
      question: row.question,
      answer: row.answer,
      score: rrfScore * decay,
      createdAt: row.created_at,
    });
  }

  results.sort((a, b) => b.score - a.score);

  return results.slice(0, limit);
}
