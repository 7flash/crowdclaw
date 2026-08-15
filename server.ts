import { serve } from "tradjs/server";

await serve({
  appDir: "./app",
  globalCss: "./app/globals.css",
  defaultTitle: "CrowdClaw",
  port: Number(process.env.PORT || 3000),
});
