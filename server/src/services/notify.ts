import { and, eq, like } from 'drizzle-orm';
import { db, schema, sqlite } from '../db.js';
import { getSettings, type AppSettings } from './settings.js';
import { rupiah } from './format.js';

const DAY = 86_400_000;

/** Nomor HP Indonesia → 62xxxxxxxx. */
export function normalizePhone(phone: string): string {
  const d = phone.replace(/\D/g, '');
  return d.startsWith('0') ? `62${d.slice(1)}` : d;
}

/** Kirim satu pesan WhatsApp lewat gateway yang dipilih. Melempar error jika gagal. */
export async function sendWa(target: string, message: string, s: AppSettings = getSettings()): Promise<void> {
  const to = normalizePhone(target);
  if (!to) throw new Error('Nomor tujuan kosong');
  const ctrl = AbortSignal.timeout(15_000);
  if (s.waProvider === 'fonnte') {
    if (!s.waToken) throw new Error('Token Fonnte belum diisi');
    const res = await fetch('https://api.fonnte.com/send', {
      method: 'POST', signal: ctrl,
      headers: { Authorization: s.waToken },
      body: new URLSearchParams({ target: to, message, countryCode: '62' }),
    });
    const data = (await res.json().catch(() => ({}))) as { status?: boolean; reason?: string; detail?: string };
    if (!res.ok || data.status === false) throw new Error(data.reason ?? data.detail ?? `Fonnte membalas ${res.status}`);
    return;
  }
  if (s.waProvider === 'webhook') {
    if (!s.waWebhookUrl) throw new Error('URL webhook belum diisi');
    const res = await fetch(s.waWebhookUrl, {
      method: 'POST', signal: ctrl,
      headers: { 'Content-Type': 'application/json', ...(s.waToken ? { Authorization: `Bearer ${s.waToken}` } : {}) },
      body: JSON.stringify({ target: to, message }),
    });
    if (!res.ok) throw new Error(`Webhook membalas ${res.status}`);
    return;
  }
  throw new Error('Notifikasi WhatsApp belum diaktifkan');
}

/**
 * Kirim sekali saja per `key` (aman dipanggil berulang oleh penjadwal).
 * Pesan yang gagal akan dicoba lagi pada pemanggilan berikutnya.
 */
export async function notifyOnce(key: string, kind: string, target: string | null | undefined, message: string) {
  const s = getSettings();
  if (s.waProvider === 'off' || !target) return;
  const prev = db.select().from(schema.notifications).where(eq(schema.notifications.key, key)).get();
  if (prev && prev.status !== 'failed') return;
  if (prev) db.update(schema.notifications).set({ status: 'pending', error: null }).where(eq(schema.notifications.id, prev.id)).run();
  else db.insert(schema.notifications).values({ key, kind, target, message, status: 'pending', createdAt: Date.now() }).run();
  try {
    await sendWa(target, message, s);
    db.update(schema.notifications).set({ status: 'sent' }).where(eq(schema.notifications.key, key)).run();
  } catch (e) {
    db.update(schema.notifications).set({ status: 'failed', error: (e as Error).message }).where(eq(schema.notifications.key, key)).run();
  }
}

const fire = (p: Promise<unknown>) => { p.catch((e) => console.error('notify', e)); };
const today = () => new Date().toISOString().slice(0, 10);
const periodId = (p: string) => { const [y, m] = p.split('-').map(Number); return new Date(y, m - 1, 1).toLocaleDateString('id-ID', { month: 'long', year: 'numeric' }); };
const dateId = (ms: number) => new Date(ms).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });

// ---------- Event dari bagian lain aplikasi ----------

