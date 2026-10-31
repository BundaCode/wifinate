import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { ArrowDown, ArrowUp, Radio } from 'lucide-react';
import clsx from 'clsx';
import { api } from '@/lib/api';
import { bps } from '@/lib/format';
import type { RouterInterface } from '@/lib/types';
import { Select } from './ui';

interface Point { t: number; rx: number; tx: number }
const MAX_POINTS = 60;

function TrafficTooltip({ active, payload }: { active?: boolean; payload?: { payload: Point }[] }) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return (
    <div className="rounded-xl border bg-[var(--surface)] px-3 py-2 text-xs shadow-xl">
      <p className="mb-1 font-semibold">{new Date(p.t).toLocaleTimeString('id-ID')}</p>
      <p className="text-sky-600">↓ Download {bps(p.rx)}</p>
      <p className="text-violet-600">↑ Upload {bps(p.tx)}</p>
    </div>
  );
}

/** Grafik trafik real-time per interface lewat WebSocket (1 titik per detik). */
export default function LiveTraffic({ routerId }: { routerId: number }) {
  const ifaces = useQuery({ queryKey: ['ifaces', routerId], queryFn: () => api<RouterInterface[]>(`/routers/${routerId}/interfaces`) });
  const [iface, setIface] = useState('');
  const current = iface || ifaces.data?.find((i) => i.running && !i.disabled)?.name || '';
  const [points, setPoints] = useState<Point[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    if (!current) return;
    setPoints([]);
    setError(null);
    let ws: WebSocket | null = null;
    let cancelled = false;
    // Minta tiket sekali pakai dulu — token login tidak pernah dikirim lewat URL.
    api<{ ticket: string }>('/auth/ws-ticket', { method: 'POST' }).then(({ ticket }) => {
      if (cancelled) return;
      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      ws = new WebSocket(`${proto}://${location.host}/api/ws/traffic?routerId=${routerId}&iface=${encodeURIComponent(current)}&ticket=${encodeURIComponent(ticket)}`);
      ws.onopen = () => setConnected(true);
      ws.onclose = () => setConnected(false);
      ws.onmessage = (m) => {
        const d = JSON.parse(m.data);
        if (d.error) { setError(d.error); return; }
        setError(null);
        setPoints((p) => [...p.slice(-(MAX_POINTS - 1)), d]);
      };
    }).catch((e) => setError((e as Error).message));
    return () => { cancelled = true; ws?.close(); };
  }, [routerId, current]);

  // Interface diurutkan: yang aktif (kabel tersambung) di atas.
  const options = [...(ifaces.data ?? [])].filter((i) => !i.disabled).sort((a, b) => Number(b.running) - Number(a.running));
  const last = points[points.length - 1];
  const peak = points.reduce((m, p) => Math.max(m, p.rx), 0);

  return (
    <div className="card p-5">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="flex-1">
          <h3 className="flex items-center gap-2 font-bold">
            Trafik live
            <span className={clsx('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold', connected ? 'bg-emerald-500/10 text-emerald-600' : 'bg-slate-500/10 text-muted')}>
              <Radio className={clsx('size-3', connected && 'animate-pulse')} />{connected ? 'LIVE' : 'Menghubungkan…'}
            </span>
          </h3>
          <p className="text-sm text-muted">Kecepatan internet yang sedang lewat di port ini, diperbarui tiap detik.</p>
        </div>
        <Select className="h-10 w-48" value={current} onChange={(e) => setIface(e.target.value)}>
          {options.map((i) => <option key={i.name} value={i.name}>{i.name}{i.running ? '' : ' (tidak tersambung)'}</option>)}
        </Select>
      </div>

      <div className="mb-3 grid grid-cols-3 gap-3">
        <div className="rounded-xl bg-sky-500/10 p-3"><p className="flex items-center gap-1 text-xs font-semibold text-sky-700 dark:text-sky-400"><ArrowDown className="size-3.5" />Download</p><p className="mt-1 text-lg font-extrabold">{last ? bps(last.rx) : '—'}</p></div>
        <div className="rounded-xl bg-violet-500/10 p-3"><p className="flex items-center gap-1 text-xs font-semibold text-violet-700 dark:text-violet-400"><ArrowUp className="size-3.5" />Upload</p><p className="mt-1 text-lg font-extrabold">{last ? bps(last.tx) : '—'}</p></div>
        <div className="rounded-xl bg-[var(--surface-2)] p-3"><p className="text-xs font-semibold text-muted">Puncak (1 menit)</p><p className="mt-1 text-lg font-extrabold">{peak ? bps(peak) : '—'}</p></div>
      </div>

      {error ? <p className="rounded-xl bg-rose-500/5 p-4 text-sm text-rose-600">{error}</p> : (
        <div className="h-56">
          <ResponsiveContainer>
            <AreaChart data={points} margin={{ left: 0, right: 4, top: 4 }}>
              <defs>
                <linearGradient id="trx" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#0ea5e9" stopOpacity={0.35} /><stop offset="100%" stopColor="#0ea5e9" stopOpacity={0} /></linearGradient>
                <linearGradient id="ttx" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#8b5cf6" stopOpacity={0.3} /><stop offset="100%" stopColor="#8b5cf6" stopOpacity={0} /></linearGradient>
              </defs>
              <CartesianGrid vertical={false} stroke="var(--border)" />
              <XAxis dataKey="t" hide />
              <YAxis tickFormatter={(v) => bps(v).replace('.0 ', ' ')} tickLine={false} axisLine={false} width={72} tick={{ fill: 'var(--muted)', fontSize: 11 }} />
              <Tooltip content={<TrafficTooltip />} cursor={{ stroke: 'var(--border)' }} />
              <Area type="monotone" dataKey="rx" stroke="#0ea5e9" strokeWidth={2} fill="url(#trx)" isAnimationActive={false} />
              <Area type="monotone" dataKey="tx" stroke="#8b5cf6" strokeWidth={2} fill="url(#ttx)" isAnimationActive={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
