export interface ExtractedKey {
  type: string;
  value: string;
}

export function extractKeys(text: string): ExtractedKey[] {
  const keys: Map<string, ExtractedKey> = new Map();

  const patterns: Array<{ type: string; regex: RegExp }> = [
    { type: "github_pr", regex: /github\.com\/[^/\s]+\/[^/\s]+\/pull\/\d+/g },
    { type: "github_issue", regex: /github\.com\/[^/\s]+\/[^/\s]+\/issues\/\d+/g },
    { type: "jira_url", regex: /atlassian\.net\/browse\/[A-Z]+-\d+/g },
    { type: "confluence", regex: /atlassian\.net\/wiki\/\S+/g },
    { type: "jira", regex: /\b[A-Z]{2,}-\d+\b/g },
    { type: "pr", regex: /#\d{3,}\b/g },
  ];

  for (const { type, regex } of patterns) {
    for (const match of text.matchAll(regex)) {
      const value = match[0];
      const dedup = `${type}:${value}`;
      if (!keys.has(dedup)) {
        keys.set(dedup, { type, value });
      }
    }
  }

  return [...keys.values()];
}
