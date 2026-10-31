import { and, eq, inArray, lte } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema, sqlite } from '../db.js';
import { decrypt, encrypt } from '../crypto.js';
import { friendlyRouterError, getDriverById } from '../mikrotik/pool.js';
import type { RosCommand } from '../mikrotik/types.js';
import { rateLimit } from './format.js';

export const ISOLIR_PROFILE = 'wifinate-isolir';
export const ISOLIR_LIST = 'wifinate-isolir';
/** Tagihan dibuat sekian hari sebelum jatuh tempo. */
const INVOICE_LEAD_DAYS = 7;
const DAY = 86_400_000;

export const planProfile = (planId: number) => `wifinate-ppp${planId}`;

type Customer = typeof schema.customers.$inferSelect;
type Plan = typeof schema.pppPlans.$inferSelect;

/** Tambah 1 bulan dengan tanggal tetap (31 Jan → 28/29 Feb). */
export function addMonths(ms: number, n = 1): number {
  const d = new Date(ms);
  const day = d.getDate();
  const t = new Date(d.getFullYear(), d.getMonth() + n, 1, d.getHours(), d.getMinutes());
  const last = new Date(t.getFullYear(), t.getMonth() + 1, 0).getDate();
  t.setDate(Math.min(day, last));
  return t.getTime();
}

export const periodOf = (ms: number) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

function getPlan(id: number): Plan {
  const p = db.select().from(schema.pppPlans).where(eq(schema.pppPlans.id, id)).get();
  if (!p) throw Object.assign(new Error('Paket PPPoE tidak ditemukan'), { statusCode: 404 });
  return p;
}

/** Pastikan profil paket ada di router (kecepatan + alamat dari wizard bila ada). */
async function ensurePlanProfile(routerId: number, plan: Plan) {
  const { router, driver } = await getDriverById(routerId);
  await driver.upsertPppProfile({
    name: planProfile(plan.id),
    rateLimit: rateLimit(plan.rateDown, plan.rateUp),
    localAddress: router.pppLocalAddress,
    remoteAddress: router.pppPool,
  });
  return driver;
}

async function ensureIsolirProfile(routerId: number) {
  const { router, driver } = await getDriverById(routerId);
  await driver.upsertPppProfile({
    name: ISOLIR_PROFILE, rateLimit: '128k/128k', addressList: ISOLIR_LIST,
    localAddress: router.pppLocalAddress, remoteAddress: router.pppPool,
  });
  return driver;
}

/** Perbarui profil paket di semua router yang punya pelanggan paket ini (dipanggil saat paket diubah). */
export async function syncPlanToRouters(plan: Plan) {
  const routerIds = [...new Set(db.select({ r: schema.customers.routerId }).from(schema.customers)
    .where(eq(schema.customers.planId, plan.id)).all().map((x) => x.r))];
  const errors: string[] = [];
  for (const rid of routerIds) {
    try { await ensurePlanProfile(rid, plan); } catch (e) { errors.push(friendlyRouterError(e)); }
  }
  return errors;
}

export const customerBody = z.object({
  routerId: z.coerce.number().int(),
  planId: z.coerce.number().int(),
  name: z.string().min(2, 'Nama pelanggan minimal 2 huruf'),
  phone: z.string().max(20).optional().nullable(),
  address: z.string().max(200).optional().nullable(),
  username: z.string().min(3, 'Username minimal 3 huruf').regex(/^[a-zA-Z0-9._@-]+$/, 'Username tanpa spasi'),
  password: z.string().min(4, 'Password minimal 4 karakter'),
  /** Jatuh tempo pertama (ms). */
  nextDueAt: z.coerce.number().int(),
  graceDays: z.coerce.number().int().min(0).max(30).default(3),
  autoIsolate: z.boolean().default(true),
  note: z.string().max(200).optional().nullable(),
});

export async function createCustomer(input: z.infer<typeof customerBody>) {
  const exists = db.select().from(schema.customers)
    .where(and(eq(schema.customers.routerId, input.routerId), eq(schema.customers.username, input.username))).get();
  if (exists) throw Object.assign(new Error('Username PPPoE sudah dipakai pelanggan lain.'), { statusCode: 409 });
  const plan = getPlan(input.planId);
  const driver = await ensurePlanProfile(input.routerId, plan);
  await driver.upsertPppSecret({ name: input.username, password: input.password, profile: planProfile(plan.id), comment: `wifinate:${input.name}` });
  const { password, ...rest } = input;
  return db.insert(schema.customers).values({ ...rest, passwordEnc: encrypt(password), status: 'active', createdAt: Date.now() }).returning().get();
}

