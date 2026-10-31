export interface User { id: number; username: string; name: string; role: 'admin' | 'kasir' }

export interface Router {
  id: number; name: string; host: string; port: number; username: string; useTls: boolean; isDemo: boolean;
  hotspotServer: string | null; dnsName: string | null; pppLocalAddress: string | null; pppPool: string | null;
  lastStatus: 'online' | 'offline' | 'unknown'; lastSeenAt: number | null; lastError: string | null; createdAt: number;
}

export interface RouterInfo {
  identity: string; version: string; board: string; uptime: string; cpuLoad: number; freeMemory: number; totalMemory: number;
}
export interface RouterInterface { name: string; type: string; running: boolean; disabled: boolean }

export interface Package {
  id: number; name: string; price: number; uptimeLimitMin: number | null; validityMin: number | null;
  rateDown: string | null; rateUp: string | null; sharedUsers: number; quotaMb: number | null; color: string; active: boolean;
  unused: number; activeCount: number;
}

export type VoucherStatus = 'new' | 'active' | 'expired' | 'disabled';

export interface Voucher {
  id: number; batchId: number; routerId: number; packageId: number; code: string; password: string; price: number;
  status: VoucherStatus; createdAt: number; activatedAt: number | null; expiresAt: number | null; endedAt: number | null;
  endReason: string | null; lastMac: string | null; lastIp: string | null; uptimeSec: number; bytesTotal: number;
  packageName: string; color: string; routerName: string;
}

export interface Batch {
  id: number; count: number; note: string | null; createdAt: number; packageName: string; color: string; price: number;
  routerName: string; unused: number;
}

export interface Settings {
  businessName: string; phone: string; address: string; voucherFooter: string; brandColor: string;
  codeCharset: 'numeric' | 'alpha' | 'alnum'; codeLength: number; codePrefix: string; passwordSameAsCode: boolean; printColumns: number;
  serverUrl: string; loginTitle: string; loginWelcome: string; loginShowPrices: boolean; isolirMessage: string; paymentInfo: string;
}

export interface SalesSummary {
  totals: { revenue: number; count: number; average: number; perDay: number; prevRevenue: number; prevCount: number };
  series: { bucket: string; revenue: number; count: number }[];
  byPackage: { packageId: string; channel: 'hotspot' | 'pppoe'; name: string; color: string; revenue: number; count: number }[];
  byChannel: { channel: 'hotspot' | 'pppoe'; revenue: number; count: number }[];
  byRouter: { routerId: number; name: string; revenue: number; count: number }[];
  byHour: { hour: number; count: number; revenue: number }[];
}

export interface SaleRow {
  id: number; soldAt: number; amount: number; channel: string; code: string | null; status: VoucherStatus | null;
  mac: string | null; packageName: string; packageColor: string; routerName: string; customerName: string | null;
}

// ---------- PPPoE ----------
export interface PppPlan {
  id: number; name: string; price: number; rateDown: string | null; rateUp: string | null; color: string; active: boolean; customers: number;
}

export type CustomerStatus = 'active' | 'isolated' | 'disabled';
export type BillingState = 'paid' | 'unpaid' | 'overdue';

export interface Customer {
  id: number; routerId: number; planId: number; name: string; phone: string | null; address: string | null; username: string;
  status: CustomerStatus; nextDueAt: number; graceDays: number; autoIsolate: boolean; note: string | null; lastPaidAt: number | null;
  syncError: string | null; createdAt: number; planName: string; planPrice: number; planColor: string; routerName: string;
  unpaidTotal: number; unpaidCount: number; oldestUnpaidDue: number | null; billing: BillingState;
}

export interface Invoice {
  id: number; customerId: number; period: string; amount: number; dueAt: number; status: 'unpaid' | 'paid' | 'void';
  paidAt: number | null; method: string | null; createdAt: number;
}

export interface CustomerDetail extends Omit<Customer, 'planName' | 'planPrice' | 'planColor' | 'routerName' | 'unpaidTotal' | 'unpaidCount' | 'oldestUnpaidDue' | 'billing'> {
  password?: string; plan: PppPlan; invoices: Invoice[];
}

export interface InvoiceRow extends Invoice {
  customerName: string; phone: string | null; customerStatus: CustomerStatus; username: string; planName: string; planColor: string;
}

export interface CustomerSummary {
  status: Partial<Record<CustomerStatus, number>>;
  unpaid: { total: number; n: number };
  overdue: { total: number; n: number };
  dueSoon: number;
  collected: { total: number; n: number };
  mrr: number;
}
