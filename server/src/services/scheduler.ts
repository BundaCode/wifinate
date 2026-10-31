import { and, eq, inArray } from 'drizzle-orm';
import { db, schema, sqlite } from '../db.js';
import { friendlyRouterError, getDriver } from '../mikrotik/pool.js';
import { SCHEDULER_INTERVAL_MS } from '../config.js';
import { billingCycle } from './pppoe.js';
import { notifyCycle } from './notify.js';
import { dailyBackup } from './backup.js';

/**
 * Penjadwal voucher. Setiap interval, untuk setiap router:
 *  1. Voucher "baru" yang sudah dipakai login → jadi "aktif", masa aktif mulai dihitung, penjualan dicatat.
 *  2. Voucher "aktif" yang masa aktif / batas pemakaian / kuota habis → dihapus dari router & diputus.
 *  3. Status router (online/offline) diperbarui.
 */
export async function syncRouter(router: typeof schema.routers.$inferSelect) {
  const driver = getDriver(router);
  const now = Date.now();
  try {
    const [stats, active] = await Promise.all([driver.hotspotUserStats(), driver.activeSessions()]);
    const statByName = new Map(stats.map((s) => [s.name, s]));
    const activeByName = new Map(active.map((a) => [a.user, a]));

    const candidates = db.select({
      v: schema.vouchers,
      validityMin: schema.packages.validityMin,
      uptimeLimitMin: schema.packages.uptimeLimitMin,
      quotaMb: schema.packages.quotaMb,
    })
      .from(schema.vouchers)
      .innerJoin(schema.packages, eq(schema.packages.id, schema.vouchers.packageId))
      .where(and(eq(schema.vouchers.routerId, router.id), inArray(schema.vouchers.status, ['new', 'active'])))
      .all();

    const toEnd: { id: number; code: string; reason: string }[] = [];

    sqlite.transaction(() => {
      for (const { v, validityMin, uptimeLimitMin, quotaMb } of candidates) {
        const stat = statByName.get(v.code);
        const sess = activeByName.get(v.code);
        const used = !!sess || (stat?.uptimeSec ?? 0) > 0;
        const uptimeSec = Math.max(stat?.uptimeSec ?? 0, v.uptimeSec);
        const bytes = Math.max((stat?.bytesIn ?? 0) + (stat?.bytesOut ?? 0), v.bytesTotal);

        if (v.status === 'new') {
          if (!stat && !sess) {
            // Tidak ada di router (mis. dihapus manual): tandai tidak aktif.
            continue;
          }
          if (!used) continue;
          const activatedAt = now;
          const expiresAt = validityMin ? activatedAt + validityMin * 60_000 : null;
          db.update(schema.vouchers).set({
            status: 'active', activatedAt, expiresAt, uptimeSec, bytesTotal: bytes,
            lastMac: sess?.mac ?? v.lastMac, lastIp: sess?.address ?? v.lastIp,
          }).where(eq(schema.vouchers.id, v.id)).run();
          // Voucher reseller sudah dicatat saat dibeli reseller.
          if (!v.resellerId) {
            db.insert(schema.sales).values({
              voucherId: v.id, routerId: router.id, packageId: v.packageId, amount: v.price, channel: 'hotspot', soldAt: activatedAt,
            }).run();
          }
          continue;
        }

        // status aktif
        let reason: string | null = null;
        if (v.expiresAt && now >= v.expiresAt) reason = 'Masa aktif habis';
        else if (uptimeLimitMin && uptimeSec >= uptimeLimitMin * 60) reason = 'Batas pemakaian habis';
        else if (quotaMb && bytes >= quotaMb * 1024 * 1024) reason = 'Kuota habis';
        else if (!stat && !sess) reason = 'Dihapus dari router';

        if (reason) toEnd.push({ id: v.id, code: v.code, reason });
        else {
          db.update(schema.vouchers).set({
            uptimeSec, bytesTotal: bytes,
            lastMac: sess?.mac ?? v.lastMac, lastIp: sess?.address ?? v.lastIp,
          }).where(eq(schema.vouchers.id, v.id)).run();
        }
      }
    })();

    if (toEnd.length) {
      const codes = toEnd.map((t) => t.code);
      await driver.kickActive(codes);
      await driver.removeHotspotUsers(codes);
      sqlite.transaction(() => {
        for (const t of toEnd) {
          db.update(schema.vouchers).set({ status: 'expired', endedAt: now, endReason: t.reason })
            .where(eq(schema.vouchers.id, t.id)).run();
        }
      })();
    }

    db.update(schema.routers).set({ lastStatus: 'online', lastSeenAt: now, lastError: null })
      .where(eq(schema.routers.id, router.id)).run();
  } catch (e) {
    db.update(schema.routers).set({ lastStatus: 'offline', lastError: friendlyRouterError(e) })
      .where(eq(schema.routers.id, router.id)).run();
  }
}

let running = false;
let lastBilling = 0;

export async function syncAll() {
  if (running) return;
  running = true;
  try {
    const list = db.select().from(schema.routers).all();
    await Promise.allSettled(list.map(syncRouter));
    // Penagihan PPPoE cukup dicek tiap menit.
    if (Date.now() - lastBilling >= 60_000) {
      lastBilling = Date.now();
      await billingCycle().catch((e) => console.error('billingCycle', e));
      await notifyCycle().catch((e) => console.error('notifyCycle', e));
      // Backup otomatis sekali sehari (mulai pukul 03.00, atau saat pertama jalan jika terlewat).
      if (new Date().getHours() >= 3) await dailyBackup((m) => console.log(m)).catch((e) => console.error('backup', e));
    }
  } finally {
    running = false;
  }
}

export function startScheduler(log: (msg: string) => void) {
  log(`Penjadwal voucher berjalan setiap ${SCHEDULER_INTERVAL_MS / 1000} detik`);
  setTimeout(syncAll, 2_000);
  return setInterval(syncAll, SCHEDULER_INTERVAL_MS);
}
