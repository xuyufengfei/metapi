import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { eq } from 'drizzle-orm';

describe('auth first login enforcement api', () => {
  let app: FastifyInstance;
  let db: typeof import('../../db/index.js')['db'];
  let schema: typeof import('../../db/index.js')['schema'];
  let config: typeof import('../../config.js')['config'];
  let FACTORY_RESET_ADMIN_TOKEN: typeof import('../../services/factoryResetService.js')['FACTORY_RESET_ADMIN_TOKEN'];

  beforeAll(async () => {
    process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'metapi-auth-first-login-'));
    await import('../../db/migrate.js');
    const dbModule = await import('../../db/index.js');
    const configModule = await import('../../config.js');
    const authRoutesModule = await import('./auth.js');
    const serviceModule = await import('../../services/factoryResetService.js');
    db = dbModule.db;
    schema = dbModule.schema;
    config = configModule.config;
    FACTORY_RESET_ADMIN_TOKEN = serviceModule.FACTORY_RESET_ADMIN_TOKEN;
    app = Fastify();
    await app.register(authRoutesModule.authRoutes);
  });

  beforeEach(async () => {
    await db.delete(schema.events).run();
    await db.delete(schema.settings).run();
    config.authToken = FACTORY_RESET_ADMIN_TOKEN;
  });

  afterAll(async () => {
    await app.close();
    delete process.env.DATA_DIR;
  });

  it('reports requirePasswordChange when default token is still active', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/settings/auth/info' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ requirePasswordChange: true });
  });

  it('rejects changing the admin token back to the default token', async () => {
    config.authToken = 'custom-admin-token-123';
    const response = await app.inject({
      method: 'POST',
      url: '/api/settings/auth/change',
      payload: { oldToken: 'custom-admin-token-123', newToken: FACTORY_RESET_ADMIN_TOKEN },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ success: false, message: '不能继续使用默认管理员 Token' });
  });

  it('persists the new admin token and clears requirePasswordChange after change', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/settings/auth/change',
      payload: { oldToken: FACTORY_RESET_ADMIN_TOKEN, newToken: 'new-admin-token-1234' },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ success: true, requirePasswordChange: false });

    const saved = await db.select().from(schema.settings).where(eq(schema.settings.key, 'auth_token')).get();
    expect(saved?.value).toBe(JSON.stringify('new-admin-token-1234'));
    expect(config.authToken).toBe('new-admin-token-1234');
  });
});
