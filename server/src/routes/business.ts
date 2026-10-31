import type { FastifyInstance } from 'fastify';
import { and, count, desc, eq, gte, inArray, like, or, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema, sqlite } from '../db.js';
import { friendlyRouterError } from '../mikrotik/pool.js';
import { disableVouchers, generateVouchers } from '../services/vouchers.js';
import { renderVouchersPdf } from '../services/pdf.js';
import { salesRows, salesSummary, type SalesFilter } from '../services/reports.js';
import { getSettings, saveSettings } from '../services/settings.js';
import { sendWa } from '../services/notify.js';
import { requireAdmin, requireAuth } from './auth.js';

const packageBody = z.object({
  name: z.string().min(1, 'Nama paket wajib diisi'),
  price: z.coerce.number().int().min(0),
  uptimeLimitMin: z.coerce.number().int().positive().nullable().default(null),
  validityMin: z.coerce.number().int().positive().nullable().default(null),
  rateDown: z.string().regex(/^\d+[kKmM]?$/, 'Contoh: 5M atau 512k').nullable().default(null),
  rateUp: z.string().regex(/^\d+[kKmM]?$/, 'Contoh: 2M atau 512k').nullable().default(null),
  sharedUsers: z.coerce.number().int().min(1).max(50).default(1),
  quotaMb: z.coerce.number().int().positive().nullable().default(null),
  color: z.string().regex(/^#[0-9a-f]{6}$/i).default('#6366f1'),
  active: z.boolean().default(true),
});

function salesFilter(q: Record<string, string | undefined>): SalesFilter {
  const now = Date.now();
  const from = Number(q.from ?? now - 30 * 86_400_000);
  const to = Number(q.to ?? now);
  const span = to - from;
  return {
    from, to,
    routerId: q.routerId ? Number(q.routerId) : undefined,
    packageId: q.packageId ? Number(q.packageId) : undefined,
    channel: q.channel === 'hotspot' || q.channel === 'pppoe' || q.channel === 'reseller' ? q.channel : undefined,
    tzOffsetMin: Number(q.tz ?? 420),
    granularity: (q.granularity as SalesFilter['granularity'])
      ?? (span <= 2 * 86_400_000 ? 'hour' : span > 120 * 86_400_000 ? 'month' : 'day'),
  };
}

export default async function businessRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAuth);

  // ---------- Pengaturan ----------
  // Token gateway WA tidak pernah dikirim ke browser.
  const publicSettings = () => { const { waToken, ...rest } = getSettings(); return { ...rest, waToken: '', waTokenSet: !!waToken }; };
  app.get('/api/settings', async () => publicSettings());
  app.put('/api/settings', { preHandler: requireAdmin }, async (req) => {
    const body = z.object({
      businessName: z.string().min(1), phone: z.string(), address: z.string(), voucherFooter: z.string(),
      brandColor: z.string().regex(/^#[0-9a-f]{6}$/i), codeCharset: z.enum(['numeric', 'alpha', 'alnum']),
      codeLength: z.coerce.number().int().min(4).max(16), codePrefix: z.string().max(6).regex(/^[A-Za-z0-9-]*$/),
      passwordSameAsCode: z.boolean(), printColumns: z.coerce.number().int().min(2).max(6),
      serverUrl: z.string().max(200).refine((v) => v === '' || /^https?:\/\/[^/\s]+$/.test(v.replace(/\/$/, '')), 'Contoh: http://192.168.88.10:8080'),
      loginTitle: z.string().max(60), loginWelcome: z.string().max(200), loginShowPrices: z.boolean(),
      isolirMessage: z.string().max(500), paymentInfo: z.string().max(500),
      waProvider: z.enum(['off', 'fonnte', 'webhook']), waToken: z.string().max(200), waWebhookUrl: z.string().max(300),
      waOwnerNumber: z.string().max(20), notifyRouterDown: z.boolean(), notifyLowStock: z.boolean(),
      lowStockThreshold: z.coerce.number().int().min(1).max(1000), notifyDailySummary: z.boolean(),
      dailySummaryHour: z.coerce.number().int().min(0).max(23), notifyIsolir: z.boolean(), notifyPayment: z.boolean(), notifyCustomer: z.boolean(),
    }).partial().parse(req.body);
    // Token kosong = tidak diubah (browser tidak pernah menerima token lama).
    if (!body.waToken) delete body.waToken;
    saveSettings(body);
    return publicSettings();
  });

  app.post('/api/notify/test', { preHandler: requireAdmin }, async (req, reply) => {
    const { target } = z.object({ target: z.string().optional() }).parse(req.body ?? {});
    const s = getSettings();
    const to = target || s.waOwnerNumber;
    if (!to) return reply.code(400).send({ message: 'Isi nomor WA pemilik terlebih dahulu.' });
    try {
      await sendWa(to, `✅ Tes notifikasi Wifinate berhasil.\nPesan dari ${s.businessName}.`, s);
      return { ok: true };
    } catch (e) {
      return reply.code(502).send({ message: `Gagal mengirim: ${(e as Error).message}` });
    }
  });

  app.get('/api/notify/log', { preHandler: requireAdmin }, async () =>
    db.select().from(schema.notifications).orderBy(desc(schema.notifications.id)).limit(50).all());

  // ---------- Paket ----------
  app.get('/api/packages', async () => {
    const pk = db.select().from(schema.packages).orderBy(schema.packages.price).all();
    const stock = sqlite.prepare(
      `SELECT package_id AS id, SUM(status='new') AS unused, SUM(status='active') AS active FROM vouchers GROUP BY package_id`,
    ).all() as { id: number; unused: number; active: number }[];
    const m = new Map(stock.map((s) => [s.id, s]));
    return pk.map((p) => ({ ...p, unused: m.get(p.id)?.unused ?? 0, activeCount: m.get(p.id)?.active ?? 0 }));
  });
  app.post('/api/packages', { preHandler: requireAdmin }, async (req) =>
    db.insert(schema.packages).values({ ...packageBody.parse(req.body), createdAt: Date.now() }).returning().get());
  app.put('/api/packages/:id', { preHandler: requireAdmin }, async (req) =>
    db.update(schema.packages).set(packageBody.partial().parse(req.body))
      .where(eq(schema.packages.id, Number((req.params as { id: string }).id))).returning().get());
  app.delete('/api/packages/:id', { preHandler: requireAdmin }, async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const used = db.select({ n: count() }).from(schema.vouchers).where(eq(schema.vouchers.packageId, id)).get()?.n ?? 0;
    if (used) {
      db.update(schema.packages).set({ active: false }).where(eq(schema.packages.id, id)).run();
      return reply.send({ ok: true, archived: true, message: 'Paket sudah punya voucher, jadi diarsipkan (tidak dihapus).' });
    }
    db.delete(schema.packages).where(eq(schema.packages.id, id)).run();
    return { ok: true };
  });

  // ---------- Voucher ----------
  app.get('/api/vouchers', async (req) => {
    const q = z.object({
      page: z.coerce.number().int().min(1).default(1),
      pageSize: z.coerce.number().int().min(10).max(500).default(50),
      status: z.enum(['new', 'active', 'expired', 'disabled']).optional(),
      routerId: z.coerce.number().optional(),
      packageId: z.coerce.number().optional(),
      batchId: z.coerce.number().optional(),
      search: z.string().optional(),
    }).parse(req.query);
    const conds: SQL[] = [];
    if (q.status) conds.push(eq(schema.vouchers.status, q.status));
    if (q.routerId) conds.push(eq(schema.vouchers.routerId, q.routerId));
    if (q.packageId) conds.push(eq(schema.vouchers.packageId, q.packageId));
    if (q.batchId) conds.push(eq(schema.vouchers.batchId, q.batchId));
    if (q.search) conds.push(or(like(schema.vouchers.code, `%${q.search}%`), like(schema.vouchers.lastMac, `%${q.search}%`))!);
    const w = conds.length ? and(...conds) : undefined;
    const total = db.select({ n: count() }).from(schema.vouchers).where(w).get()?.n ?? 0;
    const rows = db.select({
      v: schema.vouchers, packageName: schema.packages.name, color: schema.packages.color, routerName: schema.routers.name,
    }).from(schema.vouchers)
      .innerJoin(schema.packages, eq(schema.packages.id, schema.vouchers.packageId))
      .innerJoin(schema.routers, eq(schema.routers.id, schema.vouchers.routerId))
      .where(w).orderBy(desc(schema.vouchers.id)).limit(q.pageSize).offset((q.page - 1) * q.pageSize).all();
    return { total, rows: rows.map((r) => ({ ...r.v, packageName: r.packageName, color: r.color, routerName: r.routerName })) };
  });

  app.get('/api/vouchers/counts', async () => {
    const rows = sqlite.prepare('SELECT status, COUNT(*) AS n FROM vouchers GROUP BY status').all() as { status: string; n: number }[];
    return Object.fromEntries(rows.map((r) => [r.status, r.n]));
  });

  app.post('/api/vouchers/generate', async (req, reply) => {
    const body = z.object({
      routerId: z.coerce.number().int(),
      packageId: z.coerce.number().int(),
      count: z.coerce.number().int().min(1, 'Minimal 1 voucher').max(2000, 'Maksimal 2000 voucher sekali buat'),
      note: z.string().max(100).optional(),
    }).parse(req.body);
    try {
      return await generateVouchers({ ...body, userId: req.user.id, resellerId: req.user.role === 'reseller' ? req.user.id : undefined });
    } catch (e) {
      if ((e as { statusCode?: number }).statusCode) throw e;
      return reply.code(502).send({ message: friendlyRouterError(e) });
    }
  });

  app.post('/api/vouchers/disable', async (req, reply) => {
    const { ids } = z.object({ ids: z.array(z.number().int()).min(1) }).parse(req.body);
    try {
      return { disabled: await disableVouchers(ids) };
    } catch (e) {
      return reply.code(502).send({ message: friendlyRouterError(e) });
    }
  });

  app.get('/api/batches', async (req) =>
    db.select({
      id: schema.voucherBatches.id, count: schema.voucherBatches.count, note: schema.voucherBatches.note,
      createdAt: schema.voucherBatches.createdAt, packageName: schema.packages.name, color: schema.packages.color,
      price: schema.packages.price, routerName: schema.routers.name, cost: schema.voucherBatches.cost, resellerName: schema.users.name,
      unused: sql<number>`(SELECT COUNT(*) FROM vouchers v WHERE v.batch_id = ${schema.voucherBatches.id} AND v.status = 'new')`,
    }).from(schema.voucherBatches)
      .innerJoin(schema.packages, eq(schema.packages.id, schema.voucherBatches.packageId))
      .innerJoin(schema.routers, eq(schema.routers.id, schema.voucherBatches.routerId))
      .leftJoin(schema.users, eq(schema.users.id, schema.voucherBatches.resellerId))
      // Reseller hanya melihat batch miliknya sendiri.
      .where(req.user.role === 'reseller' ? eq(schema.voucherBatches.resellerId, req.user.id) : undefined)
      .orderBy(desc(schema.voucherBatches.id)).limit(100).all());

  /** Cetak PDF: per batch atau per daftar id. Hanya voucher yang belum dipakai kecuali all=1. */
  app.get('/api/vouchers/print', async (req, reply) => {
    const q = z.object({
      batchId: z.coerce.number().optional(), ids: z.string().optional(), all: z.string().optional(),
    }).parse(req.query);
    const conds: SQL[] = [];
    if (q.batchId) conds.push(eq(schema.vouchers.batchId, q.batchId));
    if (q.ids) conds.push(inArray(schema.vouchers.id, q.ids.split(',').map(Number).filter(Boolean)));
    if (!q.all) conds.push(eq(schema.vouchers.status, 'new'));
    if (!q.batchId && !q.ids) return reply.code(400).send({ message: 'Pilih batch atau voucher yang mau dicetak.' });
    if (req.user.role === 'reseller') {
      // Reseller hanya boleh mencetak batch miliknya.
      const b = q.batchId ? db.select().from(schema.voucherBatches).where(eq(schema.voucherBatches.id, q.batchId)).get() : null;
      if (!b || b.resellerId !== req.user.id || q.ids) return reply.code(403).send({ message: 'Voucher ini bukan milik Anda.' });
    }
    const rows = db.select({
      code: schema.vouchers.code, password: schema.vouchers.password, price: schema.vouchers.price,
      packageName: schema.packages.name, validityMin: schema.packages.validityMin, uptimeLimitMin: schema.packages.uptimeLimitMin,
      quotaMb: schema.packages.quotaMb, color: schema.packages.color, dnsName: schema.routers.dnsName,
    }).from(schema.vouchers)
      .innerJoin(schema.packages, eq(schema.packages.id, schema.vouchers.packageId))
      .innerJoin(schema.routers, eq(schema.routers.id, schema.vouchers.routerId))
      .where(and(...conds)).orderBy(schema.vouchers.id).all();
    const pdf = await renderVouchersPdf(rows);
    return reply.header('Content-Type', 'application/pdf')
      .header('Content-Disposition', `inline; filename="voucher-${q.batchId ?? 'pilihan'}.pdf"`).send(pdf);
  });

  // ---------- Laporan ----------
  app.get('/api/reports/sales', async (req) => salesSummary(salesFilter(req.query as Record<string, string>)));

  app.get('/api/reports/sales/rows', async (req) => {
    const q = req.query as Record<string, string>;
    return salesRows({
      ...salesFilter(q), page: Math.max(1, Number(q.page ?? 1)), pageSize: Math.min(200, Number(q.pageSize ?? 25)), search: q.search,
    });
  });

  app.get('/api/reports/sales.csv', async (req, reply) => {
    const q = req.query as Record<string, string>;
    const f = salesFilter(q);
    const { rows } = salesRows({ ...f, page: 1, pageSize: 1_000_000, search: q.search });
    const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const tz = f.tzOffsetMin * 60_000;
    const lines = [
      ['Waktu', 'Kode / Username', 'Pelanggan', 'Paket', 'Router', 'Jenis', 'Nominal', 'Status', 'MAC'].join(';'),
      ...(rows as Record<string, unknown>[]).map((r) => [
        new Date(Number(r.soldAt) + tz).toISOString().replace('T', ' ').slice(0, 19),
        r.code, r.customerName, r.packageName, r.routerName, ({ pppoe: 'PPPoE', reseller: 'Reseller', hotspot: 'Voucher' } as Record<string, string>)[String(r.channel)] ?? r.channel, r.amount, r.status, r.mac,
      ].map(esc).join(';')),
    ];
    // BOM agar Excel membaca UTF-8 dengan benar; pemisah ";" sesuai Excel lokal Indonesia.
    return reply.header('Content-Type', 'text/csv; charset=utf-8')
      .header('Content-Disposition', 'attachment; filename="laporan-penjualan.csv"')
      .send(`﻿${lines.join('\r\n')}`);
  });

  // ---------- Dashboard ----------
  app.get('/api/dashboard', async (req) => {
    const tz = Number((req.query as { tz?: string }).tz ?? 420) * 60_000;
    const now = Date.now();
    const startToday = Math.floor((now + tz) / 86_400_000) * 86_400_000 - tz;
    const sum = (from: number, to: number) => sqlite.prepare(
      'SELECT COALESCE(SUM(amount),0) AS revenue, COUNT(*) AS count FROM sales WHERE sold_at >= ? AND sold_at < ?',
    ).get(from, to) as { revenue: number; count: number };
    const today = sum(startToday, now + 1);
    const yesterday = sum(startToday - 86_400_000, startToday);
    const startMonth = (() => { const d = new Date(now + tz); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1) - tz; })();
    const month = sum(startMonth, now + 1);
    const last7 = sqlite.prepare(
      `SELECT strftime('%Y-%m-%d', (sold_at + ?) / 1000, 'unixepoch') AS bucket, SUM(amount) AS revenue, COUNT(*) AS count
         FROM sales WHERE sold_at >= ? GROUP BY bucket ORDER BY bucket`,
    ).all(tz, startToday - 6 * 86_400_000);
    const counts = Object.fromEntries((sqlite.prepare('SELECT status, COUNT(*) AS n FROM vouchers GROUP BY status').all() as { status: string; n: number }[]).map((r) => [r.status, r.n]));
    const routerList = db.select({ id: schema.routers.id, name: schema.routers.name, lastStatus: schema.routers.lastStatus, lastError: schema.routers.lastError, isDemo: schema.routers.isDemo, lastSeenAt: schema.routers.lastSeenAt }).from(schema.routers).all();
    const recent = db.select({
      id: schema.sales.id, amount: schema.sales.amount, soldAt: schema.sales.soldAt, code: schema.vouchers.code,
      packageName: schema.packages.name, color: schema.packages.color, channel: schema.sales.channel, customerName: schema.customers.name, resellerName: schema.users.name,
    }).from(schema.sales)
      .leftJoin(schema.vouchers, eq(schema.vouchers.id, schema.sales.voucherId))
      .leftJoin(schema.customers, eq(schema.customers.id, schema.sales.customerId))
      .leftJoin(schema.users, and(eq(schema.users.id, schema.sales.userId), eq(schema.sales.channel, 'reseller')))
      .leftJoin(schema.packages, and(eq(schema.packages.id, schema.sales.packageId), inArray(schema.sales.channel, ['hotspot', 'reseller'])))
      .where(gte(schema.sales.soldAt, startToday - 7 * 86_400_000))
      .orderBy(desc(schema.sales.soldAt)).limit(8).all();
    const packagesCount = db.select({ n: count() }).from(schema.packages).get()?.n ?? 0;
    const ppp = sqlite.prepare(`SELECT
        (SELECT COUNT(*) FROM customers WHERE status = 'active') AS active,
        (SELECT COUNT(*) FROM customers WHERE status = 'isolated') AS isolated,
        (SELECT COALESCE(SUM(amount),0) FROM invoices WHERE status = 'unpaid' AND due_at < ?) AS overdue,
        (SELECT COUNT(DISTINCT customer_id) FROM invoices WHERE status = 'unpaid' AND due_at < ?) AS overdueCustomers`).get(now, now);
    return { today, yesterday, month, last7, counts, routers: routerList, recent, packagesCount, ppp };
  });
}
