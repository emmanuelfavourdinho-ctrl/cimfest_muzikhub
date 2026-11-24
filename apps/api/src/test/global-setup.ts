import { execFileSync } from 'node:child_process';

/** Brings the test database schema up to date before any test file runs. */
export default function setup() {
  const url = process.env.TEST_DATABASE_URL ?? 'postgresql://muzikhub:muzikhub_dev_password@localhost:5435/muzikhub_test?schema=public';
  if (!/muzikhub_test/.test(url)) {
    throw new Error('Refusing to run tests: the test DATABASE_URL must point at a *_test database.');
  }
  execFileSync('npx', ['prisma', 'migrate', 'deploy'], {
    env: { ...process.env, DATABASE_URL: url, PRISMA_HIDE_UPDATE_MESSAGE: '1' },
    stdio: 'pipe',
  });
}
