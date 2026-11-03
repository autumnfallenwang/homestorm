// Postgres NOTICEs must not reach stdout as plain text: every log line is one JSON object (lib/logger.ts).
import { sql } from "drizzle-orm";
import { afterAll, describe, expect, it, vi } from "vitest";
import { hasTestDb } from "../test/db.js";
import { closeDb, db } from "./index.js";

describe.skipIf(!hasTestDb)("database client (integration)", () => {
  afterAll(closeDb);

  it("sends Postgres notices to the logger instead of console.log", async () => {
    const consoleLog = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      // The same notice the boot migration gets on every restart.
      await db.execute(sql`CREATE SCHEMA IF NOT EXISTS public`);
      await db.execute(sql`DO $$ BEGIN RAISE NOTICE 'homestorm notice test'; END $$`);
      expect(consoleLog).not.toHaveBeenCalled();
    } finally {
      consoleLog.mockRestore();
    }
  });
});
