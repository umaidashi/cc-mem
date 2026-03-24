import { initDb } from "../db/schema";
import { hybridSearch, type SearchResult } from "../search";

function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength) + "...";
}

function formatDate(dateStr: string): string {
  return dateStr.slice(0, 10);
}

export async function search(query: string, limit: number = 5): Promise<void> {
  if (!query || query.trim() === "") {
    console.error("クエリを指定してください");
    process.exit(1);
  }

  const db = initDb();
  const results: SearchResult[] = await hybridSearch(db, query, limit);

  if (results.length === 0) {
    console.log(`No memories found for: "${query}"`);
    return;
  }

  console.log(`## Memory Search Results (${results.length}件)\n`);

  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    const rank = i + 1;
    const date = formatDate(r.createdAt);
    const score = r.score.toFixed(4);
    const q = truncate(r.question, 100);
    const a = truncate(r.answer, 200);

    console.log("---");
    console.log(`### #${rank} [score: ${score}] (${date})`);
    console.log(`**Q:** ${q}`);
    console.log(`**A:** ${a}\n`);
  }
}
