/**
 * LAST-RESORT recovery: disables two-factor for a staff account that lost its authenticator AND
 * its backup codes, when no other administrator can reset it from the Admin Console.
 *
 *   npm run admin:reset-two-factor -w @muzikhub/api -- --email you@example.com --reason "Lost phone"
 *
 * Signs the account out everywhere. Recorded in the audit log. Prefer backup codes, or ask
 * another administrator to use "Reset two-factor" in the console.
 */
import { createInterface } from 'node:readline/promises';
import { prisma } from '../lib/prisma.js';
import { BootstrapError, resetTwoFactorFromCli } from '../modules/admin/bootstrap.js';

const arg = (name: string) => {
  const i = process.argv.indexOf(name);
  return i !== -1 ? process.argv[i + 1] : undefined;
};

try {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const email = arg('--email') ?? (await rl.question('Email of the account: '));
  const reason = arg('--reason') ?? (await rl.question('Reason (recorded in the audit log): '));
  const confirm = await rl.question('Type RESET to disable two-factor for this account: ');
  rl.close();
  if (confirm.trim() !== 'RESET') throw new BootstrapError('CANCELLED', 'Cancelled.');
  await resetTwoFactorFromCli(email, reason);
  console.log('✓ Two-factor disabled and sessions revoked. The person must set it up again before using the Admin Console.');
  process.exitCode = 0;
} catch (e) {
  console.error(e instanceof BootstrapError ? `✗ ${e.message}` : `✗ Failed: ${(e as Error).message}`);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
