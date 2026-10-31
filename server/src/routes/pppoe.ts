import type { FastifyInstance } from 'fastify';
import { count, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema, sqlite } from '../db.js';
import { decrypt } from '../crypto.js';
import { friendlyRouterError, getDriverById } from '../mikrotik/pool.js';
import {
  activateCustomer, createCustomer, customerBody, deleteCustomer, disableCustomer, getCustomer, importCustomers,
  isolateCustomer, listImportable, payCustomer, planPppoe, pppoeSetupSchema, syncPlanToRouters, updateCustomer, voidInvoice,
} from '../services/pppoe.js';
import { consumeWsTicket, requireAdmin, requireAuth } from './auth.js';

const planBody = z.object({
  name: z.string().min(1, 'Nama paket wajib diisi'),
  price: z.coerce.number().int().min(0),
  rateDown: z.string().regex(/^\d+[kKmM]?$/, 'Contoh: 10M').nullable().default(null),
  rateUp: z.string().regex(/^\d+[kKmM]?$/, 'Contoh: 5M').nullable().default(null),
  color: z.string().regex(/^#[0-9a-f]{6}$/i).default('#0ea5e9'),
  active: z.boolean().default(true),
});

const id = (req: { params: unknown }) => Number((req.params as { id: string }).id);

/** Bungkus aksi ke router agar error-nya ramah. */
async function routerAction<T>(reply: { code: (n: number) => { send: (b: unknown) => unknown } }, fn: () => Promise<T>) {
  try {
    return await fn();
  } catch (e) {
    if ((e as { statusCode?: number }).statusCode) throw e;
    return reply.code(502).send({ message: friendlyRouterError(e) });
  }
}

const DAY = 86_400_000;

export default async function pppoeRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAuth);

  // ---------- Paket PPPoE ----------
  app.get('/api/ppp-plans', async () => {
    const counts = new Map((sqlite.prepare(`SELECT plan_id AS id, COUNT(*) AS n FROM customers WHERE status != 'disabled' GROUP BY plan_id`).all() as { id: number; n: number }[]).map((r) => [r.id, r.n]));
    return db.select().from(schema.pppPlans).orderBy(schema.pppPlans.price).all().map((p) => ({ ...p, customers: counts.get(p.id) ?? 0 }));
  });
  app.post('/api/ppp-plans', { preHandler: requireAdmin }, async (req) =>
    db.insert(schema.pppPlans).values({ ...planBody.parse(req.body), createdAt: Date.now() }).returning().get());
  app.put('/api/ppp-plans/:id', { preHandler: requireAdmin }, async (req) => {
    const plan = db.update(schema.pppPlans).set(planBody.partial().parse(req.body)).where(eq(schema.pppPlans.id, id(req))).returning().get();
    const errors = await syncPlanToRouters(plan);
    return { ...plan, warning: errors.length ? `Tersimpan, tapi gagal memperbarui router: ${errors[0]}` : undefined };
  });
  app.delete('/api/ppp-plans/:id', { preHandler: requireAdmin }, async (req, reply) => {
    const used = db.select({ n: count() }).from(schema.customers).where(eq(schema.customers.planId, id(req))).get()?.n ?? 0;
    if (used) {
      db.update(schema.pppPlans).set({ active: false }).where(eq(schema.pppPlans.id, id(req))).run();
      return reply.send({ ok: true, message: 'Paket masih dipakai pelanggan, jadi diarsipkan.' });
    }
    db.delete(schema.pppPlans).where(eq(schema.pppPlans.id, id(req))).run();
    return { ok: true };
  });

  // ---------- Pelanggan ----------
  app.get('/api/customers', async (req) => {
    const q = z.object({
      status: z.enum(['active', 'isolated', 'disabled']).optional(),
      billing: z.enum(['overdue', 'unpaid', 'paid']).optional(),
      routerId: z.coerce.number().optional(),
      planId: z.coerce.number().optional(),
      search: z.string().optional(),
    }).parse(req.query);
    const where: string[] = ['1=1'];
    if (q.status) where.push('c.status = @status');
    if (q.routerId) where.push('c.router_id = @routerId');
    if (q.planId) where.push('c.plan_id = @planId');
    if (q.search) where.push('(c.name LIKE @search OR c.username LIKE @search OR c.phone LIKE @search OR c.address LIKE @search)');
    const rows = sqlite.prepare(`
      SELECT c.id, c.router_id AS routerId, c.plan_id AS planId, c.name, c.phone, c.address, c.username, c.status,
             c.next_due_at AS nextDueAt, c.grace_days AS graceDays, c.auto_isolate AS autoIsolate, c.note,
             c.last_paid_at AS lastPaidAt, c.sync_error AS syncError, c.created_at AS createdAt,
             p.name AS planName, p.price AS planPrice, p.color AS planColor, r.name AS routerName,
             COALESCE(SUM(CASE WHEN i.status = 'unpaid' THEN i.amount END), 0) AS unpaidTotal,
             COUNT(CASE WHEN i.status = 'unpaid' THEN 1 END) AS unpaidCount,
             MIN(CASE WHEN i.status = 'unpaid' THEN i.due_at END) AS oldestUnpaidDue
        FROM customers c
        JOIN ppp_plans p ON p.id = c.plan_id
        JOIN routers r ON r.id = c.router_id
        LEFT JOIN invoices i ON i.customer_id = c.id
       WHERE ${where.join(' AND ')}
       GROUP BY c.id
       ORDER BY c.name COLLATE NOCASE`).all({
      status: q.status ?? null, routerId: q.routerId ?? null, planId: q.planId ?? null, search: q.search ? `%${q.search}%` : null,
    }) as { oldestUnpaidDue: number | null; unpaidCount: number; autoIsolate: number }[];
    const now = Date.now();
    const out = rows.map((r) => ({
      ...r,
      autoIsolate: !!r.autoIsolate,
      billing: !r.unpaidCount ? 'paid' : r.oldestUnpaidDue && r.oldestUnpaidDue < now ? 'overdue' : 'unpaid',
    }));
    return q.billing ? out.filter((r) => r.billing === q.billing) : out;
  });

  app.get('/api/customers/summary', async () => {
    const now = Date.now();
    const d = new Date(now);
    const startMonth = new Date(d.getFullYear(), d.getMonth(), 1).getTime();
    const status = Object.fromEntries((sqlite.prepare('SELECT status, COUNT(*) AS n FROM customers GROUP BY status').all() as { status: string; n: number }[]).map((r) => [r.status, r.n]));
    const unpaid = sqlite.prepare(`SELECT COALESCE(SUM(amount),0) AS total, COUNT(*) AS n FROM invoices WHERE status='unpaid'`).get() as { total: number; n: number };
    const overdue = sqlite.prepare(`SELECT COALESCE(SUM(amount),0) AS total, COUNT(DISTINCT customer_id) AS n FROM invoices WHERE status='unpaid' AND due_at < ?`).get(now) as { total: number; n: number };
    const dueSoon = sqlite.prepare(`SELECT COUNT(*) AS n FROM customers WHERE status != 'disabled' AND next_due_at BETWEEN ? AND ?`).get(now, now + 7 * DAY) as { n: number };
    const collected = sqlite.prepare(`SELECT COALESCE(SUM(amount),0) AS total, COUNT(*) AS n FROM sales WHERE channel='pppoe' AND sold_at >= ?`).get(startMonth) as { total: number; n: number };
    const mrr = sqlite.prepare(`SELECT COALESCE(SUM(p.price),0) AS total FROM customers c JOIN ppp_plans p ON p.id=c.plan_id WHERE c.status != 'disabled'`).get() as { total: number };
    return { status, unpaid, overdue, dueSoon: dueSoon.n, collected, mrr: mrr.total };
  });

  app.get('/api/customers/:id', async (req) => {
    const c = getCustomer(id(req));
    const { passwordEnc, ...rest } = c;
    const invoices = db.select().from(schema.invoices).where(eq(schema.invoices.customerId, c.id)).orderBy(schema.invoices.dueAt).all().reverse();
    const plan = db.select().from(schema.pppPlans).where(eq(schema.pppPlans.id, c.planId)).get();
    return { ...rest, password: req.user.role === 'admin' ? decrypt(passwordEnc) : undefined, plan, invoices };
  });

  app.post('/api/customers', { preHandler: requireAdmin }, async (req, reply) => {
    const body = customerBody.parse(req.body);
    return routerAction(reply, async () => { const { passwordEnc: _p, ...c } = await createCustomer(body); return c; });
  });

  app.put('/api/customers/:id', { preHandler: requireAdmin }, async (req, reply) => {
    const body = customerBody.partial().parse(req.body);
    return routerAction(reply, async () => { const { passwordEnc: _p, ...c } = await updateCustomer(id(req), body); return c; });
  });

  app.delete('/api/customers/:id', { preHandler: requireAdmin }, async (req, reply) => {
    const removeFromRouter = (req.query as { router?: string }).router === '1';
    return routerAction(reply, async () => { await deleteCustomer(id(req), removeFromRouter); return { ok: true }; });
  });

  app.post('/api/customers/:id/isolate', { preHandler: requireAdmin }, async (req, reply) =>
    routerAction(reply, async () => { await isolateCustomer(id(req)); return { ok: true }; }));
  app.post('/api/customers/:id/activate', { preHandler: requireAdmin }, async (req, reply) =>
    routerAction(reply, async () => { await activateCustomer(id(req)); return { ok: true }; }));
  app.post('/api/customers/:id/disable', { preHandler: requireAdmin }, async (req, reply) =>
    routerAction(reply, async () => { await disableCustomer(id(req)); return { ok: true }; }));

  // Kasir juga boleh menerima pembayaran.
  app.post('/api/customers/:id/pay', async (req) => {
    const body = z.object({ invoiceId: z.number().int().optional(), method: z.enum(['tunai', 'transfer', 'qris', 'lainnya']).default('tunai') }).parse(req.body ?? {});
    return payCustomer(id(req), { ...body, userId: req.user.id });
  });

  // ---------- Tagihan ----------
  app.get('/api/invoices', async (req) => {
    const q = z.object({ status: z.enum(['unpaid', 'paid', 'void']).default('unpaid') }).parse(req.query);
    return sqlite.prepare(`
      SELECT i.*, i.customer_id AS customerId, i.due_at AS dueAt, i.paid_at AS paidAt, i.created_at AS createdAt,
             c.name AS customerName, c.phone, c.status AS customerStatus, c.username, p.name AS planName, p.color AS planColor
        FROM invoices i JOIN customers c ON c.id = i.customer_id JOIN ppp_plans p ON p.id = c.plan_id
       WHERE i.status = ? ORDER BY ${q.status === 'paid' ? 'i.paid_at DESC' : 'i.due_at ASC'} LIMIT 500`).all(q.status);
  });

  app.post('/api/invoices/:id/void', { preHandler: requireAdmin }, async (req) => { voidInvoice(id(req)); return { ok: true }; });

  // ---------- Router: impor & wizard PPPoE ----------
  app.get('/api/routers/:id/ppp/importable', { preHandler: requireAdmin }, async (req, reply) =>
    routerAction(reply, () => listImportable(id(req))));

  app.post('/api/routers/:id/ppp/import', { preHandler: requireAdmin }, async (req, reply) => {
    const body = z.object({
      items: z.array(z.object({
        username: z.string(), name: z.string(), planId: z.number().int(), nextDueAt: z.number().int(), phone: z.string().optional(),
      })).min(1, 'Pilih minimal satu pelanggan'),
    }).parse(req.body);
    return routerAction(reply, async () => ({ imported: await importCustomers(id(req), body.items) }));
  });

  app.post('/api/routers/:id/pppoe/preview', { preHandler: requireAdmin }, async (req) => ({ steps: planPppoe(pppoeSetupSchema.parse(req.body)) }));

  app.post('/api/routers/:id/pppoe/apply', { preHandler: requireAdmin }, async (req, reply) => {
    const routerId = id(req);
    const input = pppoeSetupSchema.parse(req.body);
    const { driver } = await getDriverById(routerId);
    const steps = planPppoe(input);
    const backupName = `wifinate-sebelum-pppoe-${new Date().toISOString().slice(0, 10)}`;
    try { await driver.backup(backupName); } catch (e) {
      return reply.code(502).send({ message: `Gagal membuat backup, setting dibatalkan. ${friendlyRouterError(e)}` });
    }
    let done = 0;
    try {
      for (const s of steps) { await driver.apply([s]); done++; }
    } catch (e) {
      return reply.code(502).send({ message: `Berhenti di langkah ${done + 1}: ${steps[done].description} — ${friendlyRouterError(e)}. Backup: "${backupName}".`, done });
    }
    db.update(schema.routers).set({ pppLocalAddress: `${input.networkPrefix}.1`, pppPool: `${input.serviceName}-ppp-pool` })
      .where(eq(schema.routers.id, routerId)).run();
    return { ok: true, backupName };
  });
}

