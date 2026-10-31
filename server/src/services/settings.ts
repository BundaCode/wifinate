import { db, schema } from '../db.js';

export interface AppSettings {
  businessName: string;
  phone: string;
  address: string;
  voucherFooter: string;
  /** Warna utama voucher & halaman login. */
  brandColor: string;
  /** Format kode voucher. */
  codeCharset: 'numeric' | 'alpha' | 'alnum';
  codeLength: number;
  codePrefix: string;
  /** true = password sama dengan kode (pelanggan cukup ketik satu kode). */
  passwordSameAsCode: boolean;
  /** Jumlah kolom kartu per baris pada lembar A4. */
  printColumns: number;
  /** Alamat Wifinate yang bisa dijangkau router, mis. http://192.168.88.10:8080 */
  serverUrl: string;
  loginTitle: string;
  loginWelcome: string;
  loginShowPrices: boolean;
  isolirMessage: string;
  /** Info pembayaran: rekening, e-wallet, dsb. */
  paymentInfo: string;
  // ---- Notifikasi WhatsApp ----
  waProvider: 'off' | 'fonnte' | 'webhook';
  waToken: string;
  waWebhookUrl: string;
  /** Nomor WA pemilik yang menerima notifikasi. */
  waOwnerNumber: string;
  notifyRouterDown: boolean;
  notifyLowStock: boolean;
  lowStockThreshold: number;
  notifyDailySummary: boolean;
  dailySummaryHour: number;
  notifyIsolir: boolean;
  notifyPayment: boolean;
  /** Kirim pengingat tagihan H-3 & hari H, info isolir, dan bukti bayar ke pelanggan PPPoE. */
  notifyCustomer: boolean;
}

export const DEFAULT_SETTINGS: AppSettings = {
  businessName: 'WiFi Saya',
  phone: '',
  address: '',
  voucherFooter: 'Terima kasih telah berlangganan',
  brandColor: '#4f46e5',
  codeCharset: 'alnum',
  codeLength: 6,
  codePrefix: '',
  passwordSameAsCode: true,
  printColumns: 4,
  serverUrl: '',
  loginTitle: 'Selamat datang',
  loginWelcome: 'Masukkan kode voucher untuk mulai internetan.',
  loginShowPrices: true,
  isolirMessage: 'Layanan internet Anda sementara dihentikan karena ada tagihan yang belum dibayar. Silakan lakukan pembayaran agar internet aktif kembali secara otomatis.',
  paymentInfo: '',
  waProvider: 'off',
  waToken: '',
  waWebhookUrl: '',
  waOwnerNumber: '',
  notifyRouterDown: true,
  notifyLowStock: true,
  lowStockThreshold: 20,
  notifyDailySummary: true,
  dailySummaryHour: 21,
  notifyIsolir: true,
  notifyPayment: true,
  notifyCustomer: false,
};

export function getSettings(): AppSettings {
  const rows = db.select().from(schema.settings).all();
  const out: Record<string, unknown> = { ...DEFAULT_SETTINGS };
  for (const r of rows) {
    try { out[r.key] = JSON.parse(r.value); } catch { /* abaikan nilai rusak */ }
  }
  return out as unknown as AppSettings;
}

export function saveSettings(patch: Partial<AppSettings>) {
  const stmt = db.insert(schema.settings);
  for (const [key, value] of Object.entries(patch)) {
    if (!(key in DEFAULT_SETTINGS) || value === undefined) continue;
    stmt.values({ key, value: JSON.stringify(value) })
      .onConflictDoUpdate({ target: schema.settings.key, set: { value: JSON.stringify(value) } })
      .run();
  }
  return getSettings();
}
