import { defineConfig } from "vitest/config";

// Load apps/api/.env so integration tests get DATABASE_URL without a manual --env-file. An absent .env is fine:
// test:fast is DB-free, and integration tests skip themselves when DATABASE_URL is unset.
try {
  process.loadEnvFile(new URL(".env", import.meta.url));
} catch {
  // no .env: fine for DB-free runs
}

export default defineConfig({
  test: {
    globals: true,
    include: ["src/**/*.test.ts"],
    // Integration test files share one Postgres and truncate tables in beforeEach, so files run one at a time.
    fileParallelism: false,
  },
});
