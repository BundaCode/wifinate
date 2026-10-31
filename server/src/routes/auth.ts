import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import crypto from 'node:crypto';
import { count, eq, ne, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema, sqlite } from '../db.js';
import { hashPassword, verifyPassword } from '../crypto.js';
import { saveSettings } from '../services/settings.js';

export interface AuthUser { id: number; username: string; name: string; role: 'admin' | 'kasir' | 'reseller'; tv?: number }

declare module '@fastify/jwt' {
  interface FastifyJWT { payload: AuthUser; user: AuthUser }
}

const userStmt = sqlite.prepare('SELECT role, active, token_version AS tv, name FROM users WHERE id = ?');

// ---------- Batas percobaan login ----------
const FAIL_WINDOW = 15 * 60_000;
const MAX_FAIL_ACCOUNT = 5; // per IP + username
const MAX_FAIL_IP = 20; // per IP, semua username
const failures = new Map<string, number[]>();

function recentFails(key: string, now: number) {
  const list = (failures.get(key) ?? []).filter((t) => now - t < FAIL_WINDOW);
  if (list.length) failures.set(key, list); else failures.delete(key);
  return list;
}

/** Sisa waktu terkunci (ms), 0 jika boleh mencoba. */
function lockedFor(ip: string, username: string, now = Date.now()) {
  const acc = recentFails(`${ip}|${username}`, now);
  const all = recentFails(ip, now);
  if (acc.length >= MAX_FAIL_ACCOUNT) return acc[0] + FAIL_WINDOW - now;
  if (all.length >= MAX_FAIL_IP) return all[0] + FAIL_WINDOW - now;
  return 0;
}

function recordFail(ip: string, username: string) {
  const now = Date.now();
  for (const k of [`${ip}|${username}`, ip]) failures.set(k, [...recentFails(k, now), now]);
}

// Bersihkan catatan lama secara berkala agar memori tidak membengkak.
setInterval(() => { const now = Date.now(); for (const k of failures.keys()) recentFails(k, now); }, 10 * 60_000).unref();

// Hash tiruan supaya waktu respons sama walau username tidak ada (tidak bisa menebak username).
const DUMMY_HASH = hashPassword('wifinate-dummy-password');

// ---------- Tiket WebSocket sekali pakai ----------
const wsTickets = new Map<string, { user: AuthUser; exp: number }>();

/** Tiket acak berumur 30 detik, sekali pakai — token login tidak pernah masuk URL. */
export function issueWsTicket(user: AuthUser) {
  const now = Date.now();
  for (const [k, v] of wsTickets) if (v.exp < now) wsTickets.delete(k);
  const ticket = crypto.randomBytes(24).toString('base64url');
  wsTickets.set(ticket, { user, exp: now + 30_000 });
  return ticket;
}

export function consumeWsTicket(ticket: string | undefined): AuthUser | null {
  if (!ticket) return null;
  const t = wsTickets.get(ticket);
  wsTickets.delete(ticket);
  return t && t.exp > Date.now() ? t.user : null;
}

function signFor(app: FastifyInstance, u: { id: number; username: string; name: string; role: AuthUser['role']; tokenVersion: number }) {
  const user: AuthUser = { id: u.id, username: u.username, name: u.name, role: u.role };
  return { token: app.jwt.sign({ ...user, tv: u.tokenVersion }, { expiresIn: '30d' }), user };
}

/** Endpoint yang boleh dipakai reseller. Selain ini ditolak, apa pun route-nya. */
const RESELLER_ALLOWED: [string, RegExp][] = [
  ['GET', /^\/api\/auth\/me$/],
  ['POST', /^\/api\/auth\/password$/],
  ['POST', /^\/api\/auth\/logout-all$/],
  ['GET', /^\/api\/reseller\/me$/],
  ['GET', /^\/api\/packages$/],
  ['GET', /^\/api\/routers$/],
  ['GET', /^\/api\/batches$/],
  ['POST', /^\/api\/vouchers\/generate$/],
  ['GET', /^\/api\/vouchers\/print$/],
];

