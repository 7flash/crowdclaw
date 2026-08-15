# CrowdClaw — TradJS rewrite

A small Bun + TradJS rewrite of CrowdClaw. It keeps the original flow:

> describe a game → plan three milestones → fund the next milestone → stream a generated playable HTML game → ship a version → append the next milestone

The React/`window.storage` prototype is replaced with a server-owned Anthropic integration and SQLite persistence.

## Stack

- **Runtime:** Bun
- **Server / routing / SSR:** `tradjs/server`
- **Frontend:** `tradjs/client` (no React)
- **Styles:** Tailwind CSS v4 + a small `globals.css` layer for the original CrowdClaw tokens/animations
- **Database:** `sqlite-zod-orm`
- **Observability:** `measure-fn` with nested `measure(..., async m => m(...))` spans
- **Agent:** Anthropic Messages API, streamed server-side

## Run

```bash
cp .env.example .env
# set ANTHROPIC_API_KEY in .env
bun install
bun run dev
```

Open `http://localhost:3000`.

Production:

```bash
bun run start
```

Checks:

```bash
bun run check
bun test
```

## Environment

```dotenv
ANTHROPIC_API_KEY=replace-me
ANTHROPIC_MODEL=claude-sonnet-4-6
ANTHROPIC_MAX_TOKENS=1000
PORT=3000
DATABASE_PATH=./data/crowdclaw.sqlite
```

`ANTHROPIC_MODEL` and `ANTHROPIC_MAX_TOKENS` are configurable, while the defaults preserve the prototype's model/token behavior.

## Project layout

```text
app/
  layout.tsx                       # SSR document shell
  page.tsx                         # SSR mount target
  page.client.tsx                  # TradJS client state/controller
  globals.css                      # Tailwind + preserved visual tokens
  api/games/route.ts               # list games
  api/games/plan/route.ts          # stream plan + create game
  api/games/[id]/route.ts          # game + versions
  api/games/[id]/fund/route.ts     # add to off-chain pool
  api/games/[id]/run/route.ts      # stream/build/ship next milestone
src/
  client/
    api.ts                         # fetch + NDJSON reader
    state.ts                       # tiny frontend state model
    components/                    # stateless TradJS JSX views
  server/
    agent/                         # prompts, Anthropic streaming, parser/sealer
    db/                            # sqlite-zod-orm schema + repository
    services/game-service.ts       # measured plan/build workflows
    http.ts                        # JSON, wallet, NDJSON helpers
  shared/                          # DTOs + constants
```

## Reliability choices

### Server-owned agent calls

The browser never receives the Anthropic API key. Both planning and game generation are proxied through server API routes.

### Streaming without framework state machinery

Plan/build endpoints return newline-delimited JSON events. The client reads the response body incrementally and rerenders with `tradjs/client`.

Event shapes are intentionally tiny:

```ts
{ type: "stream", text: "...accumulated agent output..." }
{ type: "say", text: "...agent thought line..." }
{ type: "complete", game, version? }
{ type: "error", message }
```

### SQLite persistence

The old browser storage keys are replaced with two tables:

- `games` — prompt, summary, milestone JSON, pool/spend totals, creator wallet, progress
- `versions` — generated self-contained HTML by game/version

Only the newest four versions are retained, matching the prototype behavior. The games index is limited to the newest 30 rows in the UI/API.

### Atomic shipping

A completed build is charged and shipped in one SQLite transaction. Before committing, the server rechecks:

1. the game still exists,
2. `done` is still the milestone that was built,
3. the pool still covers the milestone.

If the generated HTML is missing/too short, nothing is charged.

### Build serialization

An in-process per-game lock prevents two agent builds for the same game from running at the same time. The transaction's `expectedDone` check is the second line of defense.

### Nested `measure-fn`

The plan/build service is intentionally structured as a measured tree, for example:

```ts
measure("game.build", async (m) => {
  const game = await m("db.load-game", ...);
  const versions = await m("db.load-versions", ...);
  const full = await m("agent.build", ...);
  const parsed = await m("agent.parse-build", ...);
  return await m("db.ship-milestone", ...);
});
```

This keeps timing/error boundaries visible without scattering custom logging through each function.

## Preserved product behavior

- Same planning and build system prompts.
- Same three seed ideas.
- First plan produces exactly three milestones with costs 1–4.
- Generated games remain one self-contained HTML file with no imports/CDNs/localStorage.
- Build continuation retries until `</html>` appears (up to five passes).
- Last-resort HTML sealing remains.
- Milestones cost from the shared pool and are charged only after a usable file exists.
- Each successful build may append one agent-proposed next milestone, capped at 14 milestones.
- Four latest playable versions are retained.
- Play/code tabs and sandboxed iframe remain.
- Shared data refreshes every eight seconds while a game is open.
- The random 44-character wallet remains a lightweight browser identity and is stored in `localStorage`; funding is still an **off-chain demo pool**, not a real wallet/payment integration.

## Notes

- This is intentionally a single-process SQLite/Bun app. If you later run multiple app processes, replace the in-memory build lock with a database-backed lease/job queue.
- Google Fonts are still used by the CrowdClaw UI to preserve the original appearance. Generated games themselves are still forbidden from external fonts/requests by the build prompt.
- Existing `window.storage` prototype data is not automatically migratable from the server because it lived in the browser environment. New data is persisted in `data/crowdclaw.sqlite`.
