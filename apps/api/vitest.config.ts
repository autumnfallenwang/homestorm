import { defineConfig } from "vitest/config";

// Load apps/api/.env so integration tests find TEST_DATABASE_URL. An absent .env is fine: test:fast is DB-free.
try {
  process.loadEnvFile(new URL(".env", import.meta.url));
} catch {
  // no .env: fine for DB-free runs
}

// ⚠️ Tests never touch the dev database: integration tests truncate tables. Point DATABASE_URL at the test one,
// or at nothing (integration tests then skip).
if (process.env.TEST_DATABASE_URL) process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
else delete process.env.DATABASE_URL;
process.env.NODE_ENV = "test";
// Quiet by default; TEST_LOG_LEVEL=info shows the JSON lines.
process.env.LOG_LEVEL = process.env.TEST_LOG_LEVEL ?? "silent";

export default defineConfig({
  test: {
    globals: true,
    include: ["src/**/*.test.ts"],
    globalSetup: ["src/test/global-setup.ts"],
    // Integration test files share one Postgres and truncate tables in beforeEach, so files run one at a time.
    fileParallelism: false,
  },
});
