import { useMemo, useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import clsx from 'clsx';
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { Download, Printer, Search, Wallet, Receipt, TrendingUp, CalendarRange, SlidersHorizontal, X, BarChart3 } from 'lucide-react';
import { api, openFile, tzOffset } from '@/lib/api';
import { usePackages, useRouters } from '@/lib/queries';
import { axisShort, bucketLabel, dateTime, num, rupiah, rupiahShort } from '@/lib/format';
import type { SaleRow, SalesSummary } from '@/lib/types';
import { Badge, Button, EmptyState, Input, PageHeader, Pagination, Select, Skeleton, StatCard, voucherStatus } from '@/components/ui';
import { ChartTooltip } from '@/components/charts';

type Preset = 'today' | 'yesterday' | '7d' | '30d' | 'month' | 'lastMonth' | 'year' | 'custom';

const PRESETS: { key: Preset; label: string }[] = [
  { key: 'today', label: 'Hari ini' }, { key: 'yesterday', label: 'Kemarin' }, { key: '7d', label: '7 hari' },
  { key: '30d', label: '30 hari' }, { key: 'month', label: 'Bulan ini' }, { key: 'lastMonth', label: 'Bulan lalu' },
  { key: 'year', label: 'Tahun ini' }, { key: 'custom', label: 'Pilih tanggal' },
];

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const toInput = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

function rangeOf(p: Preset, custom: { from: string; to: string }): [number, number] {
  const now = new Date();
  const today = startOfDay(now);
  const day = 86_400_000;
  switch (p) {
    case 'today': return [today.getTime(), today.getTime() + day];
    case 'yesterday': return [today.getTime() - day, today.getTime()];
    case '7d': return [today.getTime() - 6 * day, today.getTime() + day];
    case '30d': return [today.getTime() - 29 * day, today.getTime() + day];
    case 'month': return [new Date(now.getFullYear(), now.getMonth(), 1).getTime(), today.getTime() + day];
    case 'lastMonth': return [new Date(now.getFullYear(), now.getMonth() - 1, 1).getTime(), new Date(now.getFullYear(), now.getMonth(), 1).getTime()];
    case 'year': return [new Date(now.getFullYear(), 0, 1).getTime(), today.getTime() + day];
    case 'custom': {
      const f = custom.from ? new Date(`${custom.from}T00:00:00`) : today;
      const t = custom.to ? new Date(`${custom.to}T00:00:00`) : today;
      return [f.getTime(), t.getTime() + day];
    }
  }
}

export default function Reports() {
  const routers = useRouters();
  const packages = usePackages();
  const [preset, setPreset] = useState<Preset>('30d');
  const [custom, setCustom] = useState({ from: toInput(new Date(Date.now() - 6 * 86_400_000)), to: toInput(new Date()) });
  const [routerId, setRouterId] = useState('');
  const [packageId, setPackageId] = useState('');
  const [granularity, setGranularity] = useState<'' | 'hour' | 'day' | 'month'>('');
  const [metric, setMetric] = useState<'revenue' | 'count'>('revenue');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [showFilters, setShowFilters] = useState(false);

  const [from, to] = useMemo(() => rangeOf(preset, custom), [preset, custom]);
  const qs = useMemo(() => {
    const p = new URLSearchParams({ from: String(from), to: String(to), tz: String(tzOffset()) });
    if (routerId) p.set('routerId', routerId);
    if (packageId) p.set('packageId', packageId);
    if (granularity) p.set('granularity', granularity);
    return p.toString();
  }, [from, to, routerId, packageId, granularity]);

  const summary = useQuery({ queryKey: ['report', qs], queryFn: () => api<SalesSummary>(`/reports/sales?${qs}`), placeholderData: keepPreviousData });
  const rowsQs = `${qs}&page=${page}&pageSize=25${search ? `&search=${encodeURIComponent(search)}` : ''}`;
  const rows = useQuery({ queryKey: ['report-rows', rowsQs], queryFn: () => api<{ total: number; rows: SaleRow[] }>(`/reports/sales/rows?${rowsQs}`), placeholderData: keepPreviousData });

  const d = summary.data;
  const delta = (cur: number, prev: number) => (prev ? ((cur - prev) / prev) * 100 : null);
  const activeFilters = [routerId, packageId, granularity].filter(Boolean).length;
  const periodLabel = `${new Date(from).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' })} – ${new Date(to - 1).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' })}`;
  const totalPkg = d?.byPackage.reduce((a, b) => a + b.revenue, 0) ?? 0;
  const hours = Array.from({ length: 24 }, (_, h) => ({ hour: h, count: d?.byHour.find((x) => x.hour === h)?.count ?? 0 }));
  const peak = hours.reduce((a, b) => (b.count > a.count ? b : a), hours[0]);

  return (
    <>
      <PageHeader
        title="Laporan penjualan"
        description={<>Periode <b className="text-[var(--text)]">{periodLabel}</b>. Penjualan tercatat saat voucher pertama kali dipakai login.</>}
        actions={<>
          <Button variant="secondary" icon={Printer} onClick={() => window.print()}>Cetak</Button>
          <Button variant="secondary" icon={Download} onClick={() => openFile(`/reports/sales.csv?${qs}`, { download: `laporan-${toInput(new Date(from))}_${toInput(new Date(to - 1))}.csv` }).catch((e) => toast.error(e.message))}>Excel (CSV)</Button>
        </>}
      />

      {/* Filter */}
      <div className="card no-print mb-6 p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
          <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 lg:flex-wrap lg:pb-0">
            {PRESETS.map((p) => (
              <button key={p.key} onClick={() => { setPreset(p.key); setPage(1); }} className={clsx('chip shrink-0', preset === p.key && 'chip-active')}>
                {p.key === 'custom' && <CalendarRange className="size-4" />}{p.label}
              </button>
            ))}
          </div>
          <div className="flex-1" />
          <Button variant="secondary" size="sm" icon={SlidersHorizontal} onClick={() => setShowFilters((s) => !s)}>
            Filter lainnya {activeFilters > 0 && <span className="grid size-5 place-items-center rounded-full bg-brand-600 text-[11px] text-white">{activeFilters}</span>}
          </Button>
        </div>

        {preset === 'custom' && (
          <div className="mt-3 flex flex-wrap items-center gap-2 border-t pt-3">
            <Input type="date" className="h-10 w-auto" value={custom.from} max={custom.to} onChange={(e) => setCustom({ ...custom, from: e.target.value })} />
            <span className="text-muted">sampai</span>
            <Input type="date" className="h-10 w-auto" value={custom.to} min={custom.from} onChange={(e) => setCustom({ ...custom, to: e.target.value })} />
          </div>
        )}

        {showFilters && (
          <div className="mt-3 grid gap-3 border-t pt-3 sm:grid-cols-2 lg:grid-cols-4">
            <Select value={routerId} onChange={(e) => { setRouterId(e.target.value); setPage(1); }}>
              <option value="">Semua router</option>
              {routers.data?.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </Select>
            <Select value={packageId} onChange={(e) => { setPackageId(e.target.value); setPage(1); }}>
              <option value="">Semua paket</option>
              {packages.data?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </Select>
            <Select value={granularity} onChange={(e) => setGranularity(e.target.value as typeof granularity)}>
              <option value="">Kelompokkan: otomatis</option>
              <option value="hour">Per jam</option>
              <option value="day">Per hari</option>
              <option value="month">Per bulan</option>
            </Select>
            {activeFilters > 0 && (
              <Button variant="ghost" icon={X} onClick={() => { setRouterId(''); setPackageId(''); setGranularity(''); }}>Hapus filter</Button>
            )}
          </div>
        )}
      </div>

      {!d ? (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-32" />)}</div>
          <Skeleton className="h-96" />
        </div>
      ) : (
        <div className={clsx('space-y-6 transition', summary.isFetching && 'opacity-70')}>
          <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
            <StatCard label="Total pendapatan" value={rupiah(d.totals.revenue)} icon={Wallet} delta={delta(d.totals.revenue, d.totals.prevRevenue)} sub="vs periode sebelumnya" />
            <StatCard label="Voucher terjual" value={num(d.totals.count)} icon={Receipt} tone="sky" delta={delta(d.totals.count, d.totals.prevCount)} sub="vs periode sebelumnya" />
            <StatCard label="Rata-rata per hari" value={rupiah(d.totals.perDay)} icon={TrendingUp} tone="green" sub={`Rata-rata ${rupiah(d.totals.average)} / voucher`} />
            <StatCard label="Penyumbang terbesar" value={d.byPackage[0]?.name ?? '—'} icon={BarChart3} tone="amber" sub={d.byPackage[0] ? `${num(d.byPackage[0].count)} terjual` : 'Belum ada data'} />
          </div>

          <div className="card p-5">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <h3 className="font-bold">Grafik {metric === 'revenue' ? 'pendapatan' : 'jumlah voucher'}</h3>
              <div className="inline-flex rounded-lg border p-0.5 text-sm">
                {(['revenue', 'count'] as const).map((m) => (
                  <button key={m} onClick={() => setMetric(m)} className={clsx('rounded-md px-3 py-1.5 font-semibold', metric === m ? 'bg-brand-600 text-white' : 'text-muted')}>
                    {m === 'revenue' ? 'Rupiah' : 'Jumlah'}
                  </button>
                ))}
              </div>
            </div>
            {d.series.length === 0 ? (
              <EmptyState icon={BarChart3} title="Belum ada penjualan di periode ini" description="Coba pilih periode lain atau hapus filter." />
            ) : (
              <div className="h-80">
                <ResponsiveContainer>
                  <AreaChart data={d.series} margin={{ left: 0, right: 8, top: 8 }}>
                    <defs>
                      <linearGradient id="rg" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#6366f1" stopOpacity={0.35} />
                        <stop offset="100%" stopColor="#6366f1" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid vertical={false} stroke="var(--border)" />
                    <XAxis dataKey="bucket" tickFormatter={bucketLabel} tickLine={false} axisLine={false} tick={{ fill: 'var(--muted)', fontSize: 12 }} minTickGap={24} />
                    <YAxis tickFormatter={metric === 'revenue' ? axisShort : num} tickLine={false} axisLine={false} width={48} tick={{ fill: 'var(--muted)', fontSize: 12 }} allowDecimals={false} />
                    <Tooltip content={<ChartTooltip />} cursor={{ stroke: 'var(--border)' }} />
                    <Area type="monotone" dataKey={metric} name={metric === 'revenue' ? 'Pendapatan' : 'Voucher'} stroke="#6366f1" strokeWidth={2.5} fill="url(#rg)" dot={d.series.length < 20} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <div className="card p-5">
              <h3 className="font-bold">Penjualan per paket</h3>
              <p className="mb-4 text-sm text-muted">Paket mana yang paling laku.</p>
              {d.byPackage.length === 0 ? <p className="py-10 text-center text-sm text-muted">Belum ada data.</p> : (
                <div className="flex flex-col items-center gap-6 sm:flex-row">
                  <div className="relative size-48 shrink-0">
                    <ResponsiveContainer>
                      <PieChart>
                        <Pie data={d.byPackage} dataKey="revenue" nameKey="name" innerRadius="66%" outerRadius="100%" paddingAngle={2} stroke="none">
                          {d.byPackage.map((p) => <Cell key={p.packageId} fill={p.color} />)}
                        </Pie>
                        <Tooltip content={<ChartTooltip labelFormatter={() => 'Paket'} />} />
                      </PieChart>
                    </ResponsiveContainer>
                    <div className="pointer-events-none absolute inset-0 grid place-items-center text-center">
                      <div><p className="text-xs text-muted">Total</p><p className="font-extrabold">{rupiahShort(totalPkg)}</p></div>
                    </div>
                  </div>
                  <ul className="w-full space-y-3">
                    {d.byPackage.map((p) => (
                      <li key={p.packageId}>
                        <div className="flex items-center justify-between text-sm">
                          <span className="flex items-center gap-2 font-semibold"><span className="size-2.5 rounded-full" style={{ background: p.color }} />{p.name}</span>
                          <span className="font-bold">{rupiah(p.revenue)}</span>
                        </div>
                        <div className="mt-1.5 flex items-center gap-2">
                          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-[var(--surface-2)]">
                            <div className="h-full rounded-full" style={{ width: `${(p.revenue / totalPkg) * 100}%`, background: p.color }} />
                          </div>
                          <span className="w-20 text-right text-xs text-muted">{num(p.count)} • {((p.revenue / totalPkg) * 100).toFixed(0)}%</span>
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>

            <div className="card p-5">
              <h3 className="font-bold">Jam ramai pembeli</h3>
              <p className="mb-4 text-sm text-muted">
                {peak.count ? <>Paling ramai sekitar pukul <b className="text-[var(--text)]">{String(peak.hour).padStart(2, '0')}.00</b>. Pastikan stok voucher cukup di jam ini.</> : 'Belum ada data.'}
              </p>
              <div className="h-52">
                <ResponsiveContainer>
                  <BarChart data={hours} margin={{ left: -20, right: 0 }}>
                    <CartesianGrid vertical={false} stroke="var(--border)" />
                    <XAxis dataKey="hour" tickLine={false} axisLine={false} tick={{ fill: 'var(--muted)', fontSize: 11 }} interval={2} tickFormatter={(h) => `${h}`} />
                    <YAxis allowDecimals={false} tickLine={false} axisLine={false} tick={{ fill: 'var(--muted)', fontSize: 11 }} />
                    <Tooltip content={<ChartTooltip labelFormatter={(h) => `Pukul ${String(h).padStart(2, '0')}.00`} />} cursor={{ fill: 'var(--surface-2)' }} />
                    <Bar dataKey="count" name="Voucher" radius={[6, 6, 0, 0]}>
                      {hours.map((h) => <Cell key={h.hour} fill={h.hour === peak.hour && peak.count ? '#6366f1' : '#a5b4fc'} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>

          {d.byRouter.length > 1 && (
            <div className="card p-5">
              <h3 className="mb-4 font-bold">Per lokasi / router</h3>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {d.byRouter.map((r) => (
                  <div key={r.routerId} className="rounded-xl bg-[var(--surface-2)] p-4">
                    <p className="text-sm font-semibold">{r.name}</p>
                    <p className="mt-1 text-xl font-extrabold">{rupiah(r.revenue)}</p>
                    <p className="text-xs text-muted">{num(r.count)} voucher</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="card overflow-hidden">
            <div className="flex flex-col gap-3 border-b p-4 sm:flex-row sm:items-center sm:justify-between">
              <h3 className="font-bold">Rincian transaksi</h3>
              <div className="relative no-print sm:w-64">
                <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
                <Input className="h-9 pl-9 text-sm" placeholder="Cari kode voucher / MAC" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="table-base">
                <thead><tr><th>Waktu</th><th>Kode</th><th>Paket</th><th>Router</th><th>Status</th><th className="text-right">Nominal</th></tr></thead>
                <tbody>
                  {rows.data?.rows.map((r) => (
                    <tr key={r.id}>
                      <td className="text-muted">{dateTime(r.soldAt)}</td>
                      <td className="font-mono font-semibold">{r.code ?? '—'}</td>
                      <td><span className="inline-flex items-center gap-2"><span className="size-2 rounded-full" style={{ background: r.packageColor }} />{r.packageName}</span></td>
                      <td className="text-muted">{r.routerName}</td>
                      <td>{r.status ? <Badge tone={voucherStatus[r.status].tone}>{voucherStatus[r.status].label}</Badge> : '—'}</td>
                      <td className="text-right font-bold">{rupiah(r.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {rows.data?.rows.length === 0 && <p className="py-10 text-center text-sm text-muted">Tidak ada transaksi.</p>}
            </div>
            <Pagination page={page} pageSize={25} total={rows.data?.total ?? 0} onChange={setPage} />
          </div>
        </div>
      )}
    </>
  );
}
