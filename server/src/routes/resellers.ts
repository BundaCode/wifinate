import type { FastifyInstance } from 'fastify';
import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema, sqlite } from '../db.js';
import { hashPassword } from '../crypto.js';
import { requireAdmin, requireAuth } from './auth.js';

const id = (req: { params: unknown }) => Number((req.params as { id: string }).id);

function ledgerOf(userId: number, limit = 100) {
  return db.select().from(schema.resellerLedger).where(eq(schema.resellerLedger.userId, userId))
    .orderBy(desc(schema.resellerLedger.id)).limit(limit).all();
}

function statsOf(userId: number) {
  const startMonth = (() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1).getTime(); })();
  return sqlite.prepare(`
    SELECT
      (SELECT COUNT(*) FROM vouchers WHERE reseller_id = @u) AS vouchers,
      (SELECT COUNT(*) FROM vouchers WHERE reseller_id = @u AND status = 'new') AS unused,
      (SELECT COUNT(*) FROM vouchers WHERE reseller_id = @u AND status != 'new') AS used,
      (SELECT COALESCE(-SUM(amount),0) FROM reseller_ledger WHERE user_id = @u AND type = 'purchase' AND created_at >= @m) AS spentMonth,
      (SELECT COALESCE(SUM(amount),0) FROM reseller_ledger WHERE user_id = @u AND type = 'topup') AS topupTotal
  `).get({ u: userId, m: startMonth }) as { vouchers: number; unused: number; used: number; spentMonth: number; topupTotal: number };
}

/** Ubah saldo + catat di buku saldo dalam satu transaksi. */
function changeBalance(userId: number, amount: number, type: 'topup' | 'adjust' | 'refund', note: string | undefined, by: number) {
  return sqlite.transaction(() => {
    const u = db.select().from(schema.users).where(and(eq(schema.users.id, userId), eq(schema.users.role, 'reseller'))).get();
    if (!u) throw Object.assign(new Error('Reseller tidak ditemukan'), { statusCode: 404 });
    const next = u.balance + amount;
    if (next < 0) throw Object.assign(new Error('Saldo tidak boleh minus.'), { statusCode: 400 });
    db.update(schema.users).set({ balance: next }).where(eq(schema.users.id, userId)).run();
    db.insert(schema.resellerLedger).values({ userId, type, amount, balanceAfter: next, note, createdBy: by, createdAt: Date.now() }).run();
    return next;
  })();
}

export default async function resellerRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAuth);

  // ---------- Untuk reseller sendiri ----------
  app.get('/api/reseller/me', async (req, reply) => {
    if (req.user.role !== 'reseller') return reply.code(403).send({ message: 'Khusus akun reseller.' });
    const u = db.select().from(schema.users).where(eq(schema.users.id, req.user.id)).get()!;
    return { name: u.name, phone: u.phone, balance: u.balance, discountPct: u.discountPct, stats: statsOf(u.id), ledger: ledgerOf(u.id, 50) };
  });

  // ---------- Untuk admin ----------
  app.register(async (admin) => {
    admin.addHook('preHandler', requireAdmin);

    admin.get('/api/resellers', async () => {
      const list = db.select().from(schema.users).where(eq(schema.users.role, 'reseller')).orderBy(schema.users.name).all();
      return list.map(({ passwordHash: _p, ...u }) => ({ ...u, stats: statsOf(u.id) }));
    });

    admin.post('/api/resellers', async (req, reply) => {
      const body = z.object({
        name: z.string().min(2, 'Nama minimal 2 huruf'),
        username: z.string().min(3, 'Username minimal 3 huruf').regex(/^[a-z0-9_.]+$/i, 'Username tanpa spasi'),
        password: z.string().min(6, 'Password minimal 6 karakter'),
        phone: z.string().max(20).optional().nullable(),
        discountPct: z.coerce.number().int().min(0).max(90).default(10),
        initialBalance: z.coerce.number().int().min(0).default(0),
      }).parse(req.body);
      const exists = db.select().from(schema.users).where(eq(schema.users.username, body.username.toLowerCase())).get();
      if (exists) return reply.code(409).send({ message: 'Username sudah dipakai.' });
      const u = db.insert(schema.users).values({
        name: body.name, username: body.username.toLowerCase(), passwordHash: hashPassword(body.password), role: 'reseller',
        phone: body.phone ?? null, discountPct: body.discountPct, balance: 0, active: true, createdAt: Date.now(),
      }).returning({ id: schema.users.id }).get();
      if (body.initialBalance > 0) changeBalance(u.id, body.initialBalance, 'topup', 'Saldo awal', req.user.id);
      return u;
    });

    admin.put('/api/resellers/:id', async (req) => {
      const body = z.object({
        name: z.string().min(2), phone: z.string().max(20).nullable(), discountPct: z.coerce.number().int().min(0).max(90),
        active: z.boolean(), password: z.string().min(6, 'Password minimal 6 karakter').optional().or(z.literal('')),
      }).partial().parse(req.body);
      const { password, ...rest } = body;
      const patch: Partial<typeof schema.users.$inferInsert> = { ...rest };
      if (password) patch.passwordHash = hashPassword(password);
      db.update(schema.users).set(patch).where(and(eq(schema.users.id, id(req)), eq(schema.users.role, 'reseller'))).run();
      return { ok: true };
    });

    admin.post('/api/resellers/:id/topup', async (req) => {
      const body = z.object({
        amount: z.coerce.number().int().refine((v) => v !== 0, 'Nominal tidak boleh 0'),
        type: z.enum(['topup', 'adjust']).default('topup'),
        note: z.string().max(100).optional(),
      }).parse(req.body);
      if (body.type === 'topup' && body.amount < 0) throw Object.assign(new Error('Isi saldo harus positif.'), { statusCode: 400 });
      return { balance: changeBalance(id(req), body.amount, body.type, body.note, req.user.id) };
    });

    admin.get('/api/resellers/:id/ledger', async (req) => ledgerOf(id(req), 500));

    admin.delete('/api/resellers/:id', async (req, reply) => {
      const u = db.select().from(schema.users).where(and(eq(schema.users.id, id(req)), eq(schema.users.role, 'reseller'))).get();
      if (!u) return reply.code(404).send({ message: 'Reseller tidak ditemukan' });
      if (u.balance > 0) return reply.code(400).send({ message: `Masih ada saldo ${u.balance.toLocaleString('id-ID')}. Kosongkan dulu (koreksi saldo) atau nonaktifkan saja.` });
      db.update(schema.users).set({ active: false }).where(eq(schema.users.id, u.id)).run();
      return { ok: true, message: 'Reseller dinonaktifkan (riwayat tetap tersimpan).' };
    });
  });
}
