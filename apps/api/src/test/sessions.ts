// Fake sessions for route tests: `createApp({ resolveSession: asAdmin })` runs a route as the admin without Better
// Auth. The real session path is covered by auth.integration.test.ts.

import type { ResolveSession, SessionUser } from "../middleware/auth.js";

export const ADMIN: SessionUser = {
  id: "00000000-0000-4000-8000-00000000000a",
  name: "Test Chair",
  email: "chair@example.com",
};

export const asAdmin: ResolveSession = async () => ADMIN;
export const asNobody: ResolveSession = async () => null;
