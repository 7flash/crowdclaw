import { assertRuntimeConfig } from "./src/server/config";
import { log } from "./src/server/log";
import { startAgentWorker } from "./src/server/worker/worker";

assertRuntimeConfig("worker");
const stop = startAgentWorker();
let shuttingDown = false;

function shutdown(signal: string): void {
  if (shuttingDown) return;
  shuttingDown = true;
  log("info", "worker.shutdown", { signal });
  stop();
  setTimeout(() => process.exit(0), 250);
}

process.once("SIGTERM", () => shutdown("SIGTERM"));
process.once("SIGINT", () => shutdown("SIGINT"));
log("info", "worker.process.ready", { pid: process.pid });
