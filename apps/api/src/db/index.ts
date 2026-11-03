import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { log } from "../lib/logger.js";
import * as schema from "./schema.js";

// postgres-js connects lazily (no socket opens until the first query), so building the client here is safe even
// when DATABASE_URL is unset, e.g. unit tests that never touch the DB. index.ts checks DATABASE_URL before any query.
const databaseUrl = process.env.DATABASE_URL ?? "postgres://localhost:5433/homestorm";

/**
 * Postgres NOTICEs go to the JSON logger. postgres-js prints them with console.log by default: multi-line objects
 * that break the one-JSON-line-per-log contract. The boot migration sends two on every restart ("schema drizzle
 * already exists, skipping").
 */
export function logNotice(notice: postgres.Notice): void {
  log.debug({ event: "db.notice", code: notice.code, notice: notice.message }, "postgres notice");
}

const client = postgres(databaseUrl, { onnotice: logNotice });
// casing: "snake_case" must match drizzle.config.ts, so the generated DDL and the runtime SQL agree.
export const db = drizzle(client, { schema, casing: "snake_case" });

export type Database = typeof db;

/** Close the connection pool: graceful shutdown, and integration tests so vitest can exit. */
export async function closeDb(): Promise<void> {
  await client.end();
}
