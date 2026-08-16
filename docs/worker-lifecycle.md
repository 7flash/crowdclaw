# Project agent lifecycle

There is no shared embedded CrowdClaw worker.

`POST /api/projects` creates the project and then calls the bgrun SDK to ensure one named process for that project:

```text
crowdclaw-agent-<projectId>
```

The command is:

```text
bun project-agent.ts <projectId>
```

The process reads and writes only that project's durable SQLite/workspace state. A DB lease still guards against accidental duplicate execution.

The server reconciles active project processes periodically and on startup. bgrun provides PID, logs, runtime, restart controls and dashboard observability.
