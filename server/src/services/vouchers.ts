import crypto from 'node:crypto';
import { and, eq, inArray } from 'drizzle-orm';
import { db, schema, sqlite } from '../db.js';
import { getDriverById } from '../mikrotik/pool.js';
import { getSettings, type AppSettings } from './settings.js';
import { profileName, rateLimit, rosMinutes } from './format.js';

// Tanpa huruf/angka yang mirip (0/O, 1/I/L) supaya pelanggan tidak salah ketik.
const CHARSETS: Record<AppSettings['codeCharset'], string> = {
  numeric: '23456789',
  alpha: 'ABCDEFGHJKMNPQRSTUVWXYZ',
  alnum: 'ABCDEFGHJKMNPQRSTUVWXYZ23456789',
};

function randomCode(charset: string, length: number): string {
  const bytes = crypto.randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i++) out += charset[bytes[i] % charset.length];
  return out;
}

/** Harga untuk reseller setelah diskon (dibulatkan ke rupiah terdekat). */
export const resellerCost = (price: number, count: number, discountPct: number) => Math.round((price * count * (100 - discountPct)) / 100);

export async function generateVouchers(opts: {
  routerId: number; packageId: number; count: number; note?: string; userId?: number; resellerId?: number;
}) {
  const settings = getSettings();
  const pkg = db.select().from(schema.packages).where(eq(schema.packages.id, opts.packageId)).get();
  if (!pkg) throw Object.assign(new Error('Paket tidak ditemukan'), { statusCode: 404 });
  if (!pkg.active) throw Object.assign(new Error('Paket ini sudah diarsipkan.'), { statusCode: 400 });
  const { driver } = await getDriverById(opts.routerId);

  // Reseller: potong saldo lebih dulu secara atomik (tidak bisa minus walau diklik bersamaan).
  let cost = 0;
  if (opts.resellerId) {
    const r = db.select().from(schema.users).where(eq(schema.users.id, opts.resellerId)).get();
    if (!r) throw Object.assign(new Error('Reseller tidak ditemukan'), { statusCode: 404 });
    cost = resellerCost(pkg.price, opts.count, r.discountPct);
    const res = sqlite.prepare('UPDATE users SET balance = balance - ? WHERE id = ? AND balance >= ?').run(cost, r.id, cost);
    if (!res.changes) {
      throw Object.assign(new Error(`Saldo tidak cukup. Dibutuhkan ${cost.toLocaleString('id-ID')}, saldo Anda ${r.balance.toLocaleString('id-ID')}. Silakan isi saldo ke pemilik.`), { statusCode: 402 });
    }
  }
  const refund = () => {
    if (opts.resellerId && cost) sqlite.prepare('UPDATE users SET balance = balance + ? WHERE id = ?').run(cost, opts.resellerId);
  };
  try {

    // Kode unik per router: hindari bentrok dengan kode yang sudah ada.
    const existing = new Set(
      db.select({ code: schema.vouchers.code }).from(schema.vouchers)
        .where(eq(schema.vouchers.routerId, opts.routerId)).all().map((r) => r.code),
    );
    const charset = CHARSETS[settings.codeCharset] ?? CHARSETS.alnum;
    const length = Math.min(Math.max(settings.codeLength, 4), 16);
    const codes: { code: string; password: string }[] = [];
    let guard = 0;
    while (codes.length < opts.count) {
      if (++guard > opts.count * 50) throw new Error('Kombinasi kode habis. Perpanjang panjang kode di Pengaturan.');
      const code = settings.codePrefix + randomCode(charset, length);
      if (existing.has(code)) continue;
      existing.add(code);
      codes.push({ code, password: settings.passwordSameAsCode ? code : randomCode(CHARSETS.numeric, Math.min(length, 6)) });
    }

    // 1. Pastikan profil paket ada di router (kecepatan & jumlah perangkat).
    await driver.upsertUserProfile({
      name: profileName(pkg),
      rateLimit: rateLimit(pkg.rateDown, pkg.rateUp),
      sharedUsers: pkg.sharedUsers,
    });

    // 2. Kirim user ke router. Batas pemakaian ditegakkan langsung oleh router,
    //    masa aktif ditegakkan oleh penjadwal Wifinate.
    const now = Date.now();
    await driver.addHotspotUsers(codes.map((c) => ({
      name: c.code,
      password: c.password,
      profile: profileName(pkg),
      limitUptime: pkg.uptimeLimitMin ? rosMinutes(pkg.uptimeLimitMin) : undefined,
      limitBytesTotal: pkg.quotaMb ? pkg.quotaMb * 1024 * 1024 : undefined,
      comment: `wifinate:${pkg.name}`,
    })));

    // 3. Simpan ke database dalam satu transaksi (cepat walau ribuan voucher).
    const batch = sqlite.transaction(() => {
      const b = db.insert(schema.voucherBatches).values({
        routerId: opts.routerId, packageId: pkg.id, count: codes.length, note: opts.note, createdBy: opts.userId,
        resellerId: opts.resellerId ?? null, cost: opts.resellerId ? cost : null, createdAt: now,
      }).returning().get();
      const insert = sqlite.prepare(
        `INSERT INTO vouchers (batch_id, router_id, package_id, code, password, price, status, created_at, reseller_id)
         VALUES (?, ?, ?, ?, ?, ?, 'new', ?, ?)`,
      );
      for (const c of codes) insert.run(b.id, opts.routerId, pkg.id, c.code, c.password, pkg.price, now, opts.resellerId ?? null);
      if (opts.resellerId) {
        // Pendapatan dari reseller dicatat saat membeli (bukan saat voucher dipakai).
        const bal = (sqlite.prepare('SELECT balance FROM users WHERE id = ?').get(opts.resellerId) as { balance: number }).balance;
        db.insert(schema.resellerLedger).values({
          userId: opts.resellerId, type: 'purchase', amount: -cost, balanceAfter: bal, batchId: b.id,
          note: `${codes.length} voucher ${pkg.name}`, createdBy: opts.userId, createdAt: now,
        }).run();
        db.insert(schema.sales).values({
          routerId: opts.routerId, packageId: pkg.id, amount: cost, userId: opts.resellerId, channel: 'reseller', soldAt: now,
        }).run();
      }
      return b;
    })();

    return batch;
  } catch (e) {
    refund();
    throw e;
  }
}

/** Nonaktifkan voucher: hapus dari router & putuskan koneksinya. */
export async function disableVouchers(ids: number[]) {
  const rows = db.select().from(schema.vouchers)
    .where(and(inArray(schema.vouchers.id, ids), inArray(schema.vouchers.status, ['new', 'active']))).all();
  const byRouter = new Map<number, string[]>();
  for (const v of rows) byRouter.set(v.routerId, [...(byRouter.get(v.routerId) ?? []), v.code]);
  for (const [routerId, codes] of byRouter) {
    const { driver } = await getDriverById(routerId);
    await driver.kickActive(codes);
    await driver.removeHotspotUsers(codes);
  }
  if (rows.length) {
    db.update(schema.vouchers)
      .set({ status: 'disabled', endedAt: Date.now(), endReason: 'Dinonaktifkan admin' })
      .where(inArray(schema.vouchers.id, rows.map((r) => r.id))).run();
  }
  return rows.length;
}
