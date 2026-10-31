import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { Activity, Wifi, Network, Search, RefreshCw, Router as RouterIcon } from 'lucide-react';
import { Link } from 'react-router-dom';
import { api } from '@/lib/api';
import { useRouters } from '@/lib/queries';
import { bytes, humanSeconds, relative } from '@/lib/format';
import { Badge, Button, EmptyState, Input, PageHeader, Select, Skeleton, StatCard } from '@/components/ui';
import LiveTraffic from '@/components/LiveTraffic';

interface ActiveData {
  hotspot: { user: string; address: string; mac: string; uptimeSec: number; bytesIn: number; bytesOut: number; server: string;
    voucher: { packageName: string; color: string; expiresAt: number | null } | null }[];
  ppp: { name: string; service: string; address: string; callerId: string; uptimeSec: number }[];
}

export default function Monitor() {
  const routers = useRouters();
  const [rid, setRid] = useState<number | ''>('');
  const [tab, setTab] = useState<'hotspot' | 'ppp'>('hotspot');
  const [q, setQ] = useState('');
  const routerId = rid || routers.data?.[0]?.id;
  const active = useQuery({
    queryKey: ['active', routerId], queryFn: () => api<ActiveData>(`/routers/${routerId}/active`),
    enabled: !!routerId, refetchInterval: 5_000, retry: 0,
  });

  if (routers.isLoading) return <Skeleton className="h-64" />;
  if (!routers.data?.length) {
    return <div className="card"><EmptyState icon={RouterIcon} title="Belum ada router" description="Hubungkan router untuk memantau pelanggan." action={<Link to="/router"><Button>Tambah router</Button></Link>} /></div>;
  }

  const hs = (active.data?.hotspot ?? []).filter((h) => !q || `${h.user} ${h.mac} ${h.address}`.toLowerCase().includes(q.toLowerCase()));
  const ppp = (active.data?.ppp ?? []).filter((h) => !q || `${h.name} ${h.callerId} ${h.address}`.toLowerCase().includes(q.toLowerCase()));
  const traffic = (active.data?.hotspot ?? []).reduce((a, b) => a + b.bytesIn + b.bytesOut, 0);

  return (
    <>
      <PageHeader title="Monitor" description="Trafik internet secara langsung dan siapa saja yang sedang online."
        actions={<>
          {routers.data.length > 1 && (
            <Select className="w-52" value={routerId} onChange={(e) => setRid(Number(e.target.value))}>
              {routers.data.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </Select>
          )}
          <Button variant="secondary" icon={RefreshCw} onClick={() => active.refetch()} loading={active.isFetching}>Segarkan</Button>
        </>}
      />

      {routerId && <div className="mb-6"><LiveTraffic routerId={routerId} /></div>}

      {active.isError ? (
        <div className="card p-6 text-center text-rose-600">{(active.error as Error).message}</div>
      ) : (
        <>
          <div className="mb-6 grid gap-4 sm:grid-cols-3">
            <StatCard label="Pelanggan hotspot online" value={active.data?.hotspot.length ?? '…'} icon={Wifi} tone="green" />
            <StatCard label="Pelanggan PPPoE online" value={active.data?.ppp.length ?? '…'} icon={Network} tone="sky" />
            <StatCard label="Total trafik sesi aktif" value={bytes(traffic)} icon={Activity} />
          </div>

          <div className="card overflow-hidden">
            <div className="flex flex-col gap-3 border-b p-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="inline-flex rounded-xl border p-1">
                {([['hotspot', 'Hotspot', active.data?.hotspot.length], ['ppp', 'PPPoE', active.data?.ppp.length]] as const).map(([k, l, n]) => (
                  <button key={k} onClick={() => setTab(k)} className={clsx('flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold', tab === k ? 'bg-brand-600 text-white' : 'text-muted')}>
                    {l} <span className={clsx('rounded-full px-1.5 text-xs', tab === k ? 'bg-white/20' : 'bg-[var(--surface-2)]')}>{n ?? 0}</span>
                  </button>
                ))}
              </div>
              <div className="relative sm:w-64">
                <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
                <Input className="h-9 pl-9 text-sm" placeholder="Cari user / MAC / IP" value={q} onChange={(e) => setQ(e.target.value)} />
              </div>
            </div>
            <div className="overflow-x-auto">
              {active.isLoading ? <div className="p-5"><Skeleton className="h-40" /></div> : tab === 'hotspot' ? (
                <table className="table-base">
                  <thead><tr><th>User</th><th>Paket</th><th>IP / MAC</th><th>Online</th><th>Download</th><th>Upload</th><th>Berakhir</th></tr></thead>
                  <tbody>
                    {hs.map((h) => (
                      <tr key={h.user + h.mac}>
                        <td><span className="flex items-center gap-2"><span className="size-2 animate-pulse rounded-full bg-emerald-500" /><span className="font-mono font-bold">{h.user}</span></span></td>
                        <td>{h.voucher ? <span className="inline-flex items-center gap-2"><span className="size-2 rounded-full" style={{ background: h.voucher.color }} />{h.voucher.packageName}</span> : <Badge>Manual</Badge>}</td>
                        <td><p>{h.address}</p><p className="font-mono text-xs text-muted">{h.mac}</p></td>
                        <td>{humanSeconds(h.uptimeSec)}</td>
                        <td>{bytes(h.bytesOut)}</td>
                        <td>{bytes(h.bytesIn)}</td>
                        <td className="text-muted">{h.voucher?.expiresAt ? relative(h.voucher.expiresAt) : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <table className="table-base">
                  <thead><tr><th>Pelanggan</th><th>Layanan</th><th>IP</th><th>MAC</th><th>Online</th></tr></thead>
                  <tbody>
                    {ppp.map((p) => (
                      <tr key={p.name}>
                        <td><span className="flex items-center gap-2"><span className="size-2 animate-pulse rounded-full bg-emerald-500" /><b>{p.name}</b></span></td>
                        <td><Badge tone="blue">{p.service.toUpperCase()}</Badge></td>
                        <td>{p.address}</td>
                        <td className="font-mono text-xs text-muted">{p.callerId}</td>
                        <td>{humanSeconds(p.uptimeSec)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              {!active.isLoading && (tab === 'hotspot' ? hs : ppp).length === 0 && (
                <p className="py-12 text-center text-sm text-muted">Tidak ada pelanggan {tab === 'hotspot' ? 'hotspot' : 'PPPoE'} yang online.</p>
              )}
            </div>
          </div>
        </>
      )}
    </>
  );
}
