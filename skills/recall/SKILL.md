---
name: recall
description: Show recent session summaries for the current project. Use to understand what was discussed recently.
user-invocable: true
allowed-tools: Bash(cc-mem *)
---

# Memory Recall

Show recent session summaries for the current project.

```bash
cc-mem recall
```

Show more sessions:
```bash
cc-mem recall --last $ARGUMENTS
```

Show all projects:
```bash
cc-mem recall --all
```