export function onCustomerIsolated(c: { id: number; name: string; phone: string | null }, amount: number) {
  const s = getSettings();
  const key = `isolir:${c.id}:${today()}`;
  if (s.notifyIsolir) fire(notifyOnce(`${key}:owner`, 'isolir', s.waOwnerNumber, `🔒 *Isolir otomatis*\n${c.name} diisolir karena tunggakan ${rupiah(amount)}.`));
  if (s.notifyCustomer && c.phone) {
    fire(notifyOnce(`${key}:customer`, 'isolir-customer', c.phone,
      `Halo ${c.name}, layanan internet ${s.businessName} Anda sementara diisolir karena tagihan ${rupiah(amount)} belum dibayar.${s.paymentInfo ? `\n\nPembayaran:\n${s.paymentInfo}` : ''}\n\nInternet aktif otomatis setelah pembayaran diterima. Terima kasih 🙏`));
  }
}

export function onPaymentReceived(c: { id: number; name: string; phone: string | null }, inv: { id: number; amount: number; period: string }, nextDueAt: number, reactivated: boolean) {
  const s = getSettings();
  if (s.notifyPayment) {
    fire(notifyOnce(`pay:${inv.id}:owner`, 'payment', s.waOwnerNumber, `💰 *Pembayaran diterima*\n${c.name} — ${rupiah(inv.amount)} (periode ${periodId(inv.period)})${reactivated ? '\nInternet sudah aktif kembali.' : ''}`));
  }
  if (s.notifyCustomer && c.phone) {
    fire(notifyOnce(`pay:${inv.id}:customer`, 'payment-customer', c.phone,
      `Terima kasih ${c.name} 🙏\nPembayaran internet ${s.businessName} sebesar ${rupiah(inv.amount)} sudah kami terima.${reactivated ? ' Internet Anda sudah aktif kembali.' : ''}\nJatuh tempo berikutnya: ${dateId(nextDueAt)}.`));
  }
}

// ---------- Pemeriksaan berkala (dipanggil penjadwal tiap menit) ----------