export async function updateCustomer(id: number, input: Partial<z.infer<typeof customerBody>>) {
  const c = getCustomer(id);
  const { password, routerId: _ignored, ...rest } = input;
  const planChanged = input.planId && input.planId !== c.planId;
  const userChanged = input.username && input.username !== c.username;
  const { driver } = await getDriverById(c.routerId);
  if (planChanged || userChanged || password) {
    const plan = getPlan(input.planId ?? c.planId);
    await ensurePlanProfile(c.routerId, plan);
    if (userChanged) await driver.removePppSecret(c.username);
    await driver.upsertPppSecret({
      name: input.username ?? c.username,
      password: password ?? decrypt(c.passwordEnc),
      profile: c.status === 'isolated' ? ISOLIR_PROFILE : planProfile(plan.id),
      disabled: c.status === 'disabled',
      comment: `wifinate:${input.name ?? c.name}`,
    });
    if (planChanged || userChanged) await driver.kickPpp(c.username);
  }
  const patch: Partial<typeof schema.customers.$inferInsert> = { ...rest };
  if (password) patch.passwordEnc = encrypt(password);
  return db.update(schema.customers).set(patch).where(eq(schema.customers.id, id)).returning().get();
}

export function getCustomer(id: number): Customer {
  const c = db.select().from(schema.customers).where(eq(schema.customers.id, id)).get();
  if (!c) throw Object.assign(new Error('Pelanggan tidak ditemukan'), { statusCode: 404 });
  return c;
}

export async function deleteCustomer(id: number, removeFromRouter: boolean) {
  const c = getCustomer(id);
  if (removeFromRouter) {
    const { driver } = await getDriverById(c.routerId);
    await driver.kickPpp(c.username);
    await driver.removePppSecret(c.username);
  }
  db.delete(schema.customers).where(eq(schema.customers.id, id)).run();
}

/** Isolir: ganti profil ke "isolir" (internet diblokir) lalu putuskan sesi agar langsung berlaku. */
export async function isolateCustomer(id: number) {
  const c = getCustomer(id);
  const driver = await ensureIsolirProfile(c.routerId);
  await driver.setPppSecret(c.username, { profile: ISOLIR_PROFILE });
  await driver.kickPpp(c.username);
  db.update(schema.customers).set({ status: 'isolated', syncError: null }).where(eq(schema.customers.id, id)).run();
}

/** Buka isolir / aktifkan kembali. */
export async function activateCustomer(id: number) {
  const c = getCustomer(id);
  const plan = getPlan(c.planId);
  const driver = await ensurePlanProfile(c.routerId, plan);
  await driver.setPppSecret(c.username, { profile: planProfile(plan.id), disabled: false });
  await driver.kickPpp(c.username);
  db.update(schema.customers).set({ status: 'active', syncError: null }).where(eq(schema.customers.id, id)).run();
}

/** Berhenti langganan: akun dinonaktifkan di router, data tetap tersimpan. */
export async function disableCustomer(id: number) {
  const c = getCustomer(id);
  const { driver } = await getDriverById(c.routerId);
  await driver.setPppSecret(c.username, { disabled: true });
  await driver.kickPpp(c.username);
  db.update(schema.customers).set({ status: 'disabled', syncError: null }).where(eq(schema.customers.id, id)).run();
}

function ensureInvoice(c: Customer, dueAt: number, amount: number) {
  const period = periodOf(dueAt);
  const existing = db.select().from(schema.invoices)
    .where(and(eq(schema.invoices.customerId, c.id), eq(schema.invoices.period, period))).get();
  if (existing) return existing;
  return db.insert(schema.invoices).values({ customerId: c.id, period, amount, dueAt, status: 'unpaid', createdAt: Date.now() }).returning().get();
}

/**
 * Terima pembayaran. Tanpa invoiceId → membayar tagihan tertua yang belum lunas,
 * atau (jika tidak ada) membayar di muka untuk periode jatuh tempo berikutnya.
 */
