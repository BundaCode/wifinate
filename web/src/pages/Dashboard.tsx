import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Wallet, Ticket, Wifi, CalendarDays, CheckCircle2, Circle, ArrowRight, Router as RouterIcon, Receipt } from 'lucide-react';
import clsx from 'clsx';
import { api, tzOffset } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { axisShort, bucketLabel, num, relative, rupiah, rupiahShort } from '@/lib/format';
import { Badge, Button, EmptyState, PageHeader, Skeleton, StatCard } from '@/components/ui';
import { ChartTooltip } from '@/components/charts';

interface DashboardData {
  today: { revenue: number; count: number };
  yesterday: { revenue: number; count: number };
  month: { revenue: number; count: number };
  last7: { bucket: string; revenue: number; count: number }[];
  counts: Record<string, number>;
  routers: { id: number; name: string; lastStatus: string; lastError: string | null; isDemo: boolean; lastSeenAt: number | null }[];
  recent: { id: number; amount: number; soldAt: number; code: string | null; packageName: string | null; color: string | null }[];
  packagesCount: number;
}

function fill7(rows: DashboardData['last7']) {
  const out = [];
  const map = new Map(rows.map((r) => [r.bucket, r]));
  for (let i = 6; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86_400_000);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    out.push({ bucket: key, revenue: map.get(key)?.revenue ?? 0, count: map.get(key)?.count ?? 0 });
  }
  return out;
}

