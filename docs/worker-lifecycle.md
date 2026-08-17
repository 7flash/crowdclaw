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


## Safe bgrun restart semantics

Project agents are portless workers. CrowdClaw never starts them with bgrun `force` mode.
The supervisor first checks the recorded PID; a live worker is reused, while a stopped
record is started normally. This prevents bgrun orphan-port cleanup from touching the
TradJS server or any unrelated process when a stale worker record contains old port metadata.
