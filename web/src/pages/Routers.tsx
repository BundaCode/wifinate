import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import clsx from 'clsx';
import {
  Plus, Router as RouterIcon, PlugZap, CheckCircle2, Trash2, Wand2, Sparkles, Cpu, Clock, ShieldCheck, ArrowLeft, ArrowRight, Cable, Globe, Wifi,
} from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { useRouters } from '@/lib/queries';
import { relative } from '@/lib/format';
import type { Router, RouterInfo, RouterInterface } from '@/lib/types';
import { Badge, Button, EmptyState, Field, Input, Modal, PageHeader, Skeleton, Tip, Toggle } from '@/components/ui';

type RouterForm = { name: string; host: string; port: string; username: string; password: string; useTls: boolean; isDemo: boolean };
const emptyForm: RouterForm = { name: '', host: '', port: '8728', username: 'admin', password: '', useTls: false, isDemo: false };

function AddRouter({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const [f, setF] = useState<RouterForm>(emptyForm);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [tested, setTested] = useState<{ info: RouterInfo; interfaces: RouterInterface[] } | null>(null);
  const body = { ...f, port: Number(f.port || 8728) };

  const test = useMutation({
    mutationFn: () => api<{ info: RouterInfo; interfaces: RouterInterface[] }>('/routers/test', { method: 'POST', json: body }),
    onSuccess: (r) => { setTested(r); toast.success(`Terhubung ke ${r.info.identity || 'router'}`); },
    onError: (e) => { setTested(null); if (e instanceof ApiError && e.fields) setErrors(e.fields); toast.error(e.message); },
  });
  const save = useMutation({
    mutationFn: () => api<Router>('/routers', { method: 'POST', json: body }),
    onSuccess: () => { toast.success('Router tersimpan'); qc.invalidateQueries({ queryKey: ['routers'] }); qc.invalidateQueries({ queryKey: ['dashboard'] }); close(); },
    onError: (e) => toast.error(e.message),
  });
  const close = () => { setF(emptyForm); setTested(null); setErrors({}); onClose(); };
  const set = <K extends keyof RouterForm>(k: K, v: RouterForm[K]) => { setF((x) => ({ ...x, [k]: v })); setTested(null); };

  const useDemo = () => setF({ ...emptyForm, name: 'Router Demo', host: 'demo.local', username: 'demo', isDemo: true });

  return (
    <Modal open={open} onClose={close} size="lg" title="Hubungkan router MikroTik" description="Wifinate mengontrol router lewat API, persis seperti Winbox tapi otomatis."
      footer={<>
        <Button variant="secondary" icon={PlugZap} loading={test.isPending} onClick={() => test.mutate()}>Tes koneksi</Button>
        <Button icon={CheckCircle2} loading={save.isPending} disabled={!tested} onClick={() => save.mutate()}>Simpan router</Button>
      </>}
    >
      <div className="space-y-5">
        {!f.isDemo && (
          <button onClick={useDemo} className="flex w-full items-center gap-3 rounded-xl border border-dashed border-amber-500/40 bg-amber-500/5 p-4 text-left transition hover:bg-amber-500/10">
            <Sparkles className="size-5 shrink-0 text-amber-500" />
            <span className="text-sm"><b>Belum punya MikroTik?</b> Coba dulu pakai <u>router demo</u>. Semua fitur bisa dicoba tanpa alat.</span>
          </button>
        )}
        {f.isDemo && <Tip>Mode demo aktif: router disimulasikan, voucher akan “dipakai” pelanggan virtual secara acak supaya laporan terisi.</Tip>}

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Nama router" hint="Bebas, misal: Warung Pusat" error={errors.name}><Input value={f.name} onChange={(e) => set('name', e.target.value)} placeholder="Router Rumah" /></Field>
          {!f.isDemo && <Field label="Alamat IP router" hint="Biasanya 192.168.88.1" error={errors.host}><Input value={f.host} onChange={(e) => set('host', e.target.value)} placeholder="192.168.88.1" inputMode="decimal" /></Field>}
        </div>
        {!f.isDemo && (
          <>
            <div className="grid gap-4 sm:grid-cols-[1fr_1fr_120px]">
              <Field label="Username" error={errors.username}><Input value={f.username} onChange={(e) => set('username', e.target.value)} autoComplete="off" /></Field>
              <Field label="Password"><Input type="password" value={f.password} onChange={(e) => set('password', e.target.value)} autoComplete="new-password" /></Field>
              <Field label="Port API" error={errors.port}><Input value={f.port} onChange={(e) => set('port', e.target.value.replace(/\D/g, ''))} /></Field>
            </div>
            <Toggle checked={f.useTls} onChange={(v) => { set('useTls', v); set('port', v ? '8729' : '8728'); }} label="Koneksi terenkripsi (API-SSL)" description="Disarankan jika router diakses lewat internet. Port 8729." />
            <Tip>
              Pastikan layanan API aktif di router: buka Winbox → <b>IP → Services</b> → aktifkan <b>api</b> (atau <b>api-ssl</b>).
            </Tip>
          </>
        )}

        {tested && (
          <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-4">
            <p className="flex items-center gap-2 font-bold text-emerald-700 dark:text-emerald-400"><CheckCircle2 className="size-5" /> Koneksi berhasil!</p>
            <div className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
              <div><p className="text-xs text-muted">Nama</p><p className="font-semibold">{tested.info.identity}</p></div>
              <div><p className="text-xs text-muted">Tipe</p><p className="font-semibold">{tested.info.board}</p></div>
              <div><p className="text-xs text-muted">Versi</p><p className="font-semibold">{tested.info.version}</p></div>
              <div><p className="text-xs text-muted">Port</p><p className="font-semibold">{tested.interfaces.length} interface</p></div>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}

type Setup = { lanInterface: string; wanInterface: string; networkPrefix: string; dnsName: string; hotspotName: string };

function HotspotWizard({ router, onClose }: { router: Router; onClose: () => void }) {
  const qc = useQueryClient();
  const [step, setStep] = useState(0);
  const [s, setS] = useState<Setup>({ lanInterface: '', wanInterface: 'ether1', networkPrefix: '10.5.50', dnsName: 'login.wifi', hotspotName: 'wifinate' });
  const ifaces = useQuery({ queryKey: ['ifaces', router.id], queryFn: () => api<RouterInterface[]>(`/routers/${router.id}/interfaces`) });
  const preview = useMutation({
    mutationFn: () => api<{ steps: { path: string; description: string }[] }>(`/routers/${router.id}/hotspot/preview`, { method: 'POST', json: s }),
    onSuccess: () => setStep(2),
    onError: (e) => toast.error(e.message),
  });
  const apply = useMutation({
    mutationFn: () => api<{ backupName: string }>(`/routers/${router.id}/hotspot/apply`, { method: 'POST', json: s }),
    onSuccess: (r) => { toast.success(`Hotspot aktif! Backup tersimpan: ${r.backupName}`); qc.invalidateQueries({ queryKey: ['routers'] }); setStep(3); },
    onError: (e) => toast.error(e.message, { duration: 12_000 }),
  });

  const list = (ifaces.data ?? []).filter((i) => !i.disabled);
  const IfacePicker = ({ value, onPick, exclude }: { value: string; onPick: (n: string) => void; exclude?: string }) => (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
      {list.filter((i) => i.name !== exclude).map((i) => (
        <button type="button" key={i.name} onClick={() => onPick(i.name)}
          className={clsx('flex items-center gap-2 rounded-xl border p-3 text-left text-sm transition', value === i.name ? 'border-brand-600 bg-brand-500/5 ring-2 ring-brand-500/20' : 'hover:bg-[var(--surface-2)]')}>
          {i.type.includes('wlan') || i.type.includes('wifi') ? <Wifi className="size-4" /> : <Cable className="size-4" />}
          <span className="flex-1 font-semibold">{i.name}</span>
          <span className={clsx('size-2 rounded-full', i.running ? 'bg-emerald-500' : 'bg-slate-400')} title={i.running ? 'Kabel tersambung' : 'Tidak tersambung'} />
        </button>
      ))}
    </div>
  );

  const titles = ['Pilih port internet', 'Pilih port pelanggan', 'Periksa sebelum diterapkan', 'Selesai'];

  return (
    <Modal open onClose={onClose} size="lg" title={`Siapkan hotspot — ${router.name}`} description={`Langkah ${Math.min(step + 1, 4)} dari 4: ${titles[step]}`}
      footer={step < 3 ? <>
        {step > 0 && <Button variant="secondary" icon={ArrowLeft} onClick={() => setStep(step - 1)}>Kembali</Button>}
        {step === 0 && <Button icon={ArrowRight} disabled={!s.wanInterface} onClick={() => setStep(1)}>Lanjut</Button>}
        {step === 1 && <Button icon={ArrowRight} disabled={!s.lanInterface} loading={preview.isPending} onClick={() => preview.mutate()}>Lihat rencana</Button>}
        {step === 2 && <Button icon={Wand2} loading={apply.isPending} onClick={() => apply.mutate()}>Terapkan sekarang</Button>}
      </> : <Button onClick={onClose}>Tutup</Button>}
    >
      <div className="mb-5 flex gap-1.5">{[0, 1, 2, 3].map((i) => <div key={i} className={clsx('h-1.5 flex-1 rounded-full', i <= step ? 'bg-brand-600' : 'bg-[var(--surface-2)]')} />)}</div>
      {ifaces.isLoading ? <Skeleton className="h-40" /> : ifaces.isError ? <p className="text-sm text-rose-600">{(ifaces.error as Error).message}</p> : (
        <>
          {step === 0 && (
            <div className="space-y-4">
              <p className="flex items-center gap-2 text-[15px]"><Globe className="size-5 text-brand-600" /> Port mana yang tersambung ke <b>modem / ISP</b> (sumber internet)?</p>
              <IfacePicker value={s.wanInterface} onPick={(n) => setS({ ...s, wanInterface: n })} />
              <Tip>Biasanya <b>ether1</b>. Titik hijau artinya kabel tersambung.</Tip>
            </div>
          )}
          {step === 1 && (
            <div className="space-y-5">
              <p className="flex items-center gap-2 text-[15px]"><Wifi className="size-5 text-brand-600" /> Port mana yang dipakai <b>pelanggan</b> (ke access point / WiFi)?</p>
              <IfacePicker value={s.lanInterface} onPick={(n) => setS({ ...s, lanInterface: n })} exclude={s.wanInterface} />
              <details className="rounded-xl border p-4 text-sm">
                <summary className="cursor-pointer font-semibold">Pengaturan lanjutan (boleh dilewati)</summary>
                <div className="mt-4 grid gap-4 sm:grid-cols-3">
                  <Field label="Jaringan pelanggan" hint={`IP: ${s.networkPrefix}.x`}><Input value={s.networkPrefix} onChange={(e) => setS({ ...s, networkPrefix: e.target.value })} /></Field>
                  <Field label="Alamat login" hint="Diketik pelanggan di browser"><Input value={s.dnsName} onChange={(e) => setS({ ...s, dnsName: e.target.value })} /></Field>
                  <Field label="Nama hotspot"><Input value={s.hotspotName} onChange={(e) => setS({ ...s, hotspotName: e.target.value })} /></Field>
                </div>
              </details>
            </div>
          )}
          {step === 2 && preview.data && (
            <div className="space-y-4">
              <div className="flex gap-3 rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-4 text-sm">
                <ShieldCheck className="size-5 shrink-0 text-emerald-600" />
                <span>Sebelum mengubah apa pun, Wifinate akan <b>membuat backup router</b> otomatis. Jika ada yang salah, setting lama bisa dikembalikan.</span>
              </div>
              <ol className="space-y-2">
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
              <p className="mt-4 text-lg font-bold">Hotspot siap dipakai!</p>
              <p className="mt-1 max-w-sm text-sm text-muted">Sambungkan HP ke WiFi, halaman login akan muncul di <b>http://{s.dnsName}</b>. Sekarang buat paket & voucher.</p>
            </div>
          )}
        </>
      )}
    </Modal>
  );
}

function RouterCard({ r, onSetup }: { r: Router; onSetup: () => void }) {
  const qc = useQueryClient();
  const info = useQuery({ queryKey: ['router-info', r.id], queryFn: () => api<RouterInfo>(`/routers/${r.id}/info`), refetchInterval: 15_000, retry: 0 });
  const del = useMutation({
    mutationFn: () => api(`/routers/${r.id}`, { method: 'DELETE' }),
    onSuccess: () => { toast.success('Router dihapus'); qc.invalidateQueries({ queryKey: ['routers'] }); },
    onError: (e) => toast.error(e.message),
  });
  const online = info.isSuccess;
  const mem = info.data ? 100 - (info.data.freeMemory / info.data.totalMemory) * 100 : 0;
  return (
    <div className="card p-5">
      <div className="flex items-start gap-4">
        <span className={clsx('grid size-12 shrink-0 place-items-center rounded-2xl', online ? 'bg-emerald-500/10 text-emerald-600' : 'bg-rose-500/10 text-rose-600')}>
          <RouterIcon className="size-6" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-lg font-bold">{r.name}</h3>
            {info.isLoading ? <Badge>Memeriksa…</Badge> : online ? <Badge tone="green" dot>Online</Badge> : <Badge tone="red" dot>Offline</Badge>}
            {r.isDemo && <Badge tone="amber">Demo</Badge>}
          </div>
          <p className="text-sm text-muted">{r.isDemo ? 'Router simulasi' : `${r.host}:${r.port}`}{info.data && ` • ${info.data.board} • RouterOS ${info.data.version}`}</p>
          {!online && !info.isLoading && <p className="mt-2 text-sm text-rose-600">{(info.error as Error)?.message ?? r.lastError}</p>}
        </div>
        <button onClick={() => confirm(`Hapus router "${r.name}"? Data voucher di router ini ikut terhapus dari Wifinate.`) && del.mutate()} className="rounded-lg p-2 text-muted hover:bg-rose-500/10 hover:text-rose-600" title="Hapus"><Trash2 className="size-4" /></button>
      </div>
      {info.data && (
        <div className="mt-5 grid grid-cols-3 gap-3">
          <div className="rounded-xl bg-[var(--surface-2)] p-3"><p className="flex items-center gap-1.5 text-xs text-muted"><Cpu className="size-3.5" />CPU</p><p className="mt-1 font-bold">{info.data.cpuLoad}%</p></div>
          <div className="rounded-xl bg-[var(--surface-2)] p-3"><p className="text-xs text-muted">Memori</p><p className="mt-1 font-bold">{mem.toFixed(0)}%</p></div>
          <div className="rounded-xl bg-[var(--surface-2)] p-3"><p className="flex items-center gap-1.5 text-xs text-muted"><Clock className="size-3.5" />Uptime</p><p className="mt-1 font-bold">{info.data.uptime}</p></div>
        </div>
      )}
      <div className="mt-5 flex flex-wrap items-center gap-3 border-t pt-4">
        {r.hotspotServer ? (
          <span className="text-sm text-muted">Hotspot <b className="text-[var(--text)]">{r.hotspotServer}</b> • login di <b className="text-[var(--text)]">{r.dnsName}</b></span>
        ) : (
          <span className="text-sm text-muted">Hotspot belum disiapkan lewat Wifinate.</span>
        )}
        <div className="flex-1" />
        {r.lastSeenAt && <span className="text-xs text-muted">Sinkron {relative(r.lastSeenAt)}</span>}
        <Button size="sm" variant={r.hotspotServer ? 'secondary' : 'primary'} icon={Wand2} onClick={onSetup} disabled={!online}>
          {r.hotspotServer ? 'Atur ulang hotspot' : 'Siapkan hotspot'}
        </Button>
      </div>
    </div>
  );
}

export default function Routers() {
  const { data, isLoading } = useRouters();
  const [adding, setAdding] = useState(false);
  const [setup, setSetup] = useState<Router | null>(null);
  return (
    <>
      <PageHeader title="Router" description="Hubungkan MikroTik Anda. Bisa lebih dari satu lokasi."
        actions={<Button icon={Plus} onClick={() => setAdding(true)}>Tambah router</Button>} />
      {isLoading ? <Skeleton className="h-48" /> : !data?.length ? (
        <div className="card">
          <EmptyState icon={RouterIcon} title="Belum ada router" description="Masukkan IP, username, dan password MikroTik. Atau coba dulu dengan router demo."
            action={<Button icon={Plus} onClick={() => setAdding(true)}>Tambah router</Button>} />
        </div>
      ) : (
        <div className="grid gap-4 xl:grid-cols-2">{data.map((r) => <RouterCard key={r.id} r={r} onSetup={() => setSetup(r)} />)}</div>
      )}
      <AddRouter open={adding} onClose={() => setAdding(false)} />
      {setup && <HotspotWizard router={setup} onClose={() => setSetup(null)} />}
    </>
  );
}
