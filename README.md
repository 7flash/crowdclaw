# CrowdClaw

Crowd-funded autonomous browser games.

**Describe your Idea. Agent keeps building it.**

Anyone can fund a project with SOL. Confirmed supporters earn influence proportional to their contribution and can spend that influence to steer future rolling milestones.

## Stack

- Bun
- TradJS 4.3.0 — real multi-page routing
- `jsx-ai` — planner + file-tool agent loops
- `gemini-3-flash-preview` by default
- `@solard/sdk@0.2.3` — one funding wallet per project
- `bgrun@3.12.16` — one observable OS process per project agent
- `sqlite-zod-orm` — projects, runs, artifacts, funding, supporters, steering
- `measure-fn` — closure-nested traces
- Tailwind 4

## Process model

TradJS only serves the product. It does not contain an embedded agent loop.

When a project is created, the server starts a dedicated bgrun process:

```text
crowdclaw-agent-p_xxx
  └─ bun project-agent.ts p_xxx
```

That process owns only that project:

```text
planning
  ↓
waiting_funds
  ↓
working
  ↓
validating
  ↓
publishing
  ↓
waiting_funds / working / ...
```

The web server uses the bgrun SDK (`handleRun`, `getProcess`, `isProcessRunning`) to create and reconcile project-agent processes. bgrun owns process logs/PIDs/runtime; CrowdClaw SQLite owns project state.

Open bgrun's dashboard for agent observability:

```sh
bun run bgrun
```

## Pages

```text
/
  create idea
  streamed planner output
  name / summary / 3 milestones appear as Gemini emits them
  normal browser navigation

/projects/:id
  playable release
  live agent state
  SOL funding
  rolling roadmap
  supporters
  steering
```

TradJS 4.3 uses real document navigation. Refreshing or sharing `/projects/:id` loads the project directly from SQLite.

## Agent planning

Initial planning streams line-by-line so Home can show the roadmap as it is generated.

The planner contract remains:

```text
N|kebab-case-name
S|one sentence
M|first milestone|2
M|second milestone|2
M|third milestone|3
```

Costs are internal integer build units. Public UI converts them to SOL using `LAMPORTS_PER_CREDIT` and never exposes the old credit symbol.

## Game-building loop

Each project agent uses `jsx-ai` with real project-file tools:

```text
list_files
read_file
write_file
phase_done
```

The workspace persists under `WORKSPACE_ROOT/<projectId>`.

`phase_done` is only a request to publish. CrowdClaw validates `index.html` independently before the milestone is charged and released.

Every successful release proposes one new rolling milestone.

## Supporters and influence

Confirmed inbound SOL transactions are indexed by paying address.

For each supporter:

```text
influence earned = attributed donation build units
influence available = earned - spent
```

A supporter can connect an injected Solana wallet, sign a short CrowdClaw challenge, and spend influence on a steering instruction.

Open steering is passed to the agent when it builds the current milestone:

```text
SUPPORTER STEERING
- 3.00 influence: add risky speed upgrades
- 1.25 influence: make walls pulse before moving
```

Higher influence is stronger direction. Compatible steering can shape the pending implementation and the new rolling milestone. Steering captured by a run is consumed atomically when that run publishes. Steering submitted while a build is already running remains open for the following milestone.

## Funding

Each project gets a Solard wallet at creation.

Wallet balance is the authority for build funding. Transaction indexing is only used for supporter attribution, so the same transfer cannot mint funding twice.

Default conversion:

```text
LAMPORTS_PER_CREDIT=10000000
1 internal build unit = 0.01 SOL
```

The public product displays `SOL`, not internal build units.

## Development

```sh
cp .env.example .env
# set GEMINI_API_KEY
bun install
bun run dev
```

Create a project in the browser. The server will start a process named like:

```text
crowdclaw-agent-p_m...
```

Inspect it with:

```sh
bunx bgrun
bunx bgrun crowdclaw-agent-p_m... --logs
```

Or open the dashboard:

```sh
bun run bgrun
```

## Environment

```dotenv
GEMINI_API_KEY=
GAME_MODEL=gemini-3-flash-preview
GAME_CONTEXT_WINDOW=1048576
AGENT_MAX_TOKENS=14000
AGENT_MAX_STEPS=8
AGENT_REQUEST_TIMEOUT_MS=90000

DATABASE_PATH=./data/crowdclaw.sqlite
WORKSPACE_ROOT=./data/workspaces
PORT=3000
BGR_GROUP=crowdclaw

AGENT_POLL_MS=2000
AGENT_LEASE_MS=60000
AGENT_SUPERVISOR_MS=15000
FUNDING_SYNC_MS=15000

SOLANA_RPC_URL=https://api.mainnet-beta.solana.com
SOLANA_RPC_TIMEOUT_MS=12000
LAMPORTS_PER_CREDIT=10000000
```

## Verification

```sh
bun run verify
```

Health:

```text
/api/health
/api/health/live
/api/health/ready
```

Readiness checks configuration, SQLite, and the bgrun programmatic API. Agent process state/logs remain available through bgrun itself.
