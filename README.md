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
- `jsx-ai@0.9.1`
- Codex runtime (`JSX_AI_RUNTIME=codex`)
- `gpt-5.4-mini`
- `@solard/sdk@0.2.3`
- `bgrun@3.14.0`
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

The project page receives the grant and wallet balance over SSE. The handoff is intentionally cinematic: the Home planning state reaches `READY`, performs a normal TradJS 4.3 document navigation, and the project stage immediately becomes the funding/build surface:

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

`jsx-ai` exposes the agent loop while CrowdClaw provides an explicit `public_status` tool for short public updates. These are operational summaries, not hidden chain-of-thought.

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
public_status
complete_milestone
```

`complete_milestone` is only a publication request. CrowdClaw independently validates `index.html` before charging the milestone and publishing the immutable release.

## Supporters and steering

The platform seed is displayed as CrowdClaw but earns zero influence.

Confirmed human donations earn influence proportional to attributed SOL. Supporters can spend that influence on signed steering instructions for future work. Open steering is passed into the next `jsx-ai` build weighted by influence.

## Pages

```text
/
  idea
  one-step structured planning
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

SLRD_MASTER_KEY=change-me
TREASURY_SEED_ENABLED=1
TREASURY_WALLET_NAME=crowdclaw-main
TREASURY_AUTO_CREATE=1
TREASURY_RETRY_MS=15000

ALLOW_DEV_FUNDING=0
```

CrowdClaw does not validate model-provider credentials. `jsx-ai` owns provider selection, Codex login, and API-key validation. CrowdClaw passes `JSX_AI_RUNTIME` explicitly into each `runAgent()` call so detached bgrun agents cannot fall back to provider API transport. The Codex runtime dependency `@openai/codex-sdk` is installed with this project.

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

## Upgrading over an older CrowdClaw checkout

CrowdClaw 4.10.1 includes inert compatibility files for paths used by the retired embedded shared-worker architecture. This makes archive overlays safe: an old `app/middleware.ts` or `src/server/worker/worker.ts` can no longer survive an upgrade and import obsolete configuration such as `workerLeaseMs`.

A clean extraction is still preferred when upgrading major architecture revisions.


## First-run handoff

The first project visit does not open on a dashboard. Before v1 exists, the main stage owns the sequence:

```text
FUNDING
CrowdClaw ───────────────→ +SOL

STARTING

BUILDING
OPEN WORKSPACE
FILES
<jsx-ai status + tool actions>

SHIPPING

V1
<playable iframe>
```

`OPEN WORKSPACE` and `FILES` are emitted from real local work before the first model response, so a slow provider first token cannot make the project look frozen. Once an artifact is published, the same stage becomes the playable release.

### Agent runtime

Initial planning is deliberately **one `runAgent()` model step and one `submit_game_plan` tool call**. There is no provider text stream and there are no automatic planner retries. A 429 therefore becomes a visible `QUOTA` failure instead of silently producing several more requests. The structured result contains the slug, summary, one short public design note, and exactly three milestones; CrowdClaw then reveals that single result progressively over SSE.

Milestone implementation also uses `runAgent()`: JSX describes capabilities, `runAgent()` owns model/tool/history iteration and budgets, while CrowdClaw owns filesystem effects, public activity, artifact validation, persistence, funding, and publication. Every milestone starts with fresh chat history and treats the project workspace as durable state. `complete_milestone` cannot finish a run until host-side validation accepts `index.html`.


## Agent process startup

Project creation is non-blocking. The web process asks bgrun to launch the project agent in the background and returns the new project immediately. The launcher uses `bun project-agent.ts <project-id>` with the project root passed separately to bgrun, which keeps the command portable across Windows and Unix shells. If the child exits during startup, its bgrun stdout/stderr tail is written to the server log and the project surfaces `AGENT ERROR` while the supervisor can retry it.

## Windows + bgrun

Project agents are launched through bgrun with the intentionally simple command:

```text
bun project-agent.ts <project-id>
```

The project root is supplied separately as bgrun's `directory`. Do not wrap `process.execPath` in quotes inside the command string: on Windows bgrun executes the command through `cmd.exe`, and a pre-quoted executable can be treated as a literal command name.



## Gemini schema compatibility

CrowdClaw keeps provider tool schemas intentionally small and validates stricter constraints in the host. This avoids sending unsupported JSON Schema keywords such as `additionalProperties` to Gemini function declarations. Initial planning remains one `runAgent()` model step with no silent provider retries.

## Treasury RPC

`SOLANA_RPC_URL` is the single Solana RPC setting for both CrowdClaw balance/indexing calls and `@solard/sdk` transaction sending. On startup the server logs the `crowdclaw-main` address and its current SOL balance. Fund that wallet before expecting automatic first-milestone sponsorship.


## Observability

CrowdClaw uses the current `measure-fn` action API directly. Nestedness comes from nested `measure()` calls; no child measurement function is injected into callbacks. Important spans use `start`, `end`, metadata, and `catch` only where a fallback is intentional.

Operator logs are deliberately summarized. Model spans report tool names and normalized token usage rather than dumping Gemini raw responses or thought signatures; filesystem spans report actions and sizes; funding spans report lamports/status instead of serializing full project rows.

```text
→ Agent tick p_xxx
  → Plan project
    → Generate roadmap
      → jsx-ai planning agent
        → Plan model 1
        ✓ { tools: [submit_game_plan], usage: ... }
        → Tool submit_game_plan
      ✓ { steps: 1, toolCalls: 1, usage: ... }
    → Publish roadmap

  → Seed project
    → Ensure treasury seed
      → Send treasury SOL
    → Confirm seed

  → Build milestone 1
    → Run build agent
      → Build model 1
      → Tool write_file
      → Tool complete_milestone
    → Validate artifact
    → Publish v1
```

Treasury failures and delayed confirmations are also bounded: a failed/unconfirmed seed waits `TREASURY_RETRY_MS` before another send/reconciliation cycle instead of hot-looping every agent tick. A newly submitted transfer still gets a short confirmation burst so v1 can begin quickly when RPC observes it.


## Project UI

The project document uses one live stage and a compact event rail rather than separate status dashboards. Funding, build tool activity, and publication are projected from the authoritative SSE `ProjectBundle`; the playable release replaces the stage when published. See `docs/cinematic-ui.md`.


### Temporary model outages

Gemini `503/502/504`, high-demand responses, network resets and timeouts are treated as temporary infrastructure states. The project remains active, shows `BUSY`, and retries later with exponential backoff. `429` quota errors and malformed/permanent requests remain explicit terminal errors. A retry is a fresh run of the same one-step planner; it is not an extra planning/model step inside `runAgent()`.
