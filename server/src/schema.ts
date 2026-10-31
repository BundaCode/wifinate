import { sqliteTable, integer, text, real } from 'drizzle-orm/sqlite-core';

export const users = sqliteTable('users', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  username: text('username').notNull().unique(),
  name: text('name').notNull(),
  passwordHash: text('password_hash').notNull(),
  role: text('role', { enum: ['admin', 'kasir', 'reseller'] }).notNull().default('admin'),
  /** Khusus reseller: saldo deposit (Rp), diskon (%), kontak, status aktif. */
  balance: integer('balance').notNull().default(0),
  discountPct: integer('discount_pct').notNull().default(0),
  phone: text('phone'),
  active: integer('active', { mode: 'boolean' }).notNull().default(true),
  /** Naik setiap password diganti / keluar dari semua perangkat → token lama tidak berlaku. */
  tokenVersion: integer('token_version').notNull().default(0),
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
  /** Hasil wizard PPPoE: alamat gateway & nama pool untuk profil paket. */
  pppLocalAddress: text('ppp_local_address'),
  pppPool: text('ppp_pool'),
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
  /** Diisi jika dibeli reseller: id reseller & total yang dibayar dari saldo. */
  resellerId: integer('reseller_id'),
  cost: integer('cost'),
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
  resellerId: integer('reseller_id'),
});

export const sales = sqliteTable('sales', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  voucherId: integer('voucher_id'),
  routerId: integer('router_id').notNull(),
  packageId: integer('package_id').notNull(),
  amount: integer('amount').notNull(),
  /** Siapa yang membuat voucher (kasir/admin). */
  userId: integer('user_id'),
  channel: text('channel', { enum: ['hotspot', 'pppoe', 'reseller'] }).notNull().default('hotspot'),
  customerId: integer('customer_id'),
  invoiceId: integer('invoice_id'),
  soldAt: integer('sold_at').notNull(),
});

// ---------- PPPoE (tahap 2) ----------

export const pppPlans = sqliteTable('ppp_plans', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  /** Harga per bulan. */
  price: integer('price').notNull(),
  rateDown: text('rate_down'),
  rateUp: text('rate_up'),
  color: text('color').notNull().default('#0ea5e9'),
  active: integer('active', { mode: 'boolean' }).notNull().default(true),
  createdAt: integer('created_at').notNull(),
});

export const customers = sqliteTable('customers', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  routerId: integer('router_id').notNull(),
  planId: integer('plan_id').notNull(),
  name: text('name').notNull(),
  phone: text('phone'),
  address: text('address'),
  username: text('username').notNull(),
  passwordEnc: text('password_enc').notNull(),
  status: text('status', { enum: ['active', 'isolated', 'disabled'] }).notNull().default('active'),
  /** Tanggal jatuh tempo berikutnya (ms). */
  nextDueAt: integer('next_due_at').notNull(),
  /** Toleransi telat bayar sebelum diisolir (hari). */
  graceDays: integer('grace_days').notNull().default(3),
  autoIsolate: integer('auto_isolate', { mode: 'boolean' }).notNull().default(true),
  note: text('note'),
  lastPaidAt: integer('last_paid_at'),
  /** Error terakhir saat sinkron ke router (mis. gagal isolir). */
  syncError: text('sync_error'),
  createdAt: integer('created_at').notNull(),
});

export const invoices = sqliteTable('invoices', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  customerId: integer('customer_id').notNull(),
  /** Periode tagihan, mis. "2026-11". */
  period: text('period').notNull(),
  amount: integer('amount').notNull(),
  dueAt: integer('due_at').notNull(),
  status: text('status', { enum: ['unpaid', 'paid', 'void'] }).notNull().default('unpaid'),
  paidAt: integer('paid_at'),
  method: text('method'),
  receivedBy: integer('received_by'),
  createdAt: integer('created_at').notNull(),
});

// ---------- Jaringan kantor (tahap 3) ----------

export const lanNetworks = sqliteTable('lan_networks', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  routerId: integer('router_id').notNull(),
  name: text('name').notNull(),
  slug: text('slug').notNull(),
  mode: text('mode', { enum: ['port', 'vlan'] }).notNull(),
  /** Port fisik (mode port) atau port trunk (mode vlan). */
  iface: text('iface').notNull(),
  vlanId: integer('vlan_id'),
  prefix: text('prefix').notNull(),
  rateDown: text('rate_down'),
  rateUp: text('rate_up'),
  isolate: integer('isolate', { mode: 'boolean' }).notNull().default(false),
  createdAt: integer('created_at').notNull(),
});

// ---------- Reseller (tahap 3) ----------

export const resellerLedger = sqliteTable('reseller_ledger', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: integer('user_id').notNull(),
  type: text('type', { enum: ['topup', 'purchase', 'refund', 'adjust'] }).notNull(),
  /** Positif = saldo bertambah, negatif = berkurang. */
  amount: integer('amount').notNull(),
  balanceAfter: integer('balance_after').notNull(),
  note: text('note'),
  batchId: integer('batch_id'),
  createdBy: integer('created_by'),
  createdAt: integer('created_at').notNull(),
});

// ---------- Notifikasi WhatsApp (tahap 3) ----------

export const notifications = sqliteTable('notifications', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  /** Kunci unik agar pesan yang sama tidak terkirim dua kali. */
  key: text('key').notNull().unique(),
  kind: text('kind').notNull(),
  target: text('target').notNull(),
  message: text('message').notNull(),
  status: text('status', { enum: ['pending', 'sent', 'failed'] }).notNull(),
  error: text('error'),
  createdAt: integer('created_at').notNull(),
});
