import { useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import clsx from 'clsx';
import { Plus, Printer, Search, Ticket, Ban, Layers, Wand2, CheckCircle2 } from 'lucide-react';
import { api, openFile } from '@/lib/api';
import { usePackages, useRouters } from '@/lib/queries';
import { bytes, dateTime, humanMinutes, humanSeconds, relative, rupiah } from '@/lib/format';
import type { Batch, Voucher, VoucherStatus } from '@/lib/types';
import { Badge, Button, EmptyState, Field, Input, Modal, PageHeader, Pagination, Select, Skeleton, voucherStatus } from '@/components/ui';

const QUICK = [10, 20, 40, 100, 200];

function GenerateModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const routers = useRouters();
  const packages = usePackages();
  const pk = (packages.data ?? []).filter((p) => p.active);
  const [routerId, setRouterId] = useState<number | ''>('');
  const [packageId, setPackageId] = useState<number | ''>('');
  const [count, setCount] = useState(40);
  const [note, setNote] = useState('');
  const [result, setResult] = useState<{ id: number; count: number } | null>(null);
  const rid = routerId || routers.data?.[0]?.id || '';
  const pid = packageId || pk[0]?.id || '';
  const selected = pk.find((p) => p.id === pid);

  const gen = useMutation({
    mutationFn: () => api<{ id: number; count: number }>('/vouchers/generate', { method: 'POST', json: { routerId: rid, packageId: pid, count, note: note || undefined } }),
    onSuccess: (b) => {
      setResult(b);
      qc.invalidateQueries({ queryKey: ['vouchers'] });
      qc.invalidateQueries({ queryKey: ['batches'] });
      qc.invalidateQueries({ queryKey: ['packages'] });
    },
    onError: (e) => toast.error(e.message),
  });

  const close = () => { setResult(null); onClose(); };
  const print = () => openFile(`/vouchers/print?batchId=${result!.id}`).catch((e) => toast.error(e.message));

  const missing = !routers.data?.length ? 'router' : !pk.length ? 'paket' : null;

  return (
    <Modal open={open} onClose={close} title={result ? 'Voucher siap!' : 'Buat voucher'} description={result ? undefined : 'Voucher langsung dikirim ke router dan siap dicetak.'}
      footer={result
        ? <><Button variant="secondary" onClick={() => setResult(null)}>Buat lagi</Button><Button icon={Printer} onClick={print}>Cetak PDF</Button></>
        : !missing && <><Button variant="secondary" onClick={close}>Batal</Button><Button icon={Wand2} loading={gen.isPending} onClick={() => gen.mutate()} disabled={!rid || !pid || count < 1}>Buat {count} voucher</Button></>}
    >
      {result ? (
        <div className="flex flex-col items-center py-6 text-center">
          <span className="grid size-16 place-items-center rounded-full bg-emerald-500/10 text-emerald-600"><CheckCircle2 className="size-9" /></span>
          <p className="mt-4 text-lg font-bold">{result.count} voucher berhasil dibuat</p>
          <p className="mt-1 text-sm text-muted">Klik <b>Cetak PDF</b>, lalu print dan gunting sesuai garis.</p>
        </div>
      ) : missing ? (
        <EmptyState icon={missing === 'router' ? Layers : Ticket}
          title={missing === 'router' ? 'Hubungkan router dulu' : 'Buat paket dulu'}
          description={missing === 'router' ? 'Voucher perlu dikirim ke router MikroTik. Anda juga bisa memakai router demo.' : 'Voucher dibuat berdasarkan paket harga.'}
          action={<Link to={missing === 'router' ? '/router' : '/paket'}><Button>{missing === 'router' ? 'Ke halaman Router' : 'Ke halaman Paket'}</Button></Link>} />
      ) : (
        <div className="space-y-5">
          <Field label="Pilih paket">
            <div className="grid gap-2 sm:grid-cols-2">
              {pk.map((p) => (
                <button type="button" key={p.id} onClick={() => setPackageId(p.id)}
                  className={clsx('flex items-center gap-3 rounded-xl border p-3 text-left transition', pid === p.id ? 'border-brand-600 bg-brand-500/5 ring-2 ring-brand-500/20' : 'hover:bg-[var(--surface-2)]')}>
                  <span className="h-10 w-1.5 rounded-full" style={{ background: p.color }} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold">{p.name}</span>
                    <span className="block text-xs text-muted">{humanMinutes(p.uptimeLimitMin ?? p.validityMin)}</span>
                  </span>
                  <span className="font-bold">{rupiah(p.price)}</span>
                </button>
              ))}
            </div>
          </Field>
          {(routers.data?.length ?? 0) > 1 && (
            <Field label="Router">
              <Select value={rid} onChange={(e) => setRouterId(Number(e.target.value))}>
                {routers.data!.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
              </Select>
            </Field>
          )}
          <Field label="Jumlah voucher" hint="1 lembar A4 muat sekitar 36 voucher.">
            <div className="flex flex-wrap gap-2">
              {QUICK.map((q) => <button type="button" key={q} onClick={() => setCount(q)} className={clsx('chip', count === q && 'chip-active')}>{q}</button>)}
              <Input type="number" min={1} max={2000} value={count} onChange={(e) => setCount(Number(e.target.value))} className="h-9 w-24" />
            </div>
          </Field>
          <Field label="Catatan" hint="Opsional, misal: “Titip warung Bu Sari”.">
            <Input value={note} onChange={(e) => setNote(e.target.value)} maxLength={100} />
          </Field>
          {selected && (
            <div className="rounded-xl bg-[var(--surface-2)] p-4 text-sm">
              Nilai jual: <b>{rupiah(selected.price * count)}</b> ({count} × {rupiah(selected.price)})
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

export default function Vouchers() {
  const qc = useQueryClient();
  const [tab, setTab] = useState<'batch' | 'list'>('batch');
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<VoucherStatus | ''>('');
  const [packageId, setPackageId] = useState<number | ''>('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const packages = usePackages();

  const counts = useQuery({ queryKey: ['vouchers', 'counts'], queryFn: () => api<Record<string, number>>('/vouchers/counts'), refetchInterval: 30_000 });
  const batches = useQuery({ queryKey: ['batches'], queryFn: () => api<Batch[]>('/batches'), enabled: tab === 'batch' });
  const params = new URLSearchParams({ page: String(page), pageSize: '50' });
  if (status) params.set('status', status);
  if (packageId) params.set('packageId', String(packageId));
  if (search) params.set('search', search);
  const list = useQuery({
    queryKey: ['vouchers', params.toString()], queryFn: () => api<{ total: number; rows: Voucher[] }>(`/vouchers?${params}`),
    enabled: tab === 'list', placeholderData: keepPreviousData, refetchInterval: 30_000,
  });

  const disable = useMutation({
    mutationFn: (ids: number[]) => api<{ disabled: number }>('/vouchers/disable', { method: 'POST', json: { ids } }),
    onSuccess: (r) => { toast.success(`${r.disabled} voucher dinonaktifkan`); setSelected(new Set()); qc.invalidateQueries({ queryKey: ['vouchers'] }); },
    onError: (e) => toast.error(e.message),
  });

  const toggle = (id: number) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const rows = list.data?.rows ?? [];
  const allChecked = rows.length > 0 && rows.every((r) => selected.has(r.id));

  const statusTabs: { key: VoucherStatus | ''; label: string }[] = [
    { key: '', label: 'Semua' }, { key: 'new', label: 'Belum dipakai' }, { key: 'active', label: 'Aktif' }, { key: 'expired', label: 'Habis' }, { key: 'disabled', label: 'Nonaktif' },
  ];

  return (
    <>
      <PageHeader title="Voucher" description="Buat, cetak, dan kelola voucher WiFi Anda."
        actions={<Button icon={Plus} onClick={() => setOpen(true)}>Buat voucher</Button>} />

      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {(['new', 'active', 'expired', 'disabled'] as const).map((s) => (
          <button key={s} onClick={() => { setTab('list'); setStatus(s); setPage(1); }} className="card p-4 text-left transition hover:border-brand-400">
            <p className="text-xs font-semibold text-muted">{voucherStatus[s].label}</p>
            <p className="mt-1 text-2xl font-extrabold">{(counts.data?.[s] ?? 0).toLocaleString('id-ID')}</p>
          </button>
        ))}
      </div>

      <div className="mb-4 inline-flex rounded-xl border bg-[var(--surface)] p-1">
        {[['batch', 'Riwayat cetak'], ['list', 'Semua voucher']].map(([k, l]) => (
          <button key={k} onClick={() => setTab(k as 'batch' | 'list')} className={clsx('rounded-lg px-4 py-2 text-sm font-semibold transition', tab === k ? 'bg-brand-600 text-white shadow' : 'text-muted hover:text-[var(--text)]')}>{l}</button>
        ))}
      </div>

      {tab === 'batch' ? (
        <div className="card overflow-hidden">
          {batches.isLoading ? <div className="p-5"><Skeleton className="h-40" /></div>
            : !batches.data?.length ? (
              <EmptyState icon={Ticket} title="Belum ada voucher" description="Buat voucher pertama Anda. Langsung jadi PDF siap cetak."
                action={<Button icon={Plus} onClick={() => setOpen(true)}>Buat voucher</Button>} />
            ) : (
              <ul className="divide-y">
                {batches.data.map((b) => (
                  <li key={b.id} className="flex flex-wrap items-center gap-4 p-4 sm:px-5">
                    <span className="grid size-11 place-items-center rounded-xl text-white" style={{ background: b.color }}><Ticket className="size-5" /></span>
                    <div className="min-w-0 flex-1">
                      <p className="font-bold">{b.packageName} <span className="font-normal text-muted">× {b.count}</span></p>
                      <p className="text-xs text-muted">{dateTime(b.createdAt)} • {b.routerName}{b.note ? ` • ${b.note}` : ''}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-semibold">{b.unused} belum dipakai</p>
                      <div className="mt-1 h-1.5 w-28 overflow-hidden rounded-full bg-[var(--surface-2)]">
                        <div className="h-full rounded-full bg-emerald-500" style={{ width: `${((b.count - b.unused) / b.count) * 100}%` }} />
                      </div>
                    </div>
                    <Button size="sm" variant="secondary" icon={Printer} disabled={!b.unused}
                      onClick={() => openFile(`/vouchers/print?batchId=${b.id}`).catch((e) => toast.error(e.message))}>Cetak</Button>
                  </li>
                ))}
              </ul>
            )}
        </div>
      ) : (
        <div className="card overflow-hidden">
          <div className="flex flex-col gap-3 border-b p-4 lg:flex-row lg:items-center">
            <div className="flex flex-wrap gap-2">
              {statusTabs.map((s) => (
                <button key={s.key} onClick={() => { setStatus(s.key); setPage(1); }} className={clsx('chip h-8', status === s.key && 'chip-active')}>{s.label}</button>
              ))}
            </div>
            <div className="flex flex-1 gap-2 lg:justify-end">
              <Select className="h-9 max-w-44 text-sm" value={packageId} onChange={(e) => { setPackageId(e.target.value ? Number(e.target.value) : ''); setPage(1); }}>
                <option value="">Semua paket</option>
                {packages.data?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </Select>
              <div className="relative flex-1 lg:max-w-60">
                <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
                <Input className="h-9 pl-9 text-sm" placeholder="Cari kode / MAC" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
              </div>
            </div>
          </div>

          {selected.size > 0 && (
            <div className="flex items-center gap-3 border-b bg-brand-500/5 px-4 py-2.5 text-sm">
              <b>{selected.size} dipilih</b>
              <Button size="sm" variant="secondary" icon={Printer} onClick={() => openFile(`/vouchers/print?all=1&ids=${[...selected].join(',')}`).catch((e) => toast.error(e.message))}>Cetak</Button>
              <Button size="sm" variant="danger" icon={Ban} loading={disable.isPending}
                onClick={() => confirm(`Nonaktifkan ${selected.size} voucher? Pelanggan yang memakai akan terputus.`) && disable.mutate([...selected])}>Nonaktifkan</Button>
            </div>
          )}

          <div className="overflow-x-auto">
            <table className="table-base">
              <thead>
                <tr>
                  <th className="w-10"><input type="checkbox" className="size-4 accent-brand-600" checked={allChecked} onChange={() => setSelected(allChecked ? new Set() : new Set(rows.map((r) => r.id)))} /></th>
                  <th>Kode</th><th>Paket</th><th>Status</th><th>Pemakaian</th><th>Berakhir</th><th>Perangkat</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((v) => (
                  <tr key={v.id}>
                    <td><input type="checkbox" className="size-4 accent-brand-600" checked={selected.has(v.id)} onChange={() => toggle(v.id)} /></td>
                    <td><span className="font-mono font-bold tracking-wider">{v.code}</span>{v.password !== v.code && <span className="ml-2 font-mono text-xs text-muted">/ {v.password}</span>}</td>
                    <td><span className="inline-flex items-center gap-2"><span className="size-2 rounded-full" style={{ background: v.color }} />{v.packageName}</span></td>
                    <td><Badge tone={voucherStatus[v.status].tone} dot>{voucherStatus[v.status].label}</Badge>{v.endReason && <span className="ml-2 text-xs text-muted">{v.endReason}</span>}</td>
                    <td className="text-muted">{v.uptimeSec ? `${humanSeconds(v.uptimeSec)} • ${bytes(v.bytesTotal)}` : '—'}</td>
                    <td className="text-muted">{v.status === 'active' && v.expiresAt ? relative(v.expiresAt) : v.endedAt ? dateTime(v.endedAt) : '—'}</td>
                    <td className="font-mono text-xs text-muted">{v.lastMac ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!list.isLoading && rows.length === 0 && <p className="py-12 text-center text-sm text-muted">Tidak ada voucher yang cocok.</p>}
          </div>
          <Pagination page={page} pageSize={50} total={list.data?.total ?? 0} onChange={setPage} />
        </div>
      )}

      <GenerateModal open={open} onClose={() => setOpen(false)} />
    </>
  );
}
