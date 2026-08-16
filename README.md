# CrowdClaw — TradJS + jsx-ai autonomous build

CrowdClaw turns a game idea into a durable crowd-funded game-building agent.

The user flow is deliberately small:

**create → watch planning → agent page → play → fund → share**

There is no browser wallet identity, prompt editor, model picker, or manual **Run** button.

## What changed in this build

### Real TradJS pages

Home and a project are separate page applications:

```text
/
  page.tsx
  page.client.tsx

/projects/[id]/
  page.tsx
  page.client.tsx
```

The home page owns only idea creation and the initial three-milestone reveal animation. Once planning is committed, it follows a normal real link to `/projects/:id`. TradJS can intercept that navigation, call the current page cleanup, replace the response body, and mount the project page client script.

Refreshing or directly opening `/projects/:id` works because it is a real server route. The project page renders the current SQLite snapshot before its client script starts polling for live changes.

Every page client owns and cleans up its own timers, fetch abort controller, and UI state. There is no custom `pushState`, `popstate`, or global CrowdClaw page lifecycle.

### `jsx-ai` agent tool loop

The build worker now follows the `jsx-ai` pattern directly:

```tsx
import { callLLM, md } from "jsx-ai";
import type { ExtractedMessage, ToolCall } from "jsx-ai";
```

Each milestone is a bounded tool-use conversation. The model gets:

- `write_file`
- `read_file`
- `list_files`
- `phase_done`

`phase_done` contains:

- the milestone summary
- exactly one rolling next milestone
- its CrowdClaw cost from 1–4

The worker keeps a real project workspace under `WORKSPACE_ROOT/<project-id>`. A later milestone can inspect and edit the files left by earlier milestones instead of receiving an ever-growing full source blob in every prompt.

CrowdClaw still publishes only a self-contained `index.html` as the playable immutable artifact. The agent may keep small supporting files in its workspace, but `index.html` cannot depend on them at runtime. This preserves the existing artifact sandbox/CSP and makes every published version portable.

A model calling `phase_done` is **not** enough to publish. CrowdClaw independently reads `index.html`, seals a nearly-complete document when possible, validates it, and only then atomically publishes the artifact and charges the reserved milestone credits.

### Rolling roadmap

Planning still creates exactly three initial milestones. Each successful tool-loop build proposes one new milestone, so the visible horizon keeps moving:

```text
✓ v1 movement + score
✓ v2 enemies + pressure
→ v3 shooting + health
  v4 waves
  v5 boss
```

After v3 ships, a new milestone is appended automatically.

### Agent usage

Each model/tool run records:

- model
- input tokens
- output tokens
- cache token fields when provided
- latest context usage
- context-window setting
- lifetime project token usage
- project-derived funded token runway
- activity preview and current tool action

`jsx-ai` may expose provider usage in different field shapes, so CrowdClaw normalizes the common shapes. If provider usage is absent, it falls back to a character-based token estimate and marks that run as estimated in the UI with `~`.

`GAME_CONTEXT_WINDOW` is configuration, not a guessed property of the chosen model. Set it to the actual context window for your `GAME_MODEL` if you want the remaining-context meter to be meaningful.

## Project lifecycle

```text
create idea
   ↓
@solard/sdk createWallet()
   ↓
planning
   ↓
three milestones committed
   ↓
waiting_funds ⇄ queued
                  ↓
               working
                  ↓
              validating
                  ↓
              publishing
                  ↓
            artifact shipped
                  ↓
          append next milestone
                  ↓
         queued / waiting_funds
```

The worker owns execution. Closing the browser or navigating between TradJS pages does not affect an agent run.

## Stack

- Bun
- `tradjs/server` + `tradjs/client` 4.2.1
- Tailwind CSS v4
- `jsx-ai`
- `sqlite-zod-orm`
- `measure-fn`
- `@solard/sdk@0.2.3`
- Solana JSON-RPC balance observation

`jsx-ai` is listed as `latest` in this package because no concrete package version was provided with the integration example. Pin it to your published version before a production lockfile/release.

## Configuration

```bash
cp .env.example .env
```

Important values:

```dotenv
GAME_MODEL=gemini-3-flash-preview
GAME_CONTEXT_WINDOW=200000
AGENT_MAX_TOKENS=14000
AGENT_MAX_STEPS=8
AGENT_REQUEST_TIMEOUT_MS=90000

DATABASE_PATH=./data/crowdclaw.sqlite
WORKSPACE_ROOT=./data/workspaces

SOLANA_RPC_URL=https://api.mainnet-beta.solana.com
LAMPORTS_PER_CREDIT=10000000
```

Configure whichever provider credentials your chosen `jsx-ai` model adapter requires in `.env` as well.

`LAMPORTS_PER_CREDIT=10000000` means 0.01 SOL equals one internal CrowdClaw build credit. The project wallet itself remains a Solard-owned wallet; CrowdClaw stores only its public address in the application database.

## Run

```bash
bun install
bun run verify
bun run dev
```

Open `http://localhost:3000`.

By default the TradJS server embeds the worker. To split them:

```bash
EMBEDDED_WORKER=0 bun run start
bun run worker
```

Or:

```bash
docker compose up --build
```

The web and worker containers share `/data`, which contains both the SQLite database and per-project workspaces.

## Reliability boundaries

The production protections from the previous build remain:

- SQLite worker leases
- run-ID guards against late/stale workers
- transactional milestone credit reservation
- failed builds do not charge reserved credits
- idempotent funding high-water accounting
- retry backoff with a terminal failure cap
- model/RPC timeouts
- graceful lease expiry on worker shutdown
- liveness/readiness endpoints
- immutable artifact versions
- restrictive iframe sandbox + artifact CSP

The file tools add their own limits:

- project-root path confinement
- UTF-8 text files only
- per-file size cap
- total workspace size cap
- hidden workspace entries are not exposed to the agent

## Relevant source layout

```text
app/
  page.tsx
  page.client.tsx
  projects/[id]/
    page.tsx
    page.client.tsx
  api/projects/
  artifacts/[projectId]/[version]/route.ts

src/
  client/
    api.ts
    components/
      BrandBar.tsx
      HomeView.tsx
      ProjectApp.tsx
      ProjectView.tsx
  server/
    agent/
      jsx-agent.tsx
      workspace.ts
      output.ts
    db/
    services/
    wallets/
    worker/
```

## Planning vs build prompts

The original CrowdClaw planning contract remains intact: exactly three `M|...|cost` lines, and the first milestone must already be playable.

The old build response protocol (`T|`, `M|`, `CODE|`) is intentionally replaced. With `jsx-ai`, the agent edits a real workspace through tools and finishes through `phase_done`. The gameplay/artifact constraints from the original build prompt are retained in the new `BUILD_SYS_SOURCE`.
