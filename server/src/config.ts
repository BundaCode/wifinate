import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const DATA_DIR = path.resolve(process.env.DATA_DIR ?? path.join(process.cwd(), 'data'));
fs.mkdirSync(DATA_DIR, { recursive: true });

export const PORT = Number(process.env.PORT ?? 8080);
export const HOST = process.env.HOST ?? '0.0.0.0';
export const IS_PROD = process.env.NODE_ENV === 'production';

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
