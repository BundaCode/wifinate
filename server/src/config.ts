import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const DATA_DIR = path.resolve(process.env.DATA_DIR ?? path.join(process.cwd(), 'data'));
fs.mkdirSync(DATA_DIR, { recursive: true });

export const DB_PATH = path.resolve(process.env.DB_FILE ?? path.join(DATA_DIR, 'wifinate.db'));
export const BACKUP_DIR = path.join(DATA_DIR, 'backups');
fs.mkdirSync(BACKUP_DIR, { recursive: true });

/**
 * Pemulihan backup: file disiapkan oleh endpoint restore, lalu diterapkan di sini saat aplikasi
 * dinyalakan ulang — sebelum database & kunci rahasia dibuka, supaya tidak ada file yang sedang dipakai.
 */
(function applyPendingRestore() {
  const pendingDb = path.join(DATA_DIR, 'restore.db');
  const pendingKey = path.join(DATA_DIR, 'restore.key');
  if (!fs.existsSync(pendingDb)) return;
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  for (const ext of ['', '-wal', '-shm']) {
    const f = DB_PATH + ext;
    if (fs.existsSync(f)) fs.renameSync(f, path.join(BACKUP_DIR, `sebelum-pulihkan-${stamp}.db${ext}`));
  }
  fs.renameSync(pendingDb, DB_PATH);
  if (fs.existsSync(pendingKey)) {
    const keyFile = path.join(DATA_DIR, 'secret.key');
    if (fs.existsSync(keyFile)) fs.renameSync(keyFile, path.join(BACKUP_DIR, `sebelum-pulihkan-${stamp}.key`));
    fs.renameSync(pendingKey, keyFile);
  }
  console.log('Backup berhasil dipulihkan.');
})();

export const PORT = Number(process.env.PORT ?? 8080);
export const HOST = process.env.HOST ?? '0.0.0.0';
export const IS_PROD = process.env.NODE_ENV === 'production';

/**
 * Percayai header X-Forwarded-For hanya jika Wifinate berada di belakang reverse proxy (Caddy/Nginx).
 * Default: tidak — supaya IP tidak bisa dipalsukan untuk menghindari batas percobaan login.
 * Isi TRUST_PROXY=1 (atau alamat IP proxy, mis. 127.0.0.1) jika memakai reverse proxy.
 */
export const TRUST_PROXY: boolean | string = (() => {
  const v = process.env.TRUST_PROXY;
  if (!v || v === '0' || v === 'false') return false;
  if (v === '1' || v === 'true') return true;
  return v;
})();

/** Interval pengecekan voucher (aktivasi & kedaluwarsa), dalam milidetik. */
export const SCHEDULER_INTERVAL_MS = Number(process.env.SCHEDULER_INTERVAL_MS ?? 30_000);

/**
 * Kunci rahasia aplikasi. Dibuat otomatis sekali dan disimpan di folder data,
 * dipakai untuk token login (JWT) dan mengenkripsi password router.
 */
function loadSecret(): Buffer {
  if (process.env.APP_SECRET) return crypto.createHash('sha256').update(process.env.APP_SECRET).digest();
  const file = path.join(DATA_DIR, 'secret.key');
  if (!fs.existsSync(file)) fs.writeFileSync(file, crypto.randomBytes(32).toString('hex'), { mode: 0o600 });
  return Buffer.from(fs.readFileSync(file, 'utf8').trim(), 'hex');
}

export const APP_SECRET = loadSecret();
