#!/usr/bin/env bun

import { save } from "./src/cli/save";
import { search } from "./src/cli/search";
import { importSessions } from "./src/cli/import";

const VERSION = "0.1.0";
const NAME = "cc-mem";

const HELP = `${NAME} v${VERSION} — Long-term memory for Claude Code

Usage:
  ${NAME} save              Save conversation from stdin
  ${NAME} search <query>    Search past memories
  ${NAME} import              Import all session logs
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
`;

function parseArgs(args: string[]): {
  command: string;
  query: string;
  limit: number;
  dryRun: boolean;
  project: string;
  verbose: boolean;
  withContext: boolean;
} {
  let command = "";
  let limit = 5;
  let dryRun = false;
  let project = "";
  let verbose = false;
  let withContext = false;
  const rest: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "-h" || arg === "--help") {
      command = "help";
    } else if (arg === "-v" || arg === "--version") {
      command = "version";
    } else if (arg === "--limit" && i + 1 < args.length) {
      limit = parseInt(args[++i], 10) || 5;
    } else if (arg === "--dry-run") {
      dryRun = true;
    } else if (arg === "--project" && i + 1 < args.length) {
      project = args[++i];
    } else if (arg === "--verbose") {
      verbose = true;
    } else if (arg === "--context") {
      withContext = true;
    } else if (!command) {
      command = arg;
    } else {
      rest.push(arg);
    }
  }

  return { command, query: rest.join(" "), limit, dryRun, project, verbose, withContext };
}

const { command, query, limit, dryRun, project, verbose, withContext } = parseArgs(process.argv.slice(2));

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
  case "search":
    await search(query, limit, withContext);
    break;
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
  case "stats":
    await (await import("./src/cli/stats")).stats();
    break;
  default:
    console.error(`Unknown command: ${command}\n`);
    console.error(HELP);
    process.exit(1);
}
