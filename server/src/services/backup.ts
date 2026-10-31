import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import Database from 'better-sqlite3';
import { BACKUP_DIR, DATA_DIR } from '../config.js';
import { sqlite } from '../db.js';

/**
 * Format file backup Wifinate (.wifinate):
 *   "WIFINATE1\n" + gzip( JSON { createdAt, key, db } )
 * - db  : salinan database SQLite (base64), dibuat dengan SQLite online backup → aman walau aplikasi sedang jalan.
 * - key : isi secret.key. Tanpa kunci ini password router yang tersimpan tidak bisa dibuka,
 *         jadi kunci ikut di dalam backup. Simpan file backup di tempat yang aman.
 */
const MAGIC = 'WIFINATE1\n';
const KEEP_DAYS = 14;

function readKey(): string | null {
  const f = path.join(DATA_DIR, 'secret.key');
  return fs.existsSync(f) ? fs.readFileSync(f, 'utf8').trim() : null;
}

export async function createBackupBuffer(): Promise<Buffer> {
  const tmp = path.join(BACKUP_DIR, `.tmp-${crypto.randomBytes(6).toString('hex')}.db`);
  try {
    await sqlite.backup(tmp);
    const payload = JSON.stringify({ createdAt: Date.now(), key: readKey(), db: fs.readFileSync(tmp).toString('base64') });
    return Buffer.concat([Buffer.from(MAGIC), zlib.gzipSync(payload, { level: 9 })]);
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}

export const backupFileName = (d = new Date()) =>
  `wifinate-${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}.wifinate`;

export interface BackupInfo { name: string; size: number; createdAt: number }

export function listBackups(): BackupInfo[] {
  return fs.readdirSync(BACKUP_DIR)
    .filter((f) => f.endsWith('.wifinate'))
    .map((name) => { const st = fs.statSync(path.join(BACKUP_DIR, name)); return { name, size: st.size, createdAt: st.mtimeMs }; })
    .sort((a, b) => b.createdAt - a.createdAt);
}

export function backupPath(name: string): string | null {
  // Cegah path traversal: hanya nama file di folder backup.
  if (!/^[\w.-]+\.wifinate$/.test(name)) return null;
  const p = path.join(BACKUP_DIR, name);
  return fs.existsSync(p) ? p : null;
}

/** Backup otomatis harian; simpan 14 hari terakhir. */
export async function dailyBackup(log: (m: string) => void) {
  const name = backupFileName();
  const file = path.join(BACKUP_DIR, name);
  if (fs.existsSync(file)) return;
  fs.writeFileSync(file, await createBackupBuffer(), { mode: 0o600 });
  log(`Backup otomatis dibuat: ${name}`);
  const cutoff = Date.now() - KEEP_DAYS * 86_400_000;
  for (const b of listBackups()) {
    if (b.createdAt < cutoff) fs.rmSync(path.join(BACKUP_DIR, b.name), { force: true });
  }
}

/**
 * Periksa file backup, lalu siapkan untuk dipulihkan saat aplikasi dinyalakan ulang.
 * Mengembalikan ringkasan isi backup.
 */
export function stageRestore(buf: Buffer) {
  if (!buf.subarray(0, MAGIC.length).equals(Buffer.from(MAGIC))) {
    throw Object.assign(new Error('File ini bukan backup Wifinate (.wifinate).'), { statusCode: 400 });
  }
  let data: { createdAt: number; key: string | null; db: string };
  try {
    data = JSON.parse(zlib.gunzipSync(buf.subarray(MAGIC.length)).toString('utf8'));
  } catch {
    throw Object.assign(new Error('File backup rusak atau tidak lengkap.'), { statusCode: 400 });
  }
  const dbFile = path.join(DATA_DIR, 'restore.db');
  fs.writeFileSync(dbFile, Buffer.from(data.db, 'base64'), { mode: 0o600 });

  // Pastikan benar-benar database Wifinate yang utuh sebelum dipakai.
  let summary: { users: number; vouchers: number; customers: number; version: number };
  try {
    const check = new Database(dbFile, { readonly: true });
    const ok = (check.pragma('integrity_check', { simple: true }) as string) === 'ok';
    const has = (t: string) => !!check.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name=?`).get(t);
    if (!ok || !has('users') || !has('vouchers')) throw new Error('bad');
    const n = (t: string) => (has(t) ? (check.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number }).n : 0);
    summary = { users: n('users'), vouchers: n('vouchers'), customers: n('customers'), version: check.pragma('user_version', { simple: true }) as number };
    check.close();
  } catch {
    fs.rmSync(dbFile, { force: true });
    throw Object.assign(new Error('Isi backup bukan database Wifinate yang valid.'), { statusCode: 400 });
  }
  if (data.key) fs.writeFileSync(path.join(DATA_DIR, 'restore.key'), data.key, { mode: 0o600 });
  return { ...summary, createdAt: data.createdAt };
}
