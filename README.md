# CrowdClaw

**Describe your Idea. Agent keeps building it.**

Anyone can fund it. Supporters steer what it builds next.

## Flow

```text
idea
  ↓
project wallet
  ↓
bgrun project agent
  ↓
3 milestones
  ↓
CrowdClaw → first milestone SOL
  ↓
building
  ↓
playable v1
  ↓
community funding + steering
  ↓
rolling releases
```

Every project gets its own Solard wallet and its own bgrun-managed agent process. The platform automatically sponsors the first milestone from the configured CrowdClaw treasury so a new project starts building immediately instead of opening on an empty funding screen.

The seed transfer is persisted before it is sent, shown live as `CrowdClaw` in Supporters, and does **not** earn steering influence. Human SOL contributions do.

## Stack

- Bun
- TradJS `4.3.0`
- `jsx-ai`
- `gemini-3-flash-preview`
- `@solard/sdk@0.2.3`
- `bgrun@3.12.16`
- `sqlite-zod-orm`
- `measure-fn`
- Tailwind 4

## Processes

TradJS is the web app. It does not run an embedded worker loop.

Creating a project calls the bgrun SDK and starts one process:

```text
crowdclaw-agent-p_xxx
  └─ bun project-agent.ts p_xxx
```

That process owns only that project. SQLite is the queue/state boundary; bgrun owns PID/runtime/log observability.

```sh
bun run bgrun
```

opens bgrun observability.

## First milestone sponsorship

After planning, a fresh project enters `seeding`.

The project agent asks the treasury service for only the shortfall required to fund milestone 1:

```text
required = first milestone cost
shortfall = required - already confirmed project funding
```

The treasury service resolves `TREASURY_WALLET_NAME` through `@solard/sdk` and sends SOL to the project wallet.

```ts
slrd
  .tx(treasury.address)
  .transferSol(project.walletAddress, sol(amount))
  .send()
```

A deterministic first-milestone grant record prevents normal retries from creating multiple grants. Submitted grants are reconciled against the project wallet before another attempt is allowed.

The project page receives the grant and wallet balance over SSE, so the sequence is visible without a reload:

```text
FUNDING
CrowdClaw  +0.0200 SOL
0.0000 SOL → 0.0200 SOL
STARTING
BUILDING
READ / WRITE / VALIDATE / PUBLISH
v1 appears playable
```

## Public agent activity

`jsx-ai` has an explicit `status` tool for short public updates. These are operational summaries, not hidden chain-of-thought.

Examples:

```text
Tuning shrinking wall timing
READ index.html
WRITE index.html
Testing collision rules
VALIDATE
PUBLISH
```

File tools remain:

```text
list_files
read_file
write_file
status
phase_done
```

`phase_done` is only a publication request. CrowdClaw independently validates `index.html` before charging the milestone and publishing the immutable release.

## Supporters and steering

The platform seed is displayed as CrowdClaw but earns zero influence.

Confirmed human donations earn influence proportional to attributed SOL. Supporters can spend that influence on signed steering instructions for future work. Open steering is passed into the next `jsx-ai` build weighted by influence.

## Pages

```text
/
  idea
  streamed planning animation
  normal navigation

/projects/:id
  live build / playable artifact
  agent
  treasury
  now / next / shipped
  supporters
  steer next
```

TradJS 4.3 uses real document navigation. Direct links and refreshes load `/projects/:id` from SQLite, then SSE keeps the page current.

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

AGENT_POLL_MS=2000
AGENT_LEASE_MS=60000
AGENT_SUPERVISOR_MS=15000
FUNDING_SYNC_MS=5000

SOLANA_RPC_URL=https://api.mainnet-beta.solana.com
SOLANA_RPC_TIMEOUT_MS=12000
LAMPORTS_PER_CREDIT=10000000

SLRD_MASTER_KEY=change-me
TREASURY_SEED_ENABLED=1
TREASURY_WALLET_NAME=crowdclaw-main
TREASURY_AUTO_CREATE=1
TREASURY_RETRY_MS=15000

ALLOW_DEV_FUNDING=0
```

With `TREASURY_AUTO_CREATE=1`, CrowdClaw creates the named Solard treasury if it does not already exist. Fund that wallet with SOL before creating public projects.

## Run

```sh
cp .env.example .env
bun install
bun run dev
```

Then:

```sh
bun run bgrun
```

## Verify

```sh
bun run verify
```

Health:

```text
/api/health
/api/health/live
/api/health/ready
```
