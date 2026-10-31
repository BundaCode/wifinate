import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { count, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '../db.js';
import { hashPassword, verifyPassword } from '../crypto.js';
import { saveSettings } from '../services/settings.js';

export interface AuthUser { id: number; username: string; name: string; role: 'admin' | 'kasir' }

declare module '@fastify/jwt' {
  interface FastifyJWT { payload: AuthUser; user: AuthUser }
}

export async function requireAuth(req: FastifyRequest, reply: FastifyReply) {
  try {
    await req.jwtVerify();
  } catch {
    return reply.code(401).send({ message: 'Sesi berakhir, silakan login kembali.' });
  }
}

export async function requireAdmin(req: FastifyRequest, reply: FastifyReply) {
  if (req.user?.role !== 'admin') return reply.code(403).send({ message: 'Hanya admin yang boleh melakukan ini.' });
}

function needsSetup() {
  return (db.select({ n: count() }).from(schema.users).get()?.n ?? 0) === 0;
}

export default async function authRoutes(app: FastifyInstance) {
  app.get('/api/auth/status', async () => ({ needsSetup: needsSetup() }));

  // Pendaftaran pertama kali: membuat akun admin + profil usaha.
  app.post('/api/auth/setup', async (req, reply) => {
    if (!needsSetup()) return reply.code(409).send({ message: 'Aplikasi sudah disiapkan.' });
    const body = z.object({
      businessName: z.string().min(2, 'Nama usaha minimal 2 huruf'),
      name: z.string().min(2),
      username: z.string().min(3, 'Username minimal 3 huruf').regex(/^[a-z0-9_.]+$/i, 'Username tanpa spasi'),
      password: z.string().min(6, 'Password minimal 6 karakter'),
      phone: z.string().optional(),
    }).parse(req.body);

    const user = db.insert(schema.users).values({
      username: body.username.toLowerCase(), name: body.name, passwordHash: hashPassword(body.password), role: 'admin', createdAt: Date.now(),
    }).returning().get();
    saveSettings({ businessName: body.businessName, phone: body.phone ?? '' });
    const payload: AuthUser = { id: user.id, username: user.username, name: user.name, role: user.role };
    return { token: app.jwt.sign(payload, { expiresIn: '30d' }), user: payload };
  });

  app.post('/api/auth/login', async (req, reply) => {
    const body = z.object({ username: z.string(), password: z.string() }).parse(req.body);
    const user = db.select().from(schema.users).where(eq(schema.users.username, body.username.toLowerCase())).get();
    if (!user || !verifyPassword(body.password, user.passwordHash)) {
      return reply.code(401).send({ message: 'Username atau password salah.' });
    }
    const payload: AuthUser = { id: user.id, username: user.username, name: user.name, role: user.role };
    return { token: app.jwt.sign(payload, { expiresIn: '30d' }), user: payload };
  });

  app.get('/api/auth/me', { preHandler: requireAuth }, async (req) => ({ user: req.user }));

  // ----- Manajemen user (admin & kasir) -----
  app.get('/api/users', { preHandler: [requireAuth, requireAdmin] }, async () =>
    db.select({ id: schema.users.id, username: schema.users.username, name: schema.users.name, role: schema.users.role, createdAt: schema.users.createdAt })
      .from(schema.users).all());

  app.post('/api/users', { preHandler: [requireAuth, requireAdmin] }, async (req, reply) => {
    const body = z.object({
      name: z.string().min(2), username: z.string().min(3).regex(/^[a-z0-9_.]+$/i, 'Username tanpa spasi'),
      password: z.string().min(6, 'Password minimal 6 karakter'), role: z.enum(['admin', 'kasir']),
    }).parse(req.body);
    const exists = db.select().from(schema.users).where(eq(schema.users.username, body.username.toLowerCase())).get();
    if (exists) return reply.code(409).send({ message: 'Username sudah dipakai.' });
    const u = db.insert(schema.users).values({
      name: body.name, username: body.username.toLowerCase(), passwordHash: hashPassword(body.password), role: body.role, createdAt: Date.now(),
    }).returning({ id: schema.users.id }).get();
    return u;
  });

  app.delete('/api/users/:id', { preHandler: [requireAuth, requireAdmin] }, async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    if (id === req.user.id) return reply.code(400).send({ message: 'Tidak bisa menghapus akun sendiri.' });
    db.delete(schema.users).where(eq(schema.users.id, id)).run();
    return { ok: true };
  });
}
