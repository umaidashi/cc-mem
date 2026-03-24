import { initDb } from "../db/schema";
import { hybridSearch, type SearchResult } from "../search";
import { config } from "../config";

function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength) + "...";
}

function formatDate(dateStr: string): string {
  return dateStr.slice(0, 10);
}

export async function search(
  query: string,
  limit: number = 5,
  withContext: boolean = false,
  project?: string,
): Promise<void> {
  if (!query || query.trim() === "") {
    console.error("クエリを指定してください");
    process.exit(1);
  }

  const db = initDb();
  const results: SearchResult[] = await hybridSearch(db, query, limit, {
    withContext,
    project,
  });

  if (results.length === 0) {
    console.log(`No memories found for: "${query}"`);
    return;
  }

  // RRF の理論最大値で正規化（both rank 1, 0 days old）
  const maxRrfScore = 2 / (60 + 1); // ≈ 0.0328
  const topScore = results[0]?.score ?? 0;
  const normalizer = topScore > 0 ? Math.max(topScore, maxRrfScore) : 1;

  console.log(`## Memory Search Results (${results.length}件)\n`);

  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    const rank = i + 1;
    const date = formatDate(r.createdAt);
    const relevance = Math.round((r.score / normalizer) * 100);
    const q = truncate(r.question, 100);
    const a = truncate(r.answer, 200);

    console.log("---");
    console.log(
      `### #${rank} [${relevance}%] (${date}) session: ${r.sessionId}`,
    );

    if (r.context) {
      for (const ctx of r.context) {
        if (ctx.position === "before") {
          console.log(`  [before] Q: ${truncate(ctx.question, 80)}`);
          console.log(`  [before] A: ${truncate(ctx.answer, 150)}`);
        }
      }
    }

    console.log(`**Q:** ${q}`);
    console.log(`**A:** ${a}`);

    if (r.context) {
      for (const ctx of r.context) {
        if (ctx.position === "after") {
          console.log(`  [after] Q: ${truncate(ctx.question, 80)}`);
          console.log(`  [after] A: ${truncate(ctx.answer, 150)}`);
        }
      }
    }

    console.log("");
  }
}
