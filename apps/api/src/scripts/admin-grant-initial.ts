/**
 * Grants the ADMIN role to the first administrator (an existing account with a verified email).
 *
 *   npm run admin:grant-initial -w @muzikhub/api -- --email you@example.com
 *   npm run admin:grant-initial -w @muzikhub/api            # prompts for the email
 *
 * Refuses if an administrator already exists; safe to re-run. Recorded in the audit log.
 * The email is never stored in code or config.
 */
import { createInterface } from 'node:readline/promises';
import { prisma } from '../lib/prisma.js';
import { BootstrapError, grantInitialAdmin } from '../modules/admin/bootstrap.js';

async function emailFromArgsOrPrompt(): Promise<string> {
  const i = process.argv.indexOf('--email');
  if (i !== -1 && process.argv[i + 1]) return process.argv[i + 1]!;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question('Email of the existing, verified account to make the first administrator: ');
  rl.close();
  return answer;
}

try {
  const { changed } = await grantInitialAdmin(await emailFromArgsOrPrompt());
  console.log(
    changed
      ? '✓ Administrator role granted. Sign in, then set up two-factor authentication at /admin to open the Admin Console.'
      : '✓ No change: that account is already the administrator.',
  );
  process.exitCode = 0;
} catch (e) {
  console.error(e instanceof BootstrapError ? `✗ ${e.message}` : `✗ Failed: ${(e as Error).message}`);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
