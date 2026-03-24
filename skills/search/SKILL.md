---
name: search
description: Search past session memories. Use when you need to recall previous discussions, design decisions, or context from earlier sessions.
user-invocable: true
allowed-tools: Bash(cc-mem *)
---

# Memory Search

Search past session memories using hybrid search (keyword + vector + time decay).

## Usage

```bash
cc-mem search "$ARGUMENTS"
```

For context (surrounding Q&A from same session):
```bash
cc-mem search --context "$ARGUMENTS"
```

For cross-project search:
```bash
cc-mem search --all "$ARGUMENTS"
```

Use this skill when:
- Recalling design decisions from previous sessions
- Finding why something was rejected or chosen
- Looking up past discussions about a specific topic
- Checking if a similar problem was solved before
