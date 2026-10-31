import path from 'node:path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { DATA_DIR } from './config.js';
import * as schema from './schema.js';

export const sqlite = new Database(process.env.DB_FILE ?? path.join(DATA_DIR, 'wifinate.db'));

// Pengaturan performa: WAL agar baca & tulis bisa bersamaan, sinkron NORMAL cukup aman dengan WAL.
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('synchronous = NORMAL');
sqlite.pragma('foreign_keys = ON');
sqlite.pragma('busy_timeout = 5000');
sqlite.pragma('cache_size = -20000'); // ~20MB

/** Migrasi berurutan. Jangan ubah yang sudah ada — tambahkan entri baru di akhir. */
const migrations: string[] = [
  `
  CREATE TABLE users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'admin',
    created_at INTEGER NOT NULL
  );
  CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  CREATE TABLE routers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    host TEXT NOT NULL,
    port INTEGER NOT NULL DEFAULT 8728,
    username TEXT NOT NULL,
    password_enc TEXT NOT NULL,
    use_tls INTEGER NOT NULL DEFAULT 0,
    is_demo INTEGER NOT NULL DEFAULT 0,
    hotspot_server TEXT,
    dns_name TEXT,
    last_status TEXT NOT NULL DEFAULT 'unknown',
    last_seen_at INTEGER,
    last_error TEXT,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE packages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    price INTEGER NOT NULL,
    uptime_limit_min INTEGER,
    validity_min INTEGER,
    rate_down TEXT,
    rate_up TEXT,
    shared_users INTEGER NOT NULL DEFAULT 1,
    quota_mb INTEGER,
    color TEXT NOT NULL DEFAULT '#6366f1',
    active INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE voucher_batches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    router_id INTEGER NOT NULL REFERENCES routers(id) ON DELETE CASCADE,
    package_id INTEGER NOT NULL REFERENCES packages(id),
    count INTEGER NOT NULL,
    note TEXT,
    created_by INTEGER,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE vouchers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    batch_id INTEGER NOT NULL REFERENCES voucher_batches(id) ON DELETE CASCADE,
    router_id INTEGER NOT NULL REFERENCES routers(id) ON DELETE CASCADE,
    package_id INTEGER NOT NULL REFERENCES packages(id),
    code TEXT NOT NULL,
    password TEXT NOT NULL,
    price INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'new',
    created_at INTEGER NOT NULL,
    activated_at INTEGER,
    expires_at INTEGER,
    ended_at INTEGER,
    end_reason TEXT,
    last_mac TEXT,
    last_ip TEXT,
    uptime_sec INTEGER NOT NULL DEFAULT 0,
    bytes_total REAL NOT NULL DEFAULT 0
  );
  CREATE UNIQUE INDEX vouchers_router_code ON vouchers(router_id, code);
  CREATE INDEX vouchers_status ON vouchers(status, router_id);
  CREATE INDEX vouchers_batch ON vouchers(batch_id);
  CREATE TABLE sales (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    voucher_id INTEGER REFERENCES vouchers(id) ON DELETE SET NULL,
    router_id INTEGER NOT NULL,
    package_id INTEGER NOT NULL,
    amount INTEGER NOT NULL,
    user_id INTEGER,
    channel TEXT NOT NULL DEFAULT 'hotspot',
    sold_at INTEGER NOT NULL
  );
  CREATE INDEX sales_sold_at ON sales(sold_at);
  CREATE INDEX sales_router ON sales(router_id, sold_at);
  CREATE INDEX sales_package ON sales(package_id, sold_at);
  `,
  // Tahap 2: PPPoE, pelanggan, tagihan
  `
  ALTER TABLE routers ADD COLUMN ppp_local_address TEXT;
  ALTER TABLE routers ADD COLUMN ppp_pool TEXT;
  ALTER TABLE sales ADD COLUMN customer_id INTEGER;
  ALTER TABLE sales ADD COLUMN invoice_id INTEGER;
  CREATE INDEX sales_channel ON sales(channel, sold_at);
  CREATE TABLE ppp_plans (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    price INTEGER NOT NULL,
    rate_down TEXT,
    rate_up TEXT,
    color TEXT NOT NULL DEFAULT '#0ea5e9',
    active INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE customers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    router_id INTEGER NOT NULL REFERENCES routers(id) ON DELETE CASCADE,
    plan_id INTEGER NOT NULL REFERENCES ppp_plans(id),
    name TEXT NOT NULL,
    phone TEXT,
    address TEXT,
    username TEXT NOT NULL,
    password_enc TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    next_due_at INTEGER NOT NULL,
    grace_days INTEGER NOT NULL DEFAULT 3,
    auto_isolate INTEGER NOT NULL DEFAULT 1,
    note TEXT,
    last_paid_at INTEGER,
    sync_error TEXT,
    created_at INTEGER NOT NULL
  );
  CREATE UNIQUE INDEX customers_router_username ON customers(router_id, username);
  CREATE TABLE invoices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    period TEXT NOT NULL,
    amount INTEGER NOT NULL,
    due_at INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'unpaid',
    paid_at INTEGER,
    method TEXT,
    received_by INTEGER,
    created_at INTEGER NOT NULL
  );
  CREATE UNIQUE INDEX invoices_customer_period ON invoices(customer_id, period);
  CREATE INDEX invoices_status ON invoices(status, due_at);
  `,
  // Tahap 3: jaringan kantor
  `
  CREATE TABLE lan_networks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    router_id INTEGER NOT NULL REFERENCES routers(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    slug TEXT NOT NULL,
    mode TEXT NOT NULL,
    iface TEXT NOT NULL,
    vlan_id INTEGER,
    prefix TEXT NOT NULL,
    rate_down TEXT,
    rate_up TEXT,
    isolate INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  );
  CREATE UNIQUE INDEX lan_router_slug ON lan_networks(router_id, slug);
  `,
];

function migrate() {
  const current = sqlite.pragma('user_version', { simple: true }) as number;
  for (let i = current; i < migrations.length; i++) {
    sqlite.transaction(() => {
      sqlite.exec(migrations[i]);
      sqlite.pragma(`user_version = ${i + 1}`);
    })();
  }
}

migrate();

export const db = drizzle(sqlite, { schema });
export { schema };
