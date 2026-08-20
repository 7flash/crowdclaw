# CrowdClaw cumulative hotfix

This ZIP includes the earlier production-hardening patch plus the rendering/SQLite hotfix.

## Earlier fixes kept

- production admin APIs fail closed without `CROWDCLAW_ADMIN_TOKEN`
- `.env.example` matches the Solana / `@solard/sdk` runtime
- `@solard/sdk` is a direct server dependency
- `bun.lock` is no longer ignored (run `bun install`, then commit the generated lockfile)
- process-wide backstop rate limits on model-triggering public routes
- generated preview/artifact responses receive CSP sandboxing

## Rendering hotfix

- repairs the legacy `render(shell, root)` pattern when `shell` is an actual `HTMLElement`
- transparently recompiles already-shipped affected artifacts, so existing V1/V2/V3/V4 can render
- cache-busts artifact iframe URLs with `?runtime=2` so previously cached black versions are re-requested
- teaches the build agent the exact TradJS rule: `render()` receives JSX/h() vnodes, never DOM nodes
- validation now checks for a real mount strategy instead of merely searching for the text `render(`
- game runtime displays a visible error panel if `mount()` throws or leaves `#game-root` empty

## SQLite/funding hotfix

- waiting agents respect `FUNDING_SYNC_MS` instead of forcing a write path every agent poll
- unchanged Solana balances do not write to SQLite every poll; only a 60s heartbeat is persisted
- a `database is locked` error no longer immediately triggers another DB write via `setFundingError`
- adds a small bounded retry around SQLite writes/transactions
- fixes stale `Watch project ETH` / Robinhood comments to Solana wording

## Apply

```sh
unzip -o crowdclaw-cumulative-hotfix.zip -d /root/crowdclaw
cd /root/crowdclaw
bun install
bun run verify
# restart the CrowdClaw server/keeper after verify succeeds
```

No database migration is required for this patch. Existing affected artifacts are repaired at serve time from their embedded `game.tsx` source.
