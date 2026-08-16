import { serve } from "tradjs/server";
import { startAgentWorker } from "./src/server/worker/worker";

if (process.env.EMBEDDED_WORKER !== "0") startAgentWorker();

await serve({
  appDir: "./app",
  globalCss: "./app/globals.css",
  defaultTitle: "CrowdClaw",
  port: Number(process.env.PORT || 3000),
});
