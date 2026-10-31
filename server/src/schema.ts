import { sqliteTable, integer, text, real } from 'drizzle-orm/sqlite-core';

export const users = sqliteTable('users', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  username: text('username').notNull().unique(),
  name: text('name').notNull(),
  passwordHash: text('password_hash').notNull(),
  role: text('role', { enum: ['admin', 'kasir'] }).notNull().default('admin'),
  createdAt: integer('created_at').notNull(),
});

export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
});

export const routers = sqliteTable('routers', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  host: text('host').notNull(),
  port: integer('port').notNull().default(8728),
  username: text('username').notNull(),
  passwordEnc: text('password_enc').notNull(),
  useTls: integer('use_tls', { mode: 'boolean' }).notNull().default(false),
  /** Router simulasi untuk mencoba aplikasi tanpa MikroTik asli. */
  isDemo: integer('is_demo', { mode: 'boolean' }).notNull().default(false),
  hotspotServer: text('hotspot_server'),
  dnsName: text('dns_name'),
  lastStatus: text('last_status', { enum: ['online', 'offline', 'unknown'] }).notNull().default('unknown'),
  lastSeenAt: integer('last_seen_at'),
  lastError: text('last_error'),
  createdAt: integer('created_at').notNull(),
});

export const packages = sqliteTable('packages', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  price: integer('price').notNull(),
  /** Batas total waktu online (menit). null = tanpa batas. */
  uptimeLimitMin: integer('uptime_limit_min'),
  /** Masa aktif sejak login pertama (menit). null = tanpa batas. */
  validityMin: integer('validity_min'),
  /** Kecepatan download/upload, format MikroTik: 5M, 512k. */
  rateDown: text('rate_down'),
  rateUp: text('rate_up'),
  sharedUsers: integer('shared_users').notNull().default(1),
  /** Kuota total (MB). null = tanpa batas. */
  quotaMb: integer('quota_mb'),
  color: text('color').notNull().default('#6366f1'),
  active: integer('active', { mode: 'boolean' }).notNull().default(true),
  createdAt: integer('created_at').notNull(),
});

export const voucherBatches = sqliteTable('voucher_batches', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  routerId: integer('router_id').notNull(),
  packageId: integer('package_id').notNull(),
  count: integer('count').notNull(),
  note: text('note'),
  createdBy: integer('created_by'),
  createdAt: integer('created_at').notNull(),
});

export const vouchers = sqliteTable('vouchers', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  batchId: integer('batch_id').notNull(),
  routerId: integer('router_id').notNull(),
  packageId: integer('package_id').notNull(),
  code: text('code').notNull(),
  password: text('password').notNull(),
  price: integer('price').notNull(),
  status: text('status', { enum: ['new', 'active', 'expired', 'disabled'] }).notNull().default('new'),
  createdAt: integer('created_at').notNull(),
  activatedAt: integer('activated_at'),
  expiresAt: integer('expires_at'),
  endedAt: integer('ended_at'),
  endReason: text('end_reason'),
  lastMac: text('last_mac'),
  lastIp: text('last_ip'),
  uptimeSec: integer('uptime_sec').notNull().default(0),
  bytesTotal: real('bytes_total').notNull().default(0),
});

export const sales = sqliteTable('sales', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  voucherId: integer('voucher_id'),
  routerId: integer('router_id').notNull(),
  packageId: integer('package_id').notNull(),
  amount: integer('amount').notNull(),
  /** Siapa yang membuat voucher (kasir/admin). */
  userId: integer('user_id'),
  channel: text('channel', { enum: ['hotspot', 'pppoe'] }).notNull().default('hotspot'),
  soldAt: integer('sold_at').notNull(),
});
