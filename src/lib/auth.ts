import { betterAuth } from 'better-auth';
import { APIError, createAuthMiddleware } from 'better-auth/api';
import { db, origin, secret } from './db.ts';
export const allowedAuthPaths = new Set(['/sign-in/email', '/sign-out', '/get-session']);
let instance: ReturnType<typeof createAuth> | undefined;
export function auth() { return instance ??= createAuth(); }
function createAuth() {
  return betterAuth({
    appName: 'RentManager', baseURL: origin(), basePath: '/api/auth', secret: secret(), database: db(),
    trustedOrigins: [origin()],
    emailAndPassword: { enabled: true, disableSignUp: true, requireEmailVerification: false, minPasswordLength: 12, maxPasswordLength: 128 },
    emailVerification: { sendOnSignUp: false, sendOnSignIn: false },
    user: { changeEmail: { enabled: false }, deleteUser: { enabled: false } },
    session: { cookieCache: { enabled: false }, expiresIn: 60 * 60 * 8 },
    advanced: { useSecureCookies: origin().startsWith('https:'), defaultCookieAttributes: { httpOnly: true, sameSite: 'lax' } },
    rateLimit: { enabled: false }, // Atomic shared DB policy in the HTTP boundary.
    logger: { disabled: true },
    hooks: { before: createAuthMiddleware(async ctx => {
      if (!allowedAuthPaths.has(ctx.path)) throw new APIError('FORBIDDEN', { message: 'Endpoint disabled' });
    }) },
    databaseHooks: {
      user: { update: { before: async () => false }, delete: { before: async () => false } },
      account: { update: { before: async () => false }, delete: { before: async () => false } },
      session: { create: { before: async session => {
        const result = await db().query('SELECT 1 FROM employee WHERE auth_user_id=$1 AND active', [session.userId]);
        if (!result.rowCount) throw new APIError('FORBIDDEN', { message: 'Employee unavailable' });
      } } }
    }
  });
}