export default function Dashboard() {
  const { user } = useAuth();
  const { data, isLoading } = useQuery({
    queryKey: ['dashboard'], queryFn: () => api<DashboardData>(`/dashboard?tz=${tzOffset()}`), refetchInterval: 30_000,
  });

  const hour = new Date().getHours();
  const greet = hour < 11 ? 'Selamat pagi' : hour < 15 ? 'Selamat siang' : hour < 18 ? 'Selamat sore' : 'Selamat malam';

  if (isLoading || !data) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-12 w-72" />
        <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-32" />)}</div>
        <Skeleton className="h-80" />
      </div>
    );
  }

  const delta = data.yesterday.revenue ? ((data.today.revenue - data.yesterday.revenue) / data.yesterday.revenue) * 100 : null;
  const steps = [
    { done: data.routers.length > 0, label: 'Hubungkan router MikroTik', to: '/router', hint: 'Atau pakai router demo untuk mencoba' },
    { done: data.packagesCount > 0, label: 'Buat paket harga', to: '/paket', hint: 'Contoh: 3 jam Rp2.000' },
    { done: (data.counts.new ?? 0) + (data.counts.active ?? 0) + (data.counts.expired ?? 0) > 0, label: 'Buat & cetak voucher pertama', to: '/voucher', hint: 'Langsung jadi PDF siap cetak' },
  ];
  const onboarding = steps.some((s) => !s.done);
  const chart = fill7(data.last7);

  return (
    <div className="space-y-6">
      <PageHeader
        title={`${greet}, ${user?.name.split(' ')[0]} 👋`}
        description="Ringkasan usaha WiFi Anda hari ini."
        actions={<Link to="/voucher"><Button icon={Ticket}>Buat voucher</Button></Link>}
      />

      {onboarding && (
        <div className="card overflow-hidden">
          <div className="bg-gradient-to-r from-brand-600 to-violet-600 px-6 py-5 text-white">
            <h2 className="text-lg font-bold">Ayo mulai! Tinggal {steps.filter((s) => !s.done).length} langkah lagi</h2>
            <p className="text-sm text-white/80">Ikuti urutan di bawah, setelah itu usaha WiFi Anda siap jualan.</p>
          </div>
          <div className="grid divide-y md:grid-cols-3 md:divide-x md:divide-y-0">
            {steps.map((s, i) => (
              <Link key={s.to} to={s.to} className="group flex items-center gap-4 p-5 transition hover:bg-[var(--surface-2)]">
                {s.done ? <CheckCircle2 className="size-7 shrink-0 text-emerald-500" /> : <Circle className="size-7 shrink-0 text-muted" />}
                <div className="flex-1">
                  <p className="text-xs font-semibold text-muted">Langkah {i + 1}</p>
                  <p className={clsx('font-bold', s.done && 'text-muted line-through')}>{s.label}</p>
                  <p className="text-xs text-muted">{s.hint}</p>
                </div>
                {!s.done && <ArrowRight className="size-4 text-muted transition group-hover:translate-x-1 group-hover:text-brand-600" />}
              </Link>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        <StatCard label="Pendapatan hari ini" value={rupiah(data.today.revenue)} icon={Wallet} delta={delta} sub="dibanding kemarin" />
        <StatCard label="Voucher terjual hari ini" value={num(data.today.count)} icon={Receipt} tone="sky" sub={`Kemarin ${num(data.yesterday.count)}`} />
        <StatCard label="Sedang aktif" value={num(data.counts.active ?? 0)} icon={Wifi} tone="green" sub={`${num(data.counts.new ?? 0)} voucher siap jual`} />
        <StatCard label="Pendapatan bulan ini" value={rupiahShort(data.month.revenue)} icon={CalendarDays} tone="amber" sub={`${num(data.month.count)} transaksi`} />
      </div>

      <div className="grid gap-6 xl:grid-cols-3">
        <div className="card p-5 xl:col-span-2">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h3 className="font-bold">Pendapatan 7 hari terakhir</h3>
              <p className="text-sm text-muted">Total {rupiah(chart.reduce((a, b) => a + b.revenue, 0))}</p>
            </div>
            <Link to="/laporan" className="text-sm font-semibold text-brand-600 hover:underline">Lihat laporan →</Link>
          </div>
          <div className="h-72">
            <ResponsiveContainer>
              <AreaChart data={chart} margin={{ left: 0, right: 8, top: 8 }}>
                <defs>
                  <linearGradient id="g1" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#6366f1" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="#6366f1" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid vertical={false} stroke="var(--border)" />
                <XAxis dataKey="bucket" tickFormatter={bucketLabel} tickLine={false} axisLine={false} tick={{ fill: 'var(--muted)', fontSize: 12 }} />
                <YAxis tickFormatter={axisShort} tickLine={false} axisLine={false} width={48} tick={{ fill: 'var(--muted)', fontSize: 12 }} />
                <Tooltip content={<ChartTooltip />} cursor={{ stroke: 'var(--border)' }} />
                <Area type="monotone" dataKey="revenue" name="Pendapatan" stroke="#6366f1" strokeWidth={2.5} fill="url(#g1)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="space-y-6">
          <div className="card p-5">
            <h3 className="mb-3 font-bold">Status router</h3>
            {data.routers.length === 0 ? (
              <EmptyState icon={RouterIcon} title="Belum ada router" action={<Link to="/router"><Button size="sm">Tambah router</Button></Link>} />
            ) : (
              <ul className="space-y-2">
                {data.routers.map((r) => (
                  <li key={r.id} className="flex items-center gap-3 rounded-xl bg-[var(--surface-2)] p-3">
                    <span className={clsx('size-2.5 rounded-full', r.lastStatus === 'online' ? 'bg-emerald-500 shadow-[0_0_0_4px] shadow-emerald-500/20' : r.lastStatus === 'offline' ? 'bg-rose-500' : 'bg-slate-400')} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold">{r.name} {r.isDemo && <Badge tone="amber">Demo</Badge>}</p>
                      <p className="truncate text-xs text-muted">{r.lastStatus === 'offline' ? r.lastError : r.lastSeenAt ? `Terhubung ${relative(r.lastSeenAt)}` : 'Menghubungkan…'}</p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="card p-5">
            <h3 className="mb-3 font-bold">Penjualan terbaru</h3>
            {data.recent.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted">Belum ada penjualan. Voucher tercatat terjual saat pelanggan pertama kali login.</p>
            ) : (
              <ul className="divide-y">
                {data.recent.map((s) => (
                  <li key={s.id} className="flex items-center gap-3 py-2.5">
                    <span className="size-2 rounded-full" style={{ background: s.color ?? '#94a3b8' }} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold">{s.packageName ?? 'Paket'} <span className="font-mono text-xs text-muted">{s.code}</span></p>
                      <p className="text-xs text-muted">{relative(s.soldAt)}</p>
                    </div>
                    <span className="text-sm font-bold text-emerald-600">+{rupiah(s.amount)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
