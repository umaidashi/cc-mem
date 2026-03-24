---
name: memory-stats
description: Show memory statistics and recent session logs.
user-invocable: true
allowed-tools: Bash(cc-mem *)
---

# Memory Stats

Show memory statistics:
```bash
cc-mem stats
```

Show recent session logs:
```bash
cc-mem log --last ${ARGUMENTS:-10}
```
