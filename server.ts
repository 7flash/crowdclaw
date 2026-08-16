import { serve } from "tradjs/server";
import {
  assertRuntimeConfig,
  embeddedWorkerEnabled,
} from "./src/server/config";
import { log } from "./src/server/log";
import { startAgentWorker } from "./src/server/worker/worker";

assertRuntimeConfig("web");

const stopWorker = embeddedWorkerEnabled() ? startAgentWorker() : () => {};
let shuttingDown = false;

function shutdown(signal: string): void {
  if (shuttingDown) return;
  shuttingDown = true;
  log("info", "server.shutdown", { signal });
  stopWorker();
  setTimeout(() => process.exit(0), 250);
}

process.once("SIGTERM", () => shutdown("SIGTERM"));
process.once("SIGINT", () => shutdown("SIGINT"));

const port = Number(process.env.PORT || 3000);
log("info", "server.starting", {
  port,
  embeddedWorker: embeddedWorkerEnabled(),
});

try {
  await serve({
    appDir: "./app",
    globalCss: "./app/globals.css",
    defaultTitle: "CrowdClaw",
    port,
  });
} finally {
  stopWorker();
}
