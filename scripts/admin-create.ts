/**
 * Grant the admin role to an existing, email-verified account. Operator use only:
 *
 *   npm run admin:create -- --email someone@example.com          (development)
 *   node worker/admin-create.mjs --email someone@example.com     (production image)
 *
 * There is deliberately no API for this. It connects as the application role and acts in
 * the database's `system` context, the only context the users guard trigger accepts for
 * creating administrators, and writes an audit entry naming the operator.
 */
import { userInfo } from "node:os";
import { parseArgs } from "node:util";

import { getPool } from "@/db";
import { grantAdminRole } from "@/modules/users";

async function main(): Promise<void> {
  const { values } = parseArgs({ options: { email: { type: "string" } } });
  if (!values.email) throw new Error("Usage: admin:create --email <address>");
  const operator = process.env.BOOKWISE_OPERATOR ?? userInfo().username;
  try {
    const user = await grantAdminRole(values.email, operator);
    console.log(`${user.email} is now an administrator (user id ${user.id}).`);
  } finally {
    await getPool().end();
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