export async function payCustomer(customerId: number, opts: { invoiceId?: number; method?: string; userId?: number }) {
  const c = getCustomer(customerId);
  const plan = getPlan(c.planId);
  const now = Date.now();

  const inv = sqlite.transaction(() => {
    let invoice = opts.invoiceId
      ? db.select().from(schema.invoices).where(and(eq(schema.invoices.id, opts.invoiceId), eq(schema.invoices.customerId, c.id))).get()
      : db.select().from(schema.invoices).where(and(eq(schema.invoices.customerId, c.id), eq(schema.invoices.status, 'unpaid')))
        .orderBy(schema.invoices.dueAt).get();
    if (!invoice) invoice = ensureInvoice(c, c.nextDueAt, plan.price);
    if (invoice.status === 'paid') throw Object.assign(new Error('Tagihan ini sudah lunas.'), { statusCode: 409 });

    db.update(schema.invoices).set({ status: 'paid', paidAt: now, method: opts.method ?? 'tunai', receivedBy: opts.userId })
      .where(eq(schema.invoices.id, invoice.id)).run();
    db.insert(schema.sales).values({
      routerId: c.routerId, packageId: plan.id, amount: invoice.amount, userId: opts.userId, channel: 'pppoe',
      customerId: c.id, invoiceId: invoice.id, soldAt: now,
    }).run();
    // Jatuh tempo maju 1 bulan dari periode yang dibayar.
    const next = Math.max(c.nextDueAt, addMonths(invoice.dueAt));
    db.update(schema.customers).set({ nextDueAt: next, lastPaidAt: now }).where(eq(schema.customers.id, c.id)).run();
    return invoice;
  })();

  // Jika sedang diisolir dan tidak ada tunggakan lain yang lewat batas → buka isolir otomatis.
  let reactivated = false;
  let routerError: string | null = null;
  if (c.status === 'isolated' && !hasOverdue(c.id, c.graceDays)) {
    try { await activateCustomer(c.id); reactivated = true; } catch (e) {
      routerError = friendlyRouterError(e);
      db.update(schema.customers).set({ syncError: routerError }).where(eq(schema.customers.id, c.id)).run();
    }
  }
  return { invoice: { ...inv, status: 'paid' as const, paidAt: now, method: opts.method ?? 'tunai' }, reactivated, routerError };
}

export function voidInvoice(id: number) {
  db.update(schema.invoices).set({ status: 'void' }).where(and(eq(schema.invoices.id, id), eq(schema.invoices.status, 'unpaid'))).run();
}

function hasOverdue(customerId: number, graceDays: number) {
  const limit = Date.now() - graceDays * DAY;
  return !!db.select({ id: schema.invoices.id }).from(schema.invoices)
    .where(and(eq(schema.invoices.customerId, customerId), eq(schema.invoices.status, 'unpaid'), lte(schema.invoices.dueAt, limit))).get();
}

/**
 * Siklus penagihan (dijalankan penjadwal):
 *  1. Buat tagihan bulan berikutnya H-7 sebelum jatuh tempo.
 *  2. Isolir otomatis pelanggan yang menunggak melewati masa toleransi.
 */
export async function billingCycle() {
  const now = Date.now();
  const list = db.select({ c: schema.customers, price: schema.pppPlans.price }).from(schema.customers)
    .innerJoin(schema.pppPlans, eq(schema.pppPlans.id, schema.customers.planId))
    .where(inArray(schema.customers.status, ['active', 'isolated'])).all();

  sqlite.transaction(() => {
    for (const { c, price } of list) {
      if (now >= c.nextDueAt - INVOICE_LEAD_DAYS * DAY) ensureInvoice(c, c.nextDueAt, price);
    }
  })();

  for (const { c } of list) {
    if (c.status !== 'active' || !c.autoIsolate || !hasOverdue(c.id, c.graceDays)) continue;
    try {
      await isolateCustomer(c.id);
    } catch (e) {
      db.update(schema.customers).set({ syncError: `Gagal isolir otomatis: ${friendlyRouterError(e)}` }).where(eq(schema.customers.id, c.id)).run();
    }
  }
}

// ---------- Impor akun PPPoE yang sudah ada di router ----------

