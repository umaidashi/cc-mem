#!/usr/bin/env bun

import { save } from "./src/cli/save";
import { search } from "./src/cli/search";
import { importSessions } from "./src/cli/import";
import { log } from "./src/cli/log";
import { runGc } from "./src/cli/gc";
import { exportCmd } from "./src/cli/export";
import { recall } from "./src/cli/recall";
import { config } from "./src/config";

const VERSION = "0.1.0";
const NAME = "cc-mem";

const HELP = `${NAME} v${VERSION} — Long-term memory for Claude Code

Usage:
  ${NAME} save              Save conversation from stdin
  ${NAME} search <query>    Search past memories (current project)
  ${NAME} search --all <q>  Search all projects
  ${NAME} import              Import all session logs
  ${NAME} recall [--last N]   Show recent session summaries (current project)
  ${NAME} recall --all        Show all projects' sessions
  ${NAME} log [--last N]     Show recent session logs (default: 10)
  ${NAME} gc                  Delete old memories (default: 90 days)
  ${NAME} export             Export memories as JSON
  ${NAME} stats             Show memory statistics

Options:
  -h, --help               Show this help message
  -v, --version            Show version number

Examples:
  echo "$CLAUDE_CONVERSATION" | ${NAME} save
  ${NAME} search "SQLite 全文検索"
  ${NAME} search --limit 10 "設計判断"
  ${NAME} search --context "SQLite FTS5"

Environment:
  CC_MEM_OLLAMA_URL        Ollama URL (default: http://localhost:11434)
  CC_MEM_EMBED_MODEL       Embedding model (default: nomic-embed-text)
  CC_MEM_PROJECT           Project scope (default: basename of cwd)
`;

function parseArgs(args: string[]): {
  command: string;
  query: string;
  limit: number;
  last: number;
  dryRun: boolean;
  project: string;
  verbose: boolean;
  withContext: boolean;
  olderThan: string;
  session: string;
  allProjects: boolean;
} {
  let command = "";
  let limit = 5;
  let last = 10;
  let dryRun = false;
  let project = "";
  let verbose = false;
  let withContext = false;
  let olderThan = "";
  let session = "";
  let allProjects = false;
  const rest: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "-h" || arg === "--help") {
      command = "help";
    } else if (arg === "-v" || arg === "--version") {
      command = "version";
    } else if (arg === "--limit" && i + 1 < args.length) {
      limit = parseInt(args[++i], 10) || 5;
    } else if (arg === "--last" && i + 1 < args.length) {
      last = parseInt(args[++i], 10) || 10;
    } else if (arg === "--dry-run") {
      dryRun = true;
    } else if (arg === "--project" && i + 1 < args.length) {
      project = args[++i];
    } else if (arg === "--verbose") {
      verbose = true;
    } else if (arg === "--all") {
      allProjects = true;
    } else if (arg === "--context") {
      withContext = true;
    } else if (arg === "--older-than" && i + 1 < args.length) {
      olderThan = args[++i];
    } else if (arg === "--session" && i + 1 < args.length) {
      session = args[++i];
    } else if (!command) {
      command = arg;
    } else {
      rest.push(arg);
    }
  }

  return { command, query: rest.join(" "), limit, last, dryRun, project, verbose, withContext, olderThan, session, allProjects };
}

const { command, query, limit, last, dryRun, project, verbose, withContext, olderThan, session, allProjects } = parseArgs(process.argv.slice(2));

switch (command) {
  case "help":
  case "":
    console.log(HELP);
    break;
  case "version":
    console.log(`${NAME} v${VERSION}`);
    break;
  case "save":
    await save();
    break;
  case "search": {
    const searchProject = allProjects ? undefined : config.project;
    await search(query, limit, withContext, searchProject);
    break;
  }
  case "import": {
    const { homedir } = await import("node:os");
    const { join } = await import("node:path");
    const projectsDir = join(homedir(), ".claude", "projects");
    const result = await importSessions({
      projectsDir,
      dryRun,
      projectFilter: project || undefined,
      verbose,
    });
    console.error(`Sessions found: ${result.sessionsFound}`);
    console.error(`Sessions processed: ${result.sessionsProcessed}`);
    console.error(`Total saved: ${result.totalSaved}`);
    console.error(`Total filtered: ${result.totalFiltered}`);
    console.error(`Total duplicates: ${result.totalDuplicates}`);
    break;
  }
  case "recall": {
    // --last が明示指定されていなければ recall のデフォルト(3)を使う
    const hasLast = process.argv.includes("--last");
    const recallProject = allProjects ? undefined : config.project;
    await recall(hasLast ? last : undefined, recallProject);
    break;
  }
  case "log":
    await log(last);
    break;
  case "gc": {
    const { initDb } = await import("./src/db/schema");
    const db = initDb();
    const olderThanDays = olderThan
      ? parseInt(olderThan.replace(/d$/i, ""), 10)
      : undefined;
    const result = runGc(db, {
      olderThanDays,
      dryRun,
      sessionId: session || undefined,
    });
    if (dryRun) {
      console.log(`[dry-run] Would delete ${result.deleted} memories (${result.remaining} remaining)`);
    } else {
      console.log(`Deleted ${result.deleted} memories (${result.remaining} remaining)`);
    }
    break;
  }
  case "export":
    await exportCmd(session || undefined);
    break;
  case "stats":
    await (await import("./src/cli/stats")).stats();
    break;
  default:
    console.error(`Unknown command: ${command}\n`);
    console.error(HELP);
    process.exit(1);
}
