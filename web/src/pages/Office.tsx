import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import clsx from 'clsx';
import {
  Building2, Plus, Trash2, Gauge, ShieldCheck, ArrowLeft, ArrowRight, Wand2, CheckCircle2, Cable, Network, Globe, Lock, Pencil,
  Router as RouterIcon, X, ArrowDown, ArrowUp,
} from 'lucide-react';
import { api } from '@/lib/api';
import { useRouters } from '@/lib/queries';
import { bps, bytes, speed } from '@/lib/format';
import type { RouterInterface } from '@/lib/types';
import { Badge, Button, EmptyState, Field, Input, Modal, PageHeader, Select, Skeleton, Tip, Toggle } from '@/components/ui';

interface Division {
  id: number; name: string; slug: string; mode: 'port' | 'vlan'; iface: string; vlanId: number | null; prefix: string;
  rateDown: string | null; rateUp: string | null; isolate: boolean;
  stats: { rateUp: number; rateDown: number; bytesUp: number; bytesDown: number } | null;
}

type Draft = { name: string; mode: 'port' | 'vlan'; iface: string; vlanId: string; prefix: string; rateDown: string; rateUp: string; isolate: boolean };

const PRESETS: { name: string; rate: string; isolate?: boolean }[] = [
  { name: 'Keuangan', rate: '10M' }, { name: 'Marketing', rate: '20M' }, { name: 'Operasional', rate: '10M' },
  { name: 'Direksi', rate: '20M' }, { name: 'Tamu', rate: '5M', isolate: true },
];
const RATES = ['2M', '5M', '10M', '20M', '30M', '50M'];
const half = (r: string) => (r ? `${Math.max(1, Math.round(parseInt(r) / 2))}M` : '');
const toBits = (r: string | null) => (r ? parseFloat(r) * (/k$/i.test(r) ? 1e3 : 1e6) : 0);

