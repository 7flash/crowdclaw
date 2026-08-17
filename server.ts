import { measure } from "measure-fn";
import { serve } from "tradjs/server";
import {
  agentSupervisorMs,
  assertRuntimeConfig,
  treasurySeedEnabled,
} from "./src/server/config";
import { reconcileProjectAgents } from "./src/server/agents/process-manager";
import { log } from "./src/server/log";
import { getBalanceLamports } from "./src/server/wallets/solana-rpc";
import { getTreasuryWallet } from "./src/server/wallets/solard";
import { SOL_LAMPORTS } from "./src/shared/constants";

assertRuntimeConfig("web");

let shuttingDown = false;
let supervisor: ReturnType<typeof setInterval> | null = null;

function shutdown(signal: string): void {
  if (shuttingDown) return;
  shuttingDown = true;
  if (supervisor) clearInterval(supervisor);
  log("info", "server.shutdown", { signal });
  setTimeout(() => process.exit(0), 100);
}

process.once("SIGTERM", () => shutdown("SIGTERM"));
process.once("SIGINT", () => shutdown("SIGINT"));

const port = Number(process.env.PORT || process.env.BUN_PORT || 3000);
log("info", "server.starting", { port });

if (treasurySeedEnabled()) {
  const treasury = await measure(
    {
      start: () => "Treasury wallet",
      end: (wallet: { name: string; address: string } | null) =>
        wallet || { available: false },
      catch: (error) => {
        log("warn", "treasury.unavailable", {
          error: error instanceof Error ? error.message : String(error),
        });
        return null;
      },
    },
    () => getTreasuryWallet(),
  );

  if (treasury) {
    const balanceLamports = await measure(
      {
        start: () => "Treasury balance",
        end: (lamports: number | null) =>
          lamports == null
            ? { available: false }
            : {
                lamports,
                sol: lamports / SOL_LAMPORTS,
              },
        address: treasury.address,
        catch: (error) => {
          log("warn", "treasury.balance_unavailable", {
            address: treasury.address,
            error: error instanceof Error ? error.message : String(error),
          });
          return null;
        },
      },
      () => getBalanceLamports(treasury.address),
    );

    log("info", "treasury.ready", {
      name: treasury.name,
      address: treasury.address,
      balanceLamports: balanceLamports,
      balanceSol:
        balanceLamports == null ? null : balanceLamports / SOL_LAMPORTS,
    });
    if (balanceLamports === 0)
      log("warn", "treasury.empty", { address: treasury.address });
  }
}

await reconcileProjectAgents();
supervisor = setInterval(
  () => void reconcileProjectAgents(),
  agentSupervisorMs(),
);

await serve({
  appDir: "./app",
  globalCss: "./app/globals.css",
  defaultTitle: "CrowdClaw",
  port,
});

log("info", "server.ready", { port });
