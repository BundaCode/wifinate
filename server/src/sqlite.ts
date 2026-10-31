import { createRequire } from 'node:module';

/**
 * Database SQLite memakai modul bawaan Node.js (`node:sqlite`, Node 22.13+).
 * Tidak butuh modul native (better-sqlite3) yang harus dikompilasi — jadi `npm install`
 * berhasil di Windows tanpa Visual Studio Build Tools.
 *
 * Kelas ini meniru API better-sqlite3 yang dipakai Wifinate & Drizzle ORM:
 * prepare().run/get/all/raw/iterate, exec, pragma, transaction, backup, close.
 */

// Sembunyikan peringatan "SQLite is an experimental feature" — fitur ini stabil untuk kebutuhan kita.
const originalEmit = process.emitWarning;
process.emitWarning = ((warning: string | Error, ...rest: unknown[]) => {
  const msg = typeof warning === 'string' ? warning : warning?.message;
  if (msg?.includes('SQLite is an experimental feature')) return;
  return (originalEmit as (...a: unknown[]) => void).call(process, warning, ...rest);
}) as typeof process.emitWarning;

type SqlValue = null | number | bigint | string | Uint8Array;
interface NodeStatement {
  run(...p: unknown[]): { changes: number | bigint; lastInsertRowid: number | bigint };
  get(...p: unknown[]): Record<string, SqlValue> | undefined;
  all(...p: unknown[]): Record<string, SqlValue>[];
  iterate(...p: unknown[]): IterableIterator<Record<string, SqlValue>>;
  setAllowBareNamedParameters?(v: boolean): void;
  setAllowUnknownNamedParameters?(v: boolean): void;
  setReturnArrays?(v: boolean): void;
}
interface NodeDatabase {
  prepare(sql: string): NodeStatement;
  exec(sql: string): void;
  close(): void;
}

const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as {
  DatabaseSync: new (path: string, opts: { readOnly: boolean }) => NodeDatabase;
};

/** better-sqlite3 menerima boolean & Date; node:sqlite tidak — ubah dulu. */
function normalize(params: unknown[]): unknown[] {
  return params.map((p) => {
    if (typeof p === 'boolean') return p ? 1 : 0;
    if (p instanceof Date) return p.getTime();
    if (p === undefined) return null;
    if (p && typeof p === 'object' && !(p instanceof Uint8Array) && !Array.isArray(p)) {
      // Parameter bernama { from: 1 } untuk "@from" — normalisasi nilainya juga.
      return Object.fromEntries(Object.entries(p).map(([k, v]) => [k, normalize([v])[0]]));
    }
    return p;
  });
}

export class Statement {
  private rawMode = false;

  constructor(private readonly stmt: NodeStatement) {
    stmt.setAllowBareNamedParameters?.(true);
    stmt.setAllowUnknownNamedParameters?.(true);
  }

  /** raw() → baris dikembalikan sebagai array (dipakai Drizzle untuk select). */
  raw(on = true) {
    this.rawMode = on;
    if (!this.stmt.setReturnArrays) throw new Error('Versi Node.js terlalu lama: butuh Node.js 22.13 atau lebih baru.');
    this.stmt.setReturnArrays(on);
    return this;
  }

  run(...params: unknown[]) {
    const r = this.stmt.run(...normalize(params));
    return { changes: Number(r.changes), lastInsertRowid: r.lastInsertRowid };
  }

  get(...params: unknown[]) { return this.stmt.get(...normalize(params)) as unknown; }
  all(...params: unknown[]) { return this.stmt.all(...normalize(params)) as unknown[]; }
  iterate(...params: unknown[]) { return this.stmt.iterate(...normalize(params)); }
}

export default class Database {
  private readonly db: NodeDatabase;
  private depth = 0;
  private sp = 0;

  constructor(readonly name: string, opts: { readonly?: boolean } = {}) {
    this.db = new DatabaseSync(name, { readOnly: !!opts.readonly });
  }

  prepare(sql: string) { return new Statement(this.db.prepare(sql)); }

  exec(sql: string) { this.db.exec(sql); return this; }

  /** pragma('journal_mode = WAL') atau pragma('user_version', { simple: true }) */
  pragma(source: string, opts: { simple?: boolean } = {}): unknown {
    const rows = this.db.prepare(`PRAGMA ${source}`).all();
    if (opts.simple) { const first = rows[0]; return first ? Object.values(first)[0] : undefined; }
    return rows;
  }

  /**
   * Seperti better-sqlite3: transaction(fn) mengembalikan fungsi yang menjalankan fn di dalam transaksi
   * (commit jika sukses, rollback jika error). Transaksi bersarang memakai SAVEPOINT.
   */
  transaction<A extends unknown[], R>(fn: (...args: A) => R) {
    const wrap = (mode: 'DEFERRED' | 'IMMEDIATE' | 'EXCLUSIVE') => (...args: A): R => {
      if (this.depth > 0) {
        const name = `wsp${++this.sp}`;
        this.db.exec(`SAVEPOINT ${name}`);
        this.depth++;
        try {
          const r = fn(...args);
          this.db.exec(`RELEASE ${name}`);
          return r;
        } catch (e) {
          this.db.exec(`ROLLBACK TO ${name}`);
          this.db.exec(`RELEASE ${name}`);
          throw e;
        } finally { this.depth--; }
      }
      this.db.exec(`BEGIN ${mode}`);
      this.depth++;
      try {
        const r = fn(...args);
        this.db.exec('COMMIT');
        return r;
      } catch (e) {
        try { this.db.exec('ROLLBACK'); } catch { /* sudah dibatalkan */ }
        throw e;
      } finally { this.depth--; }
    };
    const fnTx = wrap('DEFERRED') as ((...args: A) => R) & Record<'deferred' | 'immediate' | 'exclusive', (...args: A) => R>;
    fnTx.deferred = fnTx;
    fnTx.immediate = wrap('IMMEDIATE');
    fnTx.exclusive = wrap('EXCLUSIVE');
    return fnTx;
  }

  /** Salinan database yang konsisten walau aplikasi sedang berjalan. */
  async backup(dest: string) {
    this.db.prepare('VACUUM INTO ?').run(dest);
  }

  close() { this.db.close(); }
}