export async function notifyCycle() {
  const s = getSettings();
  if (s.waProvider === 'off') return;
  const now = Date.now();
  const jobs: Promise<unknown>[] = [];

  // 1. Router mati > 2 menit / hidup kembali.
  if (s.notifyRouterDown) {
    for (const r of db.select().from(schema.routers).all()) {
      if (r.isDemo) continue;
      if (r.lastStatus === 'offline' && r.lastSeenAt && now - r.lastSeenAt > 2 * 60_000) {
        jobs.push(notifyOnce(`router-down:${r.id}:${r.lastSeenAt}`, 'router-down', s.waOwnerNumber,
          `⚠️ *Router offline*\n${r.name} tidak bisa dihubungi sejak ${new Date(r.lastSeenAt).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}.\n${r.lastError ?? ''}`));
      } else if (r.lastStatus === 'online') {
        const down = db.select().from(schema.notifications)
          .where(and(like(schema.notifications.key, `router-down:${r.id}:%`), eq(schema.notifications.status, 'sent')))
          .orderBy(schema.notifications.id).all().pop();
        if (down) {
          const since = Number(down.key.split(':')[2]);
          jobs.push(notifyOnce(`router-up:${r.id}:${since}`, 'router-up', s.waOwnerNumber,
            `✅ *Router kembali online*\n${r.name} sudah terhubung lagi (mati sekitar ${Math.max(1, Math.round((now - since) / 60_000))} menit).`));
        }
      }
    }
  }

  // 2. Stok voucher menipis (sekali per hari per paket).
  if (s.notifyLowStock) {
    const rows = sqlite.prepare(`
      SELECT p.id, p.name, (SELECT COUNT(*) FROM vouchers v WHERE v.package_id = p.id AND v.status = 'new' AND v.reseller_id IS NULL) AS stock
        FROM packages p WHERE p.active = 1 AND EXISTS (SELECT 1 FROM vouchers v WHERE v.package_id = p.id)`).all() as { id: number; name: string; stock: number }[];
    for (const p of rows.filter((x) => x.stock < s.lowStockThreshold)) {
      jobs.push(notifyOnce(`stock:${p.id}:${today()}`, 'low-stock', s.waOwnerNumber,
        `📦 *Stok voucher menipis*\nPaket ${p.name} tinggal ${p.stock} voucher. Segera buat & cetak voucher baru.`));
    }
  }

  // 3. Ringkasan harian pada jam yang dipilih.
  if (s.notifyDailySummary && new Date().getHours() >= s.dailySummaryHour) {
    const start = new Date(); start.setHours(0, 0, 0, 0);
    const sum = sqlite.prepare(`SELECT channel, COALESCE(SUM(amount),0) AS revenue, COUNT(*) AS n FROM sales WHERE sold_at >= ? GROUP BY channel`).all(start.getTime()) as { channel: string; revenue: number; n: number }[];
    const by = (c: string) => sum.find((x) => x.channel === c) ?? { revenue: 0, n: 0 };
    const total = sum.reduce((a, b) => a + b.revenue, 0);
    const overdue = sqlite.prepare(`SELECT COALESCE(SUM(amount),0) AS t, COUNT(DISTINCT customer_id) AS n FROM invoices WHERE status='unpaid' AND due_at < ?`).get(now) as { t: number; n: number };
    const offline = db.select().from(schema.routers).where(eq(schema.routers.lastStatus, 'offline')).all();
    const lines = [
      `📊 *Ringkasan ${s.businessName}* — ${dateId(now)}`,
      `Total pendapatan: *${rupiah(total)}*`,
      `• Voucher: ${by('hotspot').n} terjual (${rupiah(by('hotspot').revenue)})`,
      by('reseller').n ? `• Reseller: ${by('reseller').n} pembelian (${rupiah(by('reseller').revenue)})` : '',
      by('pppoe').n ? `• PPPoE: ${by('pppoe').n} pembayaran (${rupiah(by('pppoe').revenue)})` : '',
      overdue.n ? `Tunggakan PPPoE: ${rupiah(overdue.t)} dari ${overdue.n} pelanggan` : '',
      offline.length ? `⚠️ Router offline: ${offline.map((r) => r.name).join(', ')}` : 'Semua router online ✅',
    ].filter(Boolean);
    jobs.push(notifyOnce(`daily:${today()}`, 'daily', s.waOwnerNumber, lines.join('\n')));
  }

  // 4. Pengingat tagihan ke pelanggan: H-3 dan hari jatuh tempo.
  if (s.notifyCustomer) {
    const due = sqlite.prepare(`
      SELECT i.id, i.amount, i.due_at AS dueAt, i.period, c.name, c.phone FROM invoices i JOIN customers c ON c.id = i.customer_id
       WHERE i.status = 'unpaid' AND c.status != 'disabled' AND c.phone IS NOT NULL AND c.phone != '' AND i.due_at BETWEEN ? AND ?`)
      .all(now - DAY, now + 3 * DAY) as { id: number; amount: number; dueAt: number; period: string; name: string; phone: string }[];
    for (const i of due) {
      const days = Math.ceil((i.dueAt - now) / DAY);
      const stage = days >= 2 ? 'h3' : 'h0';
      const msg = stage === 'h3'
        ? `Halo ${i.name}, mengingatkan tagihan internet ${s.businessName} periode ${periodId(i.period)} sebesar ${rupiah(i.amount)} akan jatuh tempo pada ${dateId(i.dueAt)}.`
        : `Halo ${i.name}, tagihan internet ${s.businessName} sebesar ${rupiah(i.amount)} jatuh tempo hari ini (${dateId(i.dueAt)}). Mohon segera dibayar agar internet tidak terputus.`;
      jobs.push(notifyOnce(`remind-${stage}:${i.id}`, 'reminder', i.phone, `${msg}${s.paymentInfo ? `\n\nPembayaran:\n${s.paymentInfo}` : ''}\n\nTerima kasih 🙏`));
    }
  }

  await Promise.allSettled(jobs);
}