function Wizard({ routerId, existing, onClose }: { routerId: number; existing: Division[]; onClose: () => void }) {
  const qc = useQueryClient();
  const ifaces = useQuery({ queryKey: ['ifaces', routerId], queryFn: () => api<RouterInterface[]>(`/routers/${routerId}/interfaces`) });
  const [step, setStep] = useState(0);
  const [wan, setWan] = useState('ether1');
  const [list, setList] = useState<Draft[]>([]);
  const ports = (ifaces.data ?? []).filter((i) => !i.disabled && i.name !== wan && i.type !== 'vlan');

  const usedPrefixes = new Set([...existing.map((e) => e.prefix), ...list.map((d) => d.prefix)]);
  const nextPrefix = () => { for (let n = 10; n < 250; n += 10) { const p = `192.168.${n}`; if (!usedPrefixes.has(p)) return p; } return '192.168.250'; };
  const nextVlan = () => { const used = new Set([...existing, ...list].map((d) => Number(d.vlanId)).filter(Boolean)); for (let v = 10; v < 4000; v += 10) if (!used.has(v)) return String(v); return '100'; };
  const add = (p?: { name: string; rate: string; isolate?: boolean }) => setList((l) => [...l, {
    name: p?.name ?? '', mode: 'vlan', iface: ports[0]?.name ?? '', vlanId: nextVlan(), prefix: nextPrefix(),
    rateDown: p?.rate ?? '10M', rateUp: half(p?.rate ?? '10M'), isolate: !!p?.isolate,
  }]);
  const upd = (i: number, patch: Partial<Draft>) => setList((l) => l.map((d, j) => (j === i ? { ...d, ...patch } : d)));
  const body = {
    wanInterface: wan,
    divisions: list.map((d) => ({ ...d, vlanId: d.mode === 'vlan' ? Number(d.vlanId) : null, rateDown: d.rateDown || null, rateUp: d.rateUp || null })),
  };

  const preview = useMutation({
    mutationFn: () => api<{ steps: { path: string; description: string }[] }>(`/routers/${routerId}/lan/preview`, { method: 'POST', json: body }),
    onSuccess: () => setStep(2),
    onError: (e) => toast.error(e.message),
  });
  const apply = useMutation({
    mutationFn: () => api<{ backupName: string }>(`/routers/${routerId}/lan/apply`, { method: 'POST', json: body }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['lan', routerId] }); setStep(3); },
    onError: (e) => toast.error(e.message, { duration: 15_000 }),
  });
  const totalDown = list.reduce((a, d) => a + toBits(d.rateDown), 0);
  const titles = ['Sumber internet', 'Atur divisi', 'Periksa sebelum diterapkan', 'Selesai'];

  return (
    <Modal open onClose={onClose} size="xl" title="Buat jaringan kantor" description={`Langkah ${step + 1} dari 4: ${titles[step]}`}
      footer={step < 3 ? <>
        {step > 0 && <Button variant="secondary" icon={ArrowLeft} onClick={() => setStep(step - 1)}>Kembali</Button>}
        {step === 0 && <Button icon={ArrowRight} onClick={() => {
          if (!list.length) add(PRESETS.find((p) => !existing.some((e) => e.name === p.name)));
          setStep(1);
        }}>Lanjut</Button>}
        {step === 1 && <Button icon={ArrowRight} disabled={!list.length} loading={preview.isPending} onClick={() => preview.mutate()}>Lihat rencana</Button>}
        {step === 2 && <Button icon={Wand2} loading={apply.isPending} onClick={() => apply.mutate()}>Terapkan sekarang</Button>}
      </> : <Button onClick={onClose}>Tutup</Button>}>
      <div className="mb-5 flex gap-1.5">{[0, 1, 2, 3].map((i) => <div key={i} className={clsx('h-1.5 flex-1 rounded-full', i <= step ? 'bg-brand-600' : 'bg-[var(--surface-2)]')} />)}</div>
      {ifaces.isLoading ? <Skeleton className="h-40" /> : (
        <>
          {step === 0 && (
            <div className="space-y-4">
              <p className="flex items-center gap-2 text-[15px]"><Globe className="size-5 text-brand-600" /> Port mana yang tersambung ke <b>modem / ISP</b>?</p>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {(ifaces.data ?? []).filter((i) => !i.disabled).map((i) => (
                  <button key={i.name} type="button" onClick={() => setWan(i.name)} className={clsx('flex items-center gap-2 rounded-xl border p-3 text-sm', wan === i.name ? 'border-brand-600 bg-brand-500/5 ring-2 ring-brand-500/20' : 'hover:bg-[var(--surface-2)]')}>
                    <Cable className="size-4" /><span className="flex-1 text-left font-semibold">{i.name}</span>
                    <span className={clsx('size-2 rounded-full', i.running ? 'bg-emerald-500' : 'bg-slate-400')} />
                  </button>
                ))}
              </div>
              <Tip>Setiap divisi mendapat <b>jaringan sendiri</b> (alamat IP berbeda), <b>batas internet</b> yang dibagi rata ke semua perangkat di divisi itu, dan bisa <b>diisolasi</b> (mis. Tamu tidak bisa melihat komputer kantor).</Tip>
            </div>
          )}

          {step === 1 && (
            <div className="space-y-4">
              <div className="flex flex-wrap gap-2">
                {PRESETS.filter((p) => !list.some((d) => d.name === p.name) && !existing.some((d) => d.name === p.name)).map((p) => (
                  <button key={p.name} type="button" onClick={() => add(p)} className="chip"><Plus className="size-4" />{p.name}</button>
                ))}
                <button type="button" onClick={() => add()} className="chip"><Plus className="size-4" />Divisi lain</button>
              </div>

              {list.map((d, i) => (
                <div key={i} className="rounded-2xl border p-4">
                  <div className="flex items-start gap-3">
                    <Input className="h-10 flex-1 font-semibold" value={d.name} onChange={(e) => upd(i, { name: e.target.value })} placeholder="Nama divisi" />
                    <button onClick={() => setList((l) => l.filter((_, j) => j !== i))} className="rounded-lg p-2.5 text-muted hover:text-rose-600"><X className="size-4" /></button>
                  </div>
                  <div className="mt-4 grid gap-4 md:grid-cols-2">
                    <Field label="Cara menyambung">
                      <div className="flex gap-2">
                        <button type="button" onClick={() => upd(i, { mode: 'port' })} className={clsx('chip flex-1 justify-center', d.mode === 'port' && 'chip-active')}>Port sendiri</button>
                        <button type="button" onClick={() => upd(i, { mode: 'vlan' })} className={clsx('chip flex-1 justify-center', d.mode === 'vlan' && 'chip-active')}>VLAN (switch)</button>
                      </div>
                    </Field>
                    <div className="grid grid-cols-[1fr_100px] gap-2">
                      <Field label={d.mode === 'vlan' ? 'Port ke switch' : 'Port divisi'}>
                        <Select className="h-10" value={d.iface} onChange={(e) => upd(i, { iface: e.target.value })}>
                          {ports.map((p) => <option key={p.name} value={p.name}>{p.name}</option>)}
                        </Select>
                      </Field>
                      {d.mode === 'vlan' && <Field label="No. VLAN"><Input className="h-10" inputMode="numeric" value={d.vlanId} onChange={(e) => upd(i, { vlanId: e.target.value.replace(/\D/g, '') })} /></Field>}
                    </div>
                    <Field label="Batas internet (download)" hint={d.rateDown ? `Upload otomatis ${speed(d.rateUp)}. Dibagi rata ke semua perangkat.` : 'Tanpa batas'}>
                      <div className="flex flex-wrap gap-1.5">
                        {RATES.map((r) => <button key={r} type="button" onClick={() => upd(i, { rateDown: r, rateUp: half(r) })} className={clsx('chip h-8 px-3', d.rateDown === r && 'chip-active')}>{r.replace('M', '')} Mbps</button>)}
                        <button type="button" onClick={() => upd(i, { rateDown: '', rateUp: '' })} className={clsx('chip h-8 px-3', !d.rateDown && 'chip-active')}>Bebas</button>
                      </div>
                    </Field>
                    <Field label="Jaringan" hint={`Gateway ${d.prefix}.1 • perangkat dapat ${d.prefix}.10 – .254`}>
                      <Input className="h-10" value={d.prefix} onChange={(e) => upd(i, { prefix: e.target.value })} />
                    </Field>
                  </div>
                  <div className="mt-3"><Toggle checked={d.isolate} onChange={(v) => upd(i, { isolate: v })} label="Isolasi dari divisi lain" description="Hanya bisa internet, tidak bisa membuka komputer, printer, atau file divisi lain. Cocok untuk tamu." /></div>
                </div>
              ))}
              {list.length > 0 && (
                <p className="text-sm text-muted">Total batas download semua divisi: <b className="text-[var(--text)]">{bps(totalDown) || '—'}</b>. Sebaiknya tidak jauh melebihi kecepatan langganan internet kantor.</p>
              )}
              {list.some((d) => d.mode === 'vlan') && <Tip>Mode <b>VLAN</b> butuh <b>switch manageable</b> yang diatur dengan nomor VLAN yang sama. Tanpa switch seperti itu, pilih <b>Port sendiri</b> (satu port router per divisi).</Tip>}
              {list.some((d) => d.mode === 'port') && <Tip>Port yang dipilih untuk <b>Port sendiri</b> sebaiknya <b>bukan anggota bridge</b> (lepas dulu dari bridge di Winbox jika perlu).</Tip>}
            </div>
          )}

          {step === 2 && preview.data && (
            <div className="space-y-4">
              <div className="flex gap-3 rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-4 text-sm">
                <ShieldCheck className="size-5 shrink-0 text-emerald-600" />
                <span>Router <b>dibackup otomatis</b> dulu. Jika ada langkah yang gagal, semua perubahan untuk divisi ini <b>dibatalkan otomatis</b>.</span>
              </div>
              <ol className="max-h-[50vh] space-y-2 overflow-y-auto">
                {preview.data.steps.map((st, i) => (
                  <li key={i} className="flex gap-3 rounded-xl bg-[var(--surface-2)] p-3">
                    <span className="grid size-6 shrink-0 place-items-center rounded-full bg-brand-600 text-xs font-bold text-white">{i + 1}</span>
                    <div><p className="text-sm">{st.description}</p><p className="mt-0.5 font-mono text-[11px] text-muted">{st.path}</p></div>
                  </li>
                ))}
              </ol>
            </div>
          )}

          {step === 3 && (
            <div className="flex flex-col items-center py-8 text-center">
              <span className="grid size-16 place-items-center rounded-full bg-emerald-500/10 text-emerald-600"><CheckCircle2 className="size-9" /></span>
              <p className="mt-4 text-lg font-bold">Jaringan kantor siap!</p>
              <p className="mt-1 max-w-sm text-sm text-muted">Colokkan perangkat ke port/VLAN divisinya, IP akan didapat otomatis. Pemakaian internet tiap divisi bisa dipantau di halaman ini.</p>
            </div>
          )}
        </>
      )}
    </Modal>
  );
}

