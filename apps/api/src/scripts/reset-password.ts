// Recovery for a forgotten password (ADR 0011). homestorm sends no email, so the admin runs this in the API pod:
//
//   kubectl -n homestorm exec deploy/homestorm-api -- node --import tsx src/scripts/reset-password.ts you@example.com
//
// It sets a random one-time password, ends every session, and prints the password ONCE to this terminal (never to
// the logs). Sign in with it, then change it in the account menu.

import { randomBytes } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { auth } from "../auth.js";
import { closeDb, db } from "../db/index.js";
import { accounts, sessions, users } from "../db/schema.js";
import { log } from "../lib/logger.js";

const email = process.argv[2]?.trim().toLowerCase();
if (!email) {
  process.stderr.write("usage: reset-password.ts <email>\n");
  process.exit(2);
}

const [user] = await db.select().from(users).where(eq(users.email, email));
if (!user) {
  process.stderr.write(`No login with the email ${email}.\n`);
  await closeDb();
  process.exit(1);
}

const password = randomBytes(12).toString("base64url"); // 16 characters
const ctx = await auth.$context;
const hash = await ctx.password.hash(password);
await db.transaction(async (tx) => {
  await tx
    .update(accounts)
    .set({ password: hash, updatedAt: new Date() })
    .where(and(eq(accounts.userId, user.id), eq(accounts.providerId, "credential")));
  await tx.delete(sessions).where(eq(sessions.userId, user.id));
});
// The event is logged; the password is not.
log.info(
  { event: "login.password_reset_cli", user_id: user.id },
  "password reset from the command line",
);
process.stdout.write(
  `New one-time password for ${user.email}: ${password}\n` +
    "Every session was signed out. Sign in, then change it in the account menu.\n",
);
await closeDb();
process.exit(0);
