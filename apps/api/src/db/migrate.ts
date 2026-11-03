// Schema migrations at API boot (see docs/data-model.md, "Migrations").
//
// The API applies apps/api/drizzle/*.sql itself, before it opens its port. There is only ever one API process
// (Recreate, replicas 1: ADR 0010), so two migrations never race. This replaced the sibling apps' Helm pre-install
// hook: on a first install that hook runs before the Postgres StatefulSet exists and waits forever.

import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { log } from "../lib/logger.js";
import type { Database } from "./index.js";

const MIGRATIONS = fileURLToPath(new URL("../../drizzle", import.meta.url));

/** Apply pending migrations, waiting up to `waitMs` for Postgres to accept connections (it may still be starting). */
export async function migrateOnBoot(db: Database, waitMs = 90_000): Promise<void> {
  const deadline = Date.now() + waitMs;
  for (let attempt = 1; ; attempt++) {
    try {
      await migrate(db, { migrationsFolder: MIGRATIONS });
      log.info({ event: "db.migrated", attempt }, "database schema up to date");
      return;
    } catch (err) {
      const code =
        (err as { code?: string; cause?: { code?: string } }).code ??
        (err as { cause?: { code?: string } }).cause?.code;
      const notReady = ["ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN", "57P03", "ECONNRESET"].includes(
        code ?? "",
      );
      if (!notReady || Date.now() > deadline) throw err;
      log.warn({ event: "db.waiting", attempt, code }, "database not ready yet");
      await new Promise((r) => setTimeout(r, 2_000));
    }
  }
}
