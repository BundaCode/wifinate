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

export async function generateVouchers(opts: {
  routerId: number; packageId: number; count: number; note?: string; userId?: number;
}) {
  const settings = getSettings();
  const pkg = db.select().from(schema.packages).where(eq(schema.packages.id, opts.packageId)).get();
  if (!pkg) throw Object.assign(new Error('Paket tidak ditemukan'), { statusCode: 404 });
  const { driver } = await getDriverById(opts.routerId);

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
      routerId: opts.routerId, packageId: pkg.id, count: codes.length, note: opts.note, createdBy: opts.userId, createdAt: now,
    }).returning().get();
    const insert = sqlite.prepare(
      `INSERT INTO vouchers (batch_id, router_id, package_id, code, password, price, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'new', ?)`,
    );
    for (const c of codes) insert.run(b.id, opts.routerId, pkg.id, c.code, c.password, pkg.price, now);
    return b;
  })();

  return batch;
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
