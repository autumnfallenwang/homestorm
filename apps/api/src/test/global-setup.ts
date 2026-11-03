// Creates and migrates the test database once per run, when TEST_DATABASE_URL is set.
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

export default async function setup() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) return;
  const name = new URL(url).pathname.slice(1);
  if (!/^[a-z0-9_]+_test$/.test(name))
    throw new Error(`Refusing to use "${name}": test databases end in _test`);

  const admin = postgres(url.replace(/\/[^/]+$/, "/postgres"), { max: 1, onnotice: () => {} });
  const [exists] = await admin`SELECT 1 FROM pg_database WHERE datname = ${name}`;
  if (!exists) await admin.unsafe(`CREATE DATABASE ${name}`);
  await admin.end();

  const client = postgres(url, { max: 1, onnotice: () => {} });
  await migrate(drizzle(client), {
    migrationsFolder: new URL("../../drizzle", import.meta.url).pathname,
  });
  await client.end();
}
