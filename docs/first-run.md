# First-run lifecycle

```text
POST /api/projects
  → create project wallet
  → persist project
  → bgrun starts crowdclaw-agent-<projectId>

project agent
  → PLAN
  → persist 3 milestones
  → status = seeding
  → persist first_milestone treasury grant
  → @solard/sdk sends SOL
  → SSE exposes grant immediately
  → RPC observes project-wallet balance
  → grant = confirmed
  → status = queued
  → reserve milestone 1
  → jsx-ai tool loop
  → validate
  → publish v1
  → iframe appears
```

The platform seed is not steering power. Only `supporter` donations contribute to influence.
