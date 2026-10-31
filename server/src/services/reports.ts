import { sqlite } from '../db.js';

export interface SalesFilter {
  from: number;
  to: number;
  routerId?: number;
  packageId?: number;
  channel?: 'hotspot' | 'pppoe';
  /** Zona waktu offset menit dari klien (mis. WIB = 420) supaya pengelompokan per hari tepat. */
  tzOffsetMin: number;
  granularity: 'hour' | 'day' | 'month';
}

function where(f: SalesFilter, alias = 's') {
  const clauses = [`${alias}.sold_at >= @from`, `${alias}.sold_at < @to`];
  if (f.routerId) clauses.push(`${alias}.router_id = @routerId`);
  if (f.packageId) clauses.push(`${alias}.package_id = @packageId`);
  if (f.channel) clauses.push(`${alias}.channel = @channel`);
  return clauses.join(' AND ');
}

function params(f: SalesFilter) {
  return {
    from: f.from, to: f.to, routerId: f.routerId ?? null, packageId: f.packageId ?? null,
    channel: f.channel ?? null, tz: f.tzOffsetMin * 60_000,
  };
}

const bucketFmt = { hour: '%Y-%m-%d %H:00', day: '%Y-%m-%d', month: '%Y-%m' } as const;

export function salesSummary(f: SalesFilter) {
  const p = params(f);
  const w = where(f);

  const totals = sqlite.prepare(
    `SELECT COALESCE(SUM(amount),0) AS revenue, COUNT(*) AS count FROM sales s WHERE ${w}`,
  ).get(p) as { revenue: number; count: number };

  // Periode sebelumnya dengan panjang yang sama → untuk persentase naik/turun.
  const span = f.to - f.from;
  const prev = sqlite.prepare(
    `SELECT COALESCE(SUM(amount),0) AS revenue, COUNT(*) AS count FROM sales s WHERE ${w}`,
  ).get({ ...p, from: f.from - span, to: f.from }) as { revenue: number; count: number };

  const series = sqlite.prepare(
    `SELECT strftime('${bucketFmt[f.granularity]}', (s.sold_at + @tz) / 1000, 'unixepoch') AS bucket,
            SUM(amount) AS revenue, COUNT(*) AS count
       FROM sales s WHERE ${w} GROUP BY bucket ORDER BY bucket`,
  ).all(p) as { bucket: string; revenue: number; count: number }[];

  const byPackage = sqlite.prepare(
    `SELECT s.package_id AS packageId, COALESCE(p.name, 'Paket terhapus') AS name, COALESCE(p.color, '#94a3b8') AS color,
            SUM(s.amount) AS revenue, COUNT(*) AS count
       FROM sales s LEFT JOIN packages p ON p.id = s.package_id
      WHERE ${w} GROUP BY s.package_id ORDER BY revenue DESC`,
  ).all(p) as { packageId: number; name: string; color: string; revenue: number; count: number }[];

  const byRouter = sqlite.prepare(
    `SELECT s.router_id AS routerId, COALESCE(r.name, 'Router terhapus') AS name, SUM(s.amount) AS revenue, COUNT(*) AS count
       FROM sales s LEFT JOIN routers r ON r.id = s.router_id
      WHERE ${w} GROUP BY s.router_id ORDER BY revenue DESC`,
  ).all(p) as { routerId: number; name: string; revenue: number; count: number }[];

  // Jam ramai (0–23) untuk tahu kapan pelanggan paling banyak beli.
  const byHour = sqlite.prepare(
    `SELECT CAST(strftime('%H', (s.sold_at + @tz) / 1000, 'unixepoch') AS INTEGER) AS hour, COUNT(*) AS count, SUM(amount) AS revenue
       FROM sales s WHERE ${w} GROUP BY hour ORDER BY hour`,
  ).all(p) as { hour: number; count: number; revenue: number }[];

  const days = Math.max(1, Math.ceil(span / 86_400_000));
  return {
    totals: {
      revenue: totals.revenue,
      count: totals.count,
      average: totals.count ? Math.round(totals.revenue / totals.count) : 0,
      perDay: Math.round(totals.revenue / days),
      prevRevenue: prev.revenue,
      prevCount: prev.count,
    },
    series,
    byPackage,
    byRouter,
    byHour,
  };
}

export function salesRows(f: SalesFilter & { page: number; pageSize: number; search?: string }) {
  const p = { ...params(f), search: f.search ? `%${f.search}%` : null, limit: f.pageSize, offset: (f.page - 1) * f.pageSize };
  const w = `${where(f)} ${f.search ? 'AND (v.code LIKE @search OR v.last_mac LIKE @search)' : ''}`;
  const base = `FROM sales s
      LEFT JOIN vouchers v ON v.id = s.voucher_id
      LEFT JOIN packages p ON p.id = s.package_id
      LEFT JOIN routers r ON r.id = s.router_id
      WHERE ${w}`;
  const total = (sqlite.prepare(`SELECT COUNT(*) AS n ${base}`).get(p) as { n: number }).n;
  const rows = sqlite.prepare(
    `SELECT s.id, s.sold_at AS soldAt, s.amount, s.channel, v.code, v.status, v.last_mac AS mac,
            COALESCE(p.name, 'Paket terhapus') AS packageName, COALESCE(p.color, '#94a3b8') AS packageColor,
            COALESCE(r.name, 'Router terhapus') AS routerName
       ${base} ORDER BY s.sold_at DESC LIMIT @limit OFFSET @offset`,
  ).all(p);
  return { total, rows };
}