function EditRate({ routerId, d, onClose }: { routerId: number; d: Division; onClose: () => void }) {
  const qc = useQueryClient();
  const [down, setDown] = useState(d.rateDown ?? '');
  const [up, setUp] = useState(d.rateUp ?? '');
  const save = useMutation({
    mutationFn: () => api(`/routers/${routerId}/lan/${d.id}`, { method: 'PUT', json: { rateDown: down || null, rateUp: up || null } }),
    onSuccess: () => { toast.success('Batas internet diperbarui'); qc.invalidateQueries({ queryKey: ['lan', routerId] }); onClose(); },
    onError: (e) => toast.error(e.message),
  });
  return (
    <Modal open onClose={onClose} title={`Batas internet — ${d.name}`}
      footer={<><Button variant="secondary" onClick={onClose}>Batal</Button><Button loading={save.isPending} onClick={() => save.mutate()}>Simpan</Button></>}>
      <div className="space-y-4">
        <div className="flex flex-wrap gap-2">
          {RATES.map((r) => <button key={r} type="button" onClick={() => { setDown(r); setUp(half(r)); }} className={clsx('chip', down === r && 'chip-active')}>{r.replace('M', '')} Mbps</button>)}
          <button type="button" onClick={() => { setDown(''); setUp(''); }} className={clsx('chip', !down && 'chip-active')}>Bebas</button>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Download"><Input value={down} onChange={(e) => setDown(e.target.value)} placeholder="Bebas" /></Field>
          <Field label="Upload"><Input value={up} onChange={(e) => setUp(e.target.value)} placeholder="Bebas" /></Field>
        </div>
      </div>
    </Modal>
  );
}

