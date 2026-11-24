import type { HealthResponse } from '@muzikhub/shared';

export type DatabaseCheck = () => Promise<boolean>;

/** Business logic for the health check, kept out of the route handler. */
export async function getHealth(checkDatabase: DatabaseCheck): Promise<HealthResponse> {
  const databaseUp = await checkDatabase().catch(() => false);
  return {
    status: databaseUp ? 'ok' : 'degraded',
    timestamp: new Date().toISOString(),
    uptimeSeconds: Math.round(process.uptime() * 100) / 100,
    services: { database: databaseUp ? 'up' : 'down' },
  };
}