export async function listImportable(routerId: number) {
  const { driver } = await getDriverById(routerId);
  const secrets = (await driver.pppSecrets()).filter((s) => s.service === 'pppoe' || s.service === 'any');
  const known = new Set(db.select({ u: schema.customers.username }).from(schema.customers)
    .where(eq(schema.customers.routerId, routerId)).all().map((x) => x.u));
  return secrets.filter((s) => !known.has(s.name));
}

export async function importCustomers(routerId: number, items: { username: string; name: string; planId: number; nextDueAt: number; phone?: string }[]) {
  const { driver } = await getDriverById(routerId);
  const secrets = new Map((await driver.pppSecrets()).map((s) => [s.name, s]));
  let imported = 0;
  for (const it of items) {
    const s = secrets.get(it.username);
    if (!s) continue;
    const plan = getPlan(it.planId);
    await ensurePlanProfile(routerId, plan);
    await driver.setPppSecret(s.name, { profile: planProfile(plan.id) });
    db.insert(schema.customers).values({
      routerId, planId: plan.id, name: it.name || s.comment || s.name, phone: it.phone, username: s.name,
      passwordEnc: encrypt(s.password), status: s.disabled ? 'disabled' : 'active', nextDueAt: it.nextDueAt,
      graceDays: 3, autoIsolate: true, createdAt: Date.now(),
    }).onConflictDoNothing().run();
    imported++;
  }
  return imported;
}

// ---------- Wizard server PPPoE ----------

export const pppoeSetupSchema = z.object({
  lanInterface: z.string().min(1),
  wanInterface: z.string().min(1),
  networkPrefix: z.string().regex(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/, 'Contoh format: 172.16.0'),
  serviceName: z.string().min(2).regex(/^[a-z0-9_-]+$/i, 'Tanpa spasi'),
});

export function planPppoe(i: z.infer<typeof pppoeSetupSchema>): RosCommand[] {
  const net = i.networkPrefix;
  const pool = `${i.serviceName}-ppp-pool`;
  const tag = `wifinate:pppoe`;
  return [
    {
      path: '/ip/pool/add', params: { name: pool, ranges: `${net}.2-${net}.254`, comment: tag },
      description: `Menyiapkan 253 alamat IP (${net}.2 – ${net}.254) untuk pelanggan PPPoE.`,
    },
    {
      path: '/ppp/profile/add',
      params: { name: `${i.serviceName}-default`, 'local-address': `${net}.1`, 'remote-address': pool, 'dns-server': '8.8.8.8,1.1.1.1' },
      description: 'Membuat profil dasar: gateway, pembagian IP otomatis, dan DNS untuk pelanggan.',
    },
    {
      path: '/interface/pppoe-server/server/add',
      params: {
        'service-name': i.serviceName, interface: i.lanInterface, 'default-profile': `${i.serviceName}-default`,
        authentication: 'pap,chap,mschap1,mschap2', 'one-session-per-host': 'yes', disabled: 'no',
      },
      description: `Menyalakan server PPPoE di port ${i.lanInterface}. Router pelanggan login pakai username & password.`,
    },
    {
      path: '/ppp/profile/add',
      params: { name: ISOLIR_PROFILE, 'local-address': `${net}.1`, 'remote-address': pool, 'rate-limit': '128k/128k', 'address-list': ISOLIR_LIST },
      description: 'Membuat profil "isolir" untuk pelanggan yang telat bayar (kecepatan sangat kecil).',
    },
    {
      path: '/ip/firewall/filter/add',
      params: { chain: 'forward', 'src-address-list': ISOLIR_LIST, protocol: 'udp', 'dst-port': '53', action: 'accept', comment: `${tag} izinkan DNS isolir` },
      description: 'Pelanggan terisolir tetap bisa DNS (supaya pesan/halaman info bisa tampil).',
    },
    {
      path: '/ip/firewall/filter/add',
      params: { chain: 'forward', 'src-address-list': ISOLIR_LIST, action: 'drop', comment: `${tag} blokir isolir` },
      description: 'Memblokir internet pelanggan yang sedang diisolir.',
    },
    {
      path: '/ip/firewall/nat/add',
      params: { chain: 'srcnat', action: 'masquerade', 'src-address': `${net}.0/24`, 'out-interface': i.wanInterface, comment: tag },
      description: `Menyambungkan pelanggan PPPoE ke internet lewat port ${i.wanInterface}.`,
    },
  ];
}
