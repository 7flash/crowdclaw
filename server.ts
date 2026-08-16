import { serve } from "tradjs/server";
import { agentSupervisorMs, assertRuntimeConfig } from "./src/server/config";
import { reconcileProjectAgents } from "./src/server/agents/process-manager";
import { log } from "./src/server/log";

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
