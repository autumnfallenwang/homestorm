import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { config } from "./config.js";
import { closeDb } from "./db/index.js";
import { log } from "./lib/logger.js";

// ★ A crash is one JSON line at `fatal`, not a stack printed across dozens of Loki entries. Exit either way: state
// after an uncaught error is unknown, and k8s restarts the pod.
process.on("uncaughtException", (err) => {
  log.fatal({ event: "process.crash", kind: "uncaughtException", err }, "process crashed");
  process.exit(1);
});
process.on("unhandledRejection", (reason) => {
  const err = reason instanceof Error ? reason : new Error(String(reason));
  log.fatal({ event: "process.crash", kind: "unhandledRejection", err }, "process crashed");
  process.exit(1);
});

if (!config.databaseUrl) {
  log.fatal({ event: "config.error" }, "DATABASE_URL is required");
  process.exit(1);
}
// Sessions are signed with it (ADR 0011). Without it Better Auth would use a default secret: refuse to start.
if (!config.betterAuthSecret) {
  log.fatal({ event: "config.error" }, "BETTER_AUTH_SECRET is required");
  process.exit(1);
}

const app = createApp();

const server = serve({ fetch: app.fetch, port: config.apiPort }, (info) => {
  log.info(
    { event: "server.start", port: info.port, llmgw_url: config.llmgwUrl },
    "api server listening",
  );
});

/**
 * Graceful stop. k8s sends SIGTERM and waits 30 s: stop taking requests, close the DB pool, exit.
 * ⚠️ Only reachable because the container runs `node` directly, not `pnpm … start`.
 */
let stopping = false;
async function shutdown(signal: string) {
  if (stopping) return;
  stopping = true;
  log.info({ event: "server.shutdown", signal }, "shutting down");
  setTimeout(() => process.exit(0), 20_000).unref();
  server.close();
  await closeDb();
  log.info({ event: "server.stopped" }, "shut down cleanly");
  process.exit(0);
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