export async function requireAuth(req: FastifyRequest, reply: FastifyReply) {
  try {
    await req.jwtVerify();
  } catch {
    return reply.code(401).send({ message: 'Sesi berakhir, silakan login kembali.' });
  }
  // Cek ke database setiap permintaan: akun dihapus/nonaktif, password diganti, atau "keluar dari semua perangkat"
  // langsung membatalkan token lama. Peran juga diambil dari database (bukan dari token).
  const u = userStmt.get(req.user.id) as { role: AuthUser['role']; active: number; tv: number; name: string } | undefined;
  if (!u || !u.active || (req.user.tv ?? 0) !== u.tv) {
    return reply.code(401).send({ message: u && !u.active ? 'Akun ini dinonaktifkan. Hubungi pemilik.' : 'Sesi berakhir, silakan login kembali.' });
  }
  req.user.role = u.role;
  req.user.name = u.name;
  if (u.role === 'reseller') {
    const path = req.url.split('?')[0];
    if (!RESELLER_ALLOWED.some(([m, re]) => m === req.method && re.test(path))) {
      return reply.code(403).send({ message: 'Akun reseller tidak boleh mengakses ini.' });
    }
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
    return signFor(app, user);
  });

  app.post('/api/auth/login', async (req, reply) => {
    const body = z.object({ username: z.string().max(100), password: z.string().max(200) }).parse(req.body);
    const username = body.username.toLowerCase().trim();
    const wait = lockedFor(req.ip, username);
    if (wait > 0) {
      return reply.code(429).send({ message: `Terlalu banyak percobaan gagal. Coba lagi dalam ${Math.ceil(wait / 60_000)} menit.` });
    }
    const user = db.select().from(schema.users).where(eq(schema.users.username, username)).get();
    const ok = verifyPassword(body.password, user?.passwordHash ?? DUMMY_HASH) && !!user;
    if (!ok) {
      recordFail(req.ip, username);
      const left = MAX_FAIL_ACCOUNT - recentFails(`${req.ip}|${username}`, Date.now()).length;
      return reply.code(401).send({
        message: left > 0 && left <= 2 ? `Username atau password salah. Sisa ${left} percobaan lagi sebelum dikunci 15 menit.` : 'Username atau password salah.',
      });
    }
    failures.delete(`${req.ip}|${username}`);
    if (!user.active) return reply.code(403).send({ message: 'Akun ini dinonaktifkan. Hubungi pemilik.' });
    return signFor(app, user);
  });

  app.get('/api/auth/me', { preHandler: requireAuth }, async (req) => ({ user: req.user }));

  /** Ganti password sendiri → semua sesi lain otomatis keluar, sesi ini dapat token baru. */
  app.post('/api/auth/password', { preHandler: requireAuth }, async (req, reply) => {
    const body = z.object({ oldPassword: z.string(), newPassword: z.string().min(6, 'Password baru minimal 6 karakter') }).parse(req.body);
    const u = db.select().from(schema.users).where(eq(schema.users.id, req.user.id)).get()!;
    if (!verifyPassword(body.oldPassword, u.passwordHash)) return reply.code(400).send({ message: 'Password lama salah.', fields: { oldPassword: 'Password lama salah.' } });
    const next = db.update(schema.users).set({ passwordHash: hashPassword(body.newPassword), tokenVersion: u.tokenVersion + 1 })
      .where(eq(schema.users.id, u.id)).returning().get();
    return signFor(app, next);
  });

  /** Keluar dari semua perangkat (mis. HP hilang) → semua token lama batal, sesi ini dapat token baru. */
  app.post('/api/auth/logout-all', { preHandler: requireAuth }, async (req) => {
    const next = db.update(schema.users).set({ tokenVersion: sql`${schema.users.tokenVersion} + 1` })
      .where(eq(schema.users.id, req.user.id)).returning().get();
    return signFor(app, next);
  });

  /** Tiket untuk membuka WebSocket (grafik trafik live). */
  app.post('/api/auth/ws-ticket', { preHandler: requireAuth }, async (req, reply) => {
    if (req.user.role === 'reseller') return reply.code(403).send({ message: 'Tidak diizinkan.' });
    return { ticket: issueWsTicket(req.user) };
  });

  // ----- Manajemen user (admin & kasir) -----
  app.get('/api/users', { preHandler: [requireAuth, requireAdmin] }, async () =>
    db.select({ id: schema.users.id, username: schema.users.username, name: schema.users.name, role: schema.users.role, createdAt: schema.users.createdAt })
      .from(schema.users).where(ne(schema.users.role, 'reseller')).all());

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
    // Token akun yang dihapus otomatis tidak berlaku (pengecekan ke database di requireAuth).
    db.delete(schema.users).where(eq(schema.users.id, id)).run();
    return { ok: true };
  });
}
