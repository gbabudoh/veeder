import { knex } from '../db/knex';
import { usersRepository, type Role } from '../repositories/usersRepository';

/**
 * Operator CLI: set a user's authorization role.
 *
 * Invoked as `npm run set-role -- <email> <role>` where `role` is exactly
 * `user` or `admin` (primary use: promoting an account to `admin`). This script
 * is the operator-only path for changing roles (Req 1.5) and is deliberately
 * NOT importable by or reachable from any HTTP route (Req 1.4) — role changes
 * are never exposed over the API.
 *
 * Behavior:
 * - Validates the two positional args; on invalid input prints usage to stderr,
 *   sets a non-zero exit code, and changes nothing.
 * - Resolves the user by normalized email (`trim().toLowerCase()`). When no user
 *   matches, prints `No user found for <email>`, exits non-zero, changes nothing
 *   (Req 1.6).
 * - Otherwise updates the role and prints a confirmation (Req 1.5).
 */

const VALID_ROLES: readonly Role[] = ['user', 'admin'];

function isRole(value: string): value is Role {
  return (VALID_ROLES as readonly string[]).includes(value);
}

async function main(): Promise<void> {
  const [emailArg, roleArg] = process.argv.slice(2);

  if (!emailArg || emailArg.trim().length === 0 || !roleArg || !isRole(roleArg)) {
    process.stderr.write(
      'Usage: npm run set-role -- <email> <role>\n' +
        "  <email>  the user's email address\n" +
        "  <role>   'user' or 'admin'\n",
    );
    process.exitCode = 1;
    return;
  }

  const email = emailArg.trim().toLowerCase();
  const role: Role = roleArg;

  const user = await usersRepository.findByEmail(email);
  if (user === null) {
    process.stderr.write(`No user found for ${email}\n`);
    process.exitCode = 1;
    return;
  }

  await usersRepository.updateRole(user.id, role);
  process.stdout.write(`Updated ${email} \u2192 role=${role}\n`);
}

main()
  .catch((error: unknown) => {
    process.stderr.write(`set-role failed: ${String(error)}\n`);
    process.exitCode = 1;
  })
  .finally(() => {
    void knex.destroy();
  });