/** Didaftarkan terpisah: WebSocket tidak bisa mengirim header Authorization, jadi token dicek manual. */
export async function trafficWs(app: FastifyInstance) {
  // ---------- Trafik live (WebSocket) ----------
  app.get('/api/ws/traffic', { websocket: true }, (socket, req) => {
    // Tiket sekali pakai (didapat dari POST /api/auth/ws-ticket). Token login tidak pernah ada di URL.
    const q = req.query as { ticket?: string; routerId?: string; iface?: string };
    let stopped = false;
    const user = consumeWsTicket(q.ticket);
    if (!user || user.role === 'reseller') {
      socket.send(JSON.stringify({ error: 'Sesi berakhir, silakan muat ulang halaman.' }));
      socket.close();
      return;
    }
    const routerId = Number(q.routerId);
    const iface = q.iface ?? 'ether1';
    const loop = async () => {
      while (!stopped) {
        try {
          const { driver } = await getDriverById(routerId);
          const s = await driver.monitorTraffic(iface);
          socket.send(JSON.stringify({ t: Date.now(), ...s }));
        } catch (e) {
          socket.send(JSON.stringify({ error: friendlyRouterError(e) }));
        }
        await new Promise((r) => setTimeout(r, 1000));
      }
    };
    socket.on('close', () => { stopped = true; });
    loop();
  });
}