export default function Office() {
  const qc = useQueryClient();
  const routers = useRouters();
  const [rid, setRid] = useState<number | ''>('');
  const routerId = (rid || routers.data?.[0]?.id) as number | undefined;
  const [wizard, setWizard] = useState(false);
  const [edit, setEdit] = useState<Division | null>(null);
  const lan = useQuery({
    queryKey: ['lan', routerId], enabled: !!routerId, refetchInterval: 3_000,
    queryFn: () => api<{ error: string | null; divisions: Division[] }>(`/routers/${routerId}/lan`),
  });
  const del = useMutation({
    mutationFn: (id: number) => api(`/routers/${routerId}/lan/${id}`, { method: 'DELETE' }),
    onSuccess: () => { toast.success('Divisi dihapus dari router'); qc.invalidateQueries({ queryKey: ['lan', routerId] }); },
    onError: (e) => toast.error(e.message),
  });

  if (routers.isLoading) return <Skeleton className="h-64" />;
  if (!routers.data?.length) {
    return <div className="card"><EmptyState icon={RouterIcon} title="Belum ada router" action={<Link to="/router"><Button>Tambah router</Button></Link>} /></div>;
  }
  const list = lan.data?.divisions ?? [];
  const totalDown = list.reduce((a, d) => a + (d.stats?.rateDown ?? 0), 0);

  return (
    <>
      <PageHeader title="Jaringan kantor" description="Bagi jaringan & kecepatan internet per divisi. Cocok untuk kantor, sekolah, atau kos."
        actions={<>
          {routers.data.length > 1 && (
            <Select className="w-52" value={routerId} onChange={(e) => setRid(Number(e.target.value))}>
              {routers.data.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </Select>
          )}
          <Button icon={Plus} onClick={() => setWizard(true)}>{list.length ? 'Tambah divisi' : 'Buat jaringan kantor'}</Button>
        </>} />

      {lan.data?.error && <div className="card mb-4 p-4 text-sm text-rose-600">{lan.data.error}</div>}

      {lan.isLoading ? <Skeleton className="h-48" /> : !list.length ? (
        <div className="card">
          <EmptyState icon={Building2} title="Belum ada jaringan kantor"
            description="Contoh: Keuangan 10 Mbps, Marketing 20 Mbps, Tamu 5 Mbps (terisolasi). Wizard akan memandu langkah demi langkah."
            action={<Button icon={Wand2} onClick={() => setWizard(true)}>Mulai wizard</Button>} />
        </div>
      ) : (
        <>
          <div className="card mb-4 flex flex-wrap items-center gap-6 p-5">
            <div><p className="text-sm text-muted">Total pemakaian saat ini</p><p className="text-2xl font-extrabold">{bps(totalDown)}</p></div>
            <div className="h-10 w-px bg-[var(--border)]" />
            <div><p className="text-sm text-muted">Divisi</p><p className="text-2xl font-extrabold">{list.length}</p></div>
            <p className="ml-auto text-xs text-muted">Diperbarui setiap 3 detik</p>
          </div>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {list.map((d) => {
              const max = toBits(d.rateDown);
              const pct = max && d.stats ? Math.min(100, (d.stats.rateDown / max) * 100) : 0;
              return (
                <div key={d.id} className="card p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h3 className="flex items-center gap-2 text-lg font-bold">{d.name}{d.isolate && <Badge tone="amber"><Lock className="size-3" />Terisolasi</Badge>}</h3>
                      <p className="text-sm text-muted">{d.mode === 'vlan' ? <><Network className="mr-1 inline size-3.5" />VLAN {d.vlanId} via {d.iface}</> : <><Cable className="mr-1 inline size-3.5" />Port {d.iface}</>} • {d.prefix}.0/24</p>
                    </div>
                    <div className="flex gap-1">
                      <button className="rounded-lg p-2 text-muted hover:bg-[var(--surface-2)]" title="Ubah batas" onClick={() => setEdit(d)}><Pencil className="size-4" /></button>
                      <button className="rounded-lg p-2 text-muted hover:text-rose-600" title="Hapus" onClick={() => confirm(`Hapus divisi ${d.name}? Semua setting jaringannya di router ikut dihapus.`) && del.mutate(d.id)}><Trash2 className="size-4" /></button>
                    </div>
                  </div>
                  <div className="mt-5">
                    <div className="mb-1.5 flex items-baseline justify-between text-sm">
                      <span className="flex items-center gap-1 font-semibold"><ArrowDown className="size-3.5 text-sky-600" />{d.stats ? bps(d.stats.rateDown) : '—'}</span>
                      <span className="flex items-center gap-1 text-muted"><Gauge className="size-3.5" />Batas {speed(d.rateDown)}</span>
                    </div>
                    <div className="h-2.5 overflow-hidden rounded-full bg-[var(--surface-2)]">
                      <div className={clsx('h-full rounded-full transition-all duration-700', pct > 90 ? 'bg-rose-500' : pct > 70 ? 'bg-amber-500' : 'bg-sky-500')} style={{ width: `${pct}%` }} />
                    </div>
                    <div className="mt-3 flex justify-between text-xs text-muted">
                      <span className="flex items-center gap-1"><ArrowUp className="size-3" />Upload {d.stats ? bps(d.stats.rateUp) : '—'}</span>
                      <span>Total terpakai {d.stats ? bytes(d.stats.bytesDown + d.stats.bytesUp) : '—'}</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      {wizard && routerId && <Wizard routerId={routerId} existing={list} onClose={() => setWizard(false)} />}
      {edit && routerId && <EditRate routerId={routerId} d={edit} onClose={() => setEdit(null)} />}
    </>
  );
}
