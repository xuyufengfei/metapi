import { FastifyInstance } from 'fastify';
import { db, schema } from '../../db/index.js';
import { config } from '../../config.js';
import { eq } from 'drizzle-orm';
import { formatUtcSqlDateTime } from '../../services/localTimeService.js';
import { createRateLimitGuard } from '../../middleware/requestRateLimit.js';
import { FACTORY_RESET_ADMIN_TOKEN } from '../../services/factoryResetService.js';

const MIN_ADMIN_TOKEN_LENGTH = 12;

function normalizeToken(token: string | undefined | null): string {
  return (token || '').trim();
}

function isDefaultAdminTokenInUse(): boolean {
  return normalizeToken(config.authToken) === normalizeToken(FACTORY_RESET_ADMIN_TOKEN);
}

const limitAdminTokenChange = createRateLimitGuard({
  bucket: 'auth-change',
  max: 3,
  windowMs: 60_000,
});

export async function authRoutes(app: FastifyInstance) {
  // Change admin auth token (requires old token verification)
  app.post<{ Body: { oldToken: string; newToken: string } }>(
    '/api/settings/auth/change',
    { preHandler: [limitAdminTokenChange] },
    async (request, reply) => {
    const { oldToken, newToken } = request.body;
    const cleanOldToken = normalizeToken(oldToken);
    const cleanNewToken = normalizeToken(newToken);
    const currentAuthToken = normalizeToken(config.authToken);
    const defaultAdminToken = normalizeToken(FACTORY_RESET_ADMIN_TOKEN);

    if (!cleanOldToken || !cleanNewToken) {
      return reply.code(400).send({ success: false, message: '请填写所有字段' });
    }

    if (cleanNewToken.length < MIN_ADMIN_TOKEN_LENGTH) {
      return reply.code(400).send({ success: false, message: `新 Token 至少 ${MIN_ADMIN_TOKEN_LENGTH} 个字符` });
    }

    if (cleanNewToken === defaultAdminToken) {
      return reply.code(400).send({ success: false, message: '不能继续使用默认管理员 Token' });
    }

    if (cleanOldToken !== currentAuthToken) {
      return reply.code(403).send({ success: false, message: '旧 Token 验证失败' });
    }

    // Save to settings table
    const existing = await db.select().from(schema.settings).where(eq(schema.settings.key, 'auth_token')).get();
    if (existing) {
      await db.update(schema.settings).set({ value: JSON.stringify(cleanNewToken) }).where(eq(schema.settings.key, 'auth_token')).run();
    } else {
      await db.insert(schema.settings).values({ key: 'auth_token', value: JSON.stringify(cleanNewToken) }).run();
    }

    // Update runtime config
    config.authToken = cleanNewToken;

    try {
      const createdAt = formatUtcSqlDateTime(new Date());
      await db.insert(schema.events).values({
        type: 'token',
        title: '管理员登录令牌已更新',
        message: '管理员登录 Token 已被修改，请使用新 Token 登录。',
        level: 'warning',
        relatedType: 'settings',
        createdAt,
      }).run();
    } catch {}

    return { success: true, message: 'Token 已更新', requirePasswordChange: isDefaultAdminTokenInUse() };
    },
  );

  // Get masked current token (for display)
  app.get('/api/settings/auth/info', async () => {
    const token = config.authToken;
    const masked = token.length > 8
      ? token.slice(0, 4) + '****' + token.slice(-4)
      : '****';
    return { masked, requirePasswordChange: isDefaultAdminTokenInUse() };
  });
}
