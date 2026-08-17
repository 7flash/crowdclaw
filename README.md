# CrowdClaw

**Describe your Idea. Agent keeps building it.**

Anyone can fund it. Supporters steer what it builds next.

## Stack

- Bun
- TradJS `4.3.0`
- `jsx-ai@0.9.1`
- `@openai/codex-sdk`
- `@solard/sdk@0.2.3`
- `bgrun@3.14.0`
- `sqlite-zod-orm`
- `measure-fn@4.0.5`
- Tailwind 4

## Runtime

Every project gets:

```text
project row + project Solard wallet
                  ↓
       bgrun project process
                  ↓
   bun project-agent.ts p_xxx
```

TradJS serves pages/APIs/SSE. The project process owns planning, funding observation, `jsx-ai` milestone execution, validation, and publication.

Initial planning is one bounded `runAgent()` step with one `submit_game_plan` tool call. Milestone builds use fresh chat history and the workspace as durable state.

## Browser flow

```text
IDEA
 ↓
THINKING
 ↓
project name + public design note
 ↓
milestones reveal one by one
 ↓
READY
 ↓  native cross-document view transition
PROJECT
 ↓
FUNDING / WAITING
 ↓
BUILDING
 ↓
public_status + READ/WRITE/VALIDATE/PUBLISH
 ↓
playable artifact replaces the stage in-place
```

The Home result remains visible briefly at `READY` before automatic navigation. The generated project title has the same browser view-transition identity on both documents.

Public status is intentionally model-authored operational text, not hidden chain-of-thought.

## Funding wake-up contract

The address shown on `/projects/:id` is the **project wallet**. Sending SOL there does not require a page reload.

While a project is `WAITING`, its bgrun process checks the project-wallet balance every `AGENT_POLL_MS` (2 seconds by default). Treasury retry backoff does **not** block this balance watch. The open project page also performs a silent `/sync` nudge every 3 seconds as a second recovery path.

When enough confirmed SOL exists for the current milestone:

```text
wallet balance increases
        ↓
SQLite funding/ledger/supporter state updates
        ↓
status → queued, retryAt → 0
        ↓
same project process starts the milestone
        ↓
SSE snapshots update the browser every ~500ms
        ↓
BUILDING + live tool/status activity
        ↓
artifact.published
        ↓
iframe appears without document reload
```

The transaction-signature/supporter index runs only when the observed wallet balance grows, so the frequent waiting-state balance poll does not also scan transaction history every tick.

## Optional first-milestone sponsorship

CrowdClaw never manufactures a treasury wallet. If automatic sponsorship is enabled, `TREASURY_WALLET_NAME` must already resolve to a funded Solard wallet.

```dotenv
TREASURY_SEED_ENABLED=1
TREASURY_WALLET_NAME=crowdclaw-main
SLRD_MASTER_KEY=...
```

If that wallet exists and has enough SOL, CrowdClaw sends only the first-milestone shortfall to the project wallet. The grant is persisted and shown as CrowdClaw support, but receives zero steering influence.

If the treasury is missing, empty, or unavailable, the project simply remains `WAITING`. It is still fully fundable by sending SOL directly to the project wallet.

## Supporters and steering

Attributed human donations earn steering influence proportional to SOL. Supporters sign steering instructions with their donating wallet and spend influence to shape upcoming work. Open steering is passed into the next milestone agent weighted by influence.

## `measure-fn`

CrowdClaw uses the current closure-nested API:

```ts
await measure(
  {
    start: () => "Build milestone 1",
    end: result => ({ version: result.version }),
    projectId,
  },
  async () => {
    await measure(
      {
        start: () => "Validate artifact",
        end: issues => ({ issues: issues.length }),
      },
      validate,
    )
  },
)
```

There is no injected child `m`; nested calls inherit span nesting automatically. `catch` is used only where a real fallback exists.

## Environment

```dotenv
JSX_AI_RUNTIME=codex
GAME_MODEL=gpt-5.4-mini
GAME_CONTEXT_WINDOW=1048576
AGENT_MAX_TOKENS=14000
AGENT_MAX_STEPS=8
AGENT_REQUEST_TIMEOUT_MS=90000
AGENT_MAX_DURATION_MS=480000

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

TREASURY_SEED_ENABLED=1
TREASURY_WALLET_NAME=crowdclaw-main
TREASURY_RETRY_MS=15000
SLRD_MASTER_KEY=change-me

ALLOW_DEV_FUNDING=0
```

CrowdClaw does not duplicate provider credential validation. `jsx-ai` owns provider/runtime/auth behavior. `JSX_AI_RUNTIME` is passed explicitly into `runAgent()`.

## Run

```sh
cp .env.example .env
bun install
bun run dev
```

bgrun dashboard:

```sh
bun run bgrun
```

Verification:

```sh
bun run verify
```

Health:

```text
/api/health
/api/health/live
/api/health/ready
```
