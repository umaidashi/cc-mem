import { readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join, relative } from "node:path";
import { initDb } from "../db/schema";
import { processSave } from "../pipeline";
import { chunkTranscript } from "../chunker";
import { filterChunks } from "../filter";

export interface ImportOptions {
  projectsDir: string;
  dbPath?: string;
  dryRun?: boolean;
  projectFilter?: string;
  verbose?: boolean;
}

export interface ImportResult {
  sessionsFound: number;
  sessionsProcessed: number;
  totalSaved: number;
  totalFiltered: number;
  totalDuplicates: number;
}

function findJsonlFiles(dir: string, projectFilter?: string): string[] {
  const results: string[] = [];

  function walk(currentDir: string): void {
    let entries: string[];
    try {
      entries = readdirSync(currentDir);
    } catch {
      return;
    }

    for (const entry of entries) {
      const fullPath = join(currentDir, entry);

      // subagents/ ディレクトリを除外
      if (entry === "subagents") continue;

      let stat;
      try {
        stat = statSync(fullPath);
      } catch {
        continue;
      }

      if (stat.isDirectory()) {
        walk(fullPath);
      } else if (entry.endsWith(".jsonl")) {
        // projectFilter があればパスの部分一致でフィルタ
        if (projectFilter && !fullPath.includes(projectFilter)) {
          continue;
        }
        results.push(fullPath);
      }
    }
  }

  walk(dir);
  return results;
}

export async function importSessions(options: ImportOptions): Promise<ImportResult> {
  const { projectsDir, dbPath, dryRun = false, projectFilter, verbose = false } = options;

  const files = findJsonlFiles(projectsDir, projectFilter);

  const result: ImportResult = {
    sessionsFound: files.length,
    sessionsProcessed: 0,
    totalSaved: 0,
    totalFiltered: 0,
    totalDuplicates: 0,
  };

  if (files.length === 0) {
    return result;
  }

  const db = dryRun ? null : initDb(dbPath);

  try {
    for (const file of files) {
      const content = readFileSync(file, "utf-8");
      const sessionId = `import_${basename(file, ".jsonl").slice(0, 8)}`;

      if (dryRun) {
        const rawChunks = chunkTranscript(content);
        const filterResult = filterChunks(rawChunks);
        result.sessionsProcessed++;
        result.totalSaved += filterResult.kept.length;
        result.totalFiltered += filterResult.filtered;

        if (verbose) {
          const rel = relative(projectsDir, file);
          console.error(
            `  [dry-run] ${rel}: ${filterResult.kept.length} kept, ${filterResult.filtered} filtered`,
          );
        }
      } else {
        const saveResult = await processSave(content, db!, sessionId);
        result.sessionsProcessed++;
        result.totalSaved += saveResult.saved;
        result.totalFiltered += saveResult.filtered;
        result.totalDuplicates += saveResult.duplicates;

        if (verbose) {
          const rel = relative(projectsDir, file);
          console.error(
            `  ${rel}: ${saveResult.saved} saved, ${saveResult.filtered} filtered, ${saveResult.duplicates} duplicates${saveResult.embeddingError ? ` (embedding error: ${saveResult.embeddingError})` : ""}`,
          );
        }
      }
    }
  } finally {
    if (db) {
      db.close();
    }
  }

  return result;
}
