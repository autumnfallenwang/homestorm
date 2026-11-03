// Integration test helpers. Integration tests run only against TEST_DATABASE_URL (see vitest.config.ts).
import { sql } from "drizzle-orm";
import { db } from "../db/index.js";

export const hasTestDb = Boolean(process.env.TEST_DATABASE_URL);

/** Empty every table, Better Auth's included. */
export async function truncateAll(): Promise<void> {
  await db.execute(
    sql`TRUNCATE messages, rounds, seats, meetings, sessions, accounts, verifications, users RESTART IDENTITY CASCADE`,
  );
}
