import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import clsx from 'clsx';
import {
  Plus, Users, Search, Wallet, ShieldAlert, AlertTriangle, CheckCircle2, Download, MessageCircle, Pencil, Trash2, Lock, Unlock,
  Power, KeyRound, Eye, EyeOff, Gauge, Receipt, Package as PackageIcon, CalendarClock, Phone, MapPin, Dices,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { usePppPlans, useRouters, useSettings } from '@/lib/queries';
import { dateOnly, num, periodLabel, rupiah, rupiahShort, speed, waNumber } from '@/lib/format';
import type { Customer, CustomerDetail, CustomerSummary, Invoice, InvoiceRow, PppPlan } from '@/lib/types';
import { Badge, Button, EmptyState, Field, Input, Modal, PageHeader, Select, Skeleton, StatCard, Tip, Toggle } from '@/components/ui';

const DAY = 86_400_000;
const COLORS = ['#0ea5e9', '#8b5cf6', '#22c55e', '#f59e0b', '#ef4444', '#ec4899', '#6366f1', '#14b8a6'];

const toInput = (ms: number) => { const d = new Date(ms); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const fromInput = (s: string) => new Date(`${s}T09:00:00`).getTime();
const addMonth = (ms: number) => { const d = new Date(ms); d.setMonth(d.getMonth() + 1); return d.getTime(); };
const randomPass = () => Array.from({ length: 6 }, () => 'abcdefghjkmnpqrstuvwxyz23456789'[Math.floor(Math.random() * 31)]).join('');

function dueText(c: Pick<Customer, 'nextDueAt' | 'oldestUnpaidDue' | 'billing'>) {
  const ref = c.billing === 'overdue' && c.oldestUnpaidDue ? c.oldestUnpaidDue : c.nextDueAt;
  const days = Math.round((ref - Date.now()) / DAY);
  if (c.billing === 'overdue') return { text: `Telat ${Math.max(1, -days)} hari`, tone: 'text-rose-600' };
  if (days <= 0) return { text: 'Jatuh tempo hari ini', tone: 'text-amber-600' };
  if (days <= 7) return { text: `${days} hari lagi`, tone: 'text-amber-600' };
  return { text: dateOnly(ref), tone: 'text-muted' };
}

function StatusBadge({ c }: { c: Pick<Customer, 'status' | 'billing'> }) {
  if (c.status === 'disabled') return <Badge tone="gray">Berhenti</Badge>;
  if (c.status === 'isolated') return <Badge tone="red" dot>Terisolir</Badge>;
  if (c.billing === 'overdue') return <Badge tone="amber" dot>Telat bayar</Badge>;
  if (c.billing === 'unpaid') return <Badge tone="blue" dot>Ada tagihan</Badge>;
  return <Badge tone="green" dot>Lunas</Badge>;
}

function useInvalidate() {
  const qc = useQueryClient();
  return () => ['customers', 'customer', 'invoices', 'customer-summary', 'ppp-plans', 'dashboard', 'report'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
}

function waLink(phone: string, msg: string) {
  return `https://wa.me/${waNumber(phone)}?text=${encodeURIComponent(msg)}`;
}

// ---------- Bayar ----------
function PayModal({ target, onClose }: { target: { customerId: number; name: string; amount: number; period?: string; invoiceId?: number } | null; onClose: () => void }) {
  const invalidate = useInvalidate();
  const [method, setMethod] = useState('tunai');
  const pay = useMutation({
    mutationFn: () => api<{ reactivated: boolean; routerError: string | null }>(`/customers/${target!.customerId}/pay`, { method: 'POST', json: { invoiceId: target!.invoiceId, method } }),
    onSuccess: (r) => {
      invalidate();
      toast.success(r.reactivated ? 'Lunas! Internet pelanggan sudah aktif kembali.' : 'Pembayaran tercatat. Terima kasih!');
      if (r.routerError) toast.warning(`Isolir belum terbuka: ${r.routerError}`);
      onClose();
    },
    onError: (e) => toast.error(e.message),
  });
  return (
    <Modal open={!!target} onClose={onClose} title="Terima pembayaran" description={target?.name}
      footer={<><Button variant="secondary" onClick={onClose}>Batal</Button><Button icon={CheckCircle2} loading={pay.isPending} onClick={() => pay.mutate()}>Tandai lunas</Button></>}>
      {target && (
        <div className="space-y-5">
          <div className="rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-600 p-5 text-white">
            <p className="text-sm text-white/80">{target.period ? `Tagihan ${periodLabel(target.period)}` : 'Tagihan berikutnya'}</p>
            <p className="mt-1 text-3xl font-extrabold">{rupiah(target.amount)}</p>
          </div>
          <Field label="Dibayar lewat">
            <div className="flex flex-wrap gap-2">
              {[['tunai', 'Tunai'], ['transfer', 'Transfer bank'], ['qris', 'QRIS / e-wallet'], ['lainnya', 'Lainnya']].map(([k, l]) => (
                <button key={k} type="button" onClick={() => setMethod(k)} className={clsx('chip', method === k && 'chip-active')}>{l}</button>
              ))}
            </div>
          </Field>
          <Tip>Jika pelanggan sedang diisolir, internetnya <b>otomatis aktif kembali</b> setelah ditandai lunas.</Tip>
        </div>
      )}
    </Modal>
  );
}

// ---------- Form pelanggan ----------
type CForm = {
  id?: number; routerId: number | ''; planId: number | ''; name: string; phone: string; address: string; username: string; password: string;
  dueDate: string; graceDays: string; autoIsolate: boolean; note: string; payNow: boolean;
};

function CustomerForm({ initial, onClose }: { initial: CForm | null; onClose: () => void }) {
  const invalidate = useInvalidate();
  const routers = useRouters();
  const plans = usePppPlans();
  const [f, setF] = useState<CForm | null>(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [lastInitial, setLastInitial] = useState(initial);
  if (initial !== lastInitial) { setLastInitial(initial); setF(initial); setErrors({}); }
  const activePlans = (plans.data ?? []).filter((p) => p.active);
  const set = <K extends keyof CForm>(k: K, v: CForm[K]) => setF((x) => (x ? { ...x, [k]: v } : x));

  const save = useMutation({
    mutationFn: async (v: CForm) => {
      const body = {
        routerId: v.routerId || routers.data?.[0]?.id, planId: v.planId || activePlans[0]?.id, name: v.name, phone: v.phone || null,
        address: v.address || null, username: v.username, password: v.password || undefined, graceDays: Number(v.graceDays || 0),
        autoIsolate: v.autoIsolate, note: v.note || null, nextDueAt: v.payNow ? Date.now() : fromInput(v.dueDate),
      };
      if (v.id) return api<{ id: number }>(`/customers/${v.id}`, { method: 'PUT', json: body });
      const c = await api<{ id: number }>('/customers', { method: 'POST', json: body });
      if (v.payNow) await api(`/customers/${c.id}/pay`, { method: 'POST', json: { method: 'tunai' } });
      return c;
    },
    onSuccess: () => { toast.success('Data pelanggan tersimpan'); invalidate(); onClose(); },
    onError: (e) => { if (e instanceof ApiError && e.fields) setErrors(e.fields); toast.error(e.message); },
  });

  if (!f) return null;
  const noSetup = !routers.data?.length ? 'router' : !activePlans.length ? 'paket' : null;
  const suggestUser = (name: string) => name.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 20);

  return (
    <Modal open onClose={onClose} size="lg" title={f.id ? 'Ubah pelanggan' : 'Pelanggan baru'} description={f.id ? undefined : 'Akun PPPoE langsung dibuat di router.'}
      footer={!noSetup && <><Button variant="secondary" onClick={onClose}>Batal</Button><Button loading={save.isPending} onClick={() => save.mutate(f)}>Simpan</Button></>}>
      {noSetup ? (
        <EmptyState icon={noSetup === 'router' ? Users : PackageIcon} title={noSetup === 'router' ? 'Hubungkan router dulu' : 'Buat paket PPPoE dulu'}
          description={noSetup === 'router' ? 'Akun PPPoE dibuat di router MikroTik.' : 'Buka tab “Paket PPPoE” dan buat paket bulanan, misalnya 10 Mbps Rp150.000.'}
          action={noSetup === 'router' ? <Link to="/router"><Button>Ke halaman Router</Button></Link> : <Button onClick={onClose}>Mengerti</Button>} />
      ) : (
        <div className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Nama pelanggan" error={errors.name}>
              <Input value={f.name} autoFocus onChange={(e) => { const name = e.target.value; setF((x) => x && ({ ...x, name, username: x.id || (x.username && x.username !== suggestUser(x.name)) ? x.username : suggestUser(name) })); }} placeholder="Pak Budi" />
            </Field>
            <Field label="No. WhatsApp" hint="Untuk kirim pengingat tagihan."><Input value={f.phone} inputMode="tel" onChange={(e) => set('phone', e.target.value)} placeholder="0812xxxx" /></Field>
          </div>
          <Field label="Alamat / lokasi"><Input value={f.address} onChange={(e) => set('address', e.target.value)} placeholder="Jl. Melati No. 3, RT 02" /></Field>

          <Field label="Paket langganan">
            <div className="grid gap-2 sm:grid-cols-2">
              {activePlans.map((p) => {
                const sel = (f.planId || activePlans[0]?.id) === p.id;
                return (
                  <button key={p.id} type="button" onClick={() => set('planId', p.id)}
                    className={clsx('flex items-center gap-3 rounded-xl border p-3 text-left transition', sel ? 'border-brand-600 bg-brand-500/5 ring-2 ring-brand-500/20' : 'hover:bg-[var(--surface-2)]')}>
                    <span className="h-10 w-1.5 rounded-full" style={{ background: p.color }} />
                    <span className="min-w-0 flex-1"><span className="block truncate font-semibold">{p.name}</span><span className="block text-xs text-muted">{speed(p.rateDown)}</span></span>
                    <span className="text-right font-bold">{rupiahShort(p.price)}<span className="block text-[11px] font-normal text-muted">/bulan</span></span>
                  </button>
                );
              })}
            </div>
          </Field>

          {(routers.data?.length ?? 0) > 1 && !f.id && (
            <Field label="Router">
              <Select value={f.routerId || routers.data![0].id} onChange={(e) => set('routerId', Number(e.target.value))}>
                {routers.data!.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
              </Select>
            </Field>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Username PPPoE" error={errors.username} hint="Diketik di router/modem pelanggan.">
              <Input value={f.username} onChange={(e) => set('username', e.target.value.replace(/\s/g, ''))} placeholder="budi-rumah" />
            </Field>
            <Field label="Password PPPoE" error={errors.password} hint={f.id ? 'Kosongkan jika tidak diganti.' : undefined}>
              <div className="flex gap-2">
                <Input value={f.password} onChange={(e) => set('password', e.target.value)} placeholder={f.id ? '••••••' : ''} />
                <Button type="button" variant="secondary" icon={Dices} onClick={() => set('password', randomPass())} title="Buat acak" />
              </div>
            </Field>
          </div>

          {!f.id && <Toggle checked={f.payNow} onChange={(v) => set('payNow', v)} label="Bayar bulan pertama sekarang" description="Pembayaran langsung dicatat. Tagihan berikutnya 1 bulan dari hari ini." />}
          {(!f.payNow || f.id) && (
            <Field label="Jatuh tempo berikutnya" hint="Tagihan dibuat otomatis 7 hari sebelumnya, lalu berulang tiap bulan di tanggal yang sama.">
              <Input type="date" value={f.dueDate} onChange={(e) => set('dueDate', e.target.value)} />
            </Field>
          )}

          <div className="grid gap-4 sm:grid-cols-[1fr_180px]">
            <Toggle checked={f.autoIsolate} onChange={(v) => set('autoIsolate', v)} label="Isolir otomatis jika telat bayar" description="Internet diblokir setelah lewat masa toleransi, dan aktif lagi otomatis saat lunas." />
            <Field label="Toleransi (hari)"><Input type="number" min={0} max={30} value={f.graceDays} onChange={(e) => set('graceDays', e.target.value)} /></Field>
          </div>
          <Field label="Catatan"><Input value={f.note} onChange={(e) => set('note', e.target.value)} placeholder="Opsional" /></Field>
        </div>
      )}
    </Modal>
  );
}

// ---------- Detail pelanggan ----------
function CustomerDetailModal({ id, onClose, onEdit, onPay }: {
  id: number | null; onClose: () => void; onEdit: (c: CustomerDetail) => void; onPay: (t: { customerId: number; name: string; amount: number; period?: string; invoiceId?: number }) => void;
}) {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const invalidate = useInvalidate();
  const settings = useSettings();
  const [showPass, setShowPass] = useState(false);
  const q = useQuery({ queryKey: ['customer', id], queryFn: () => api<CustomerDetail>(`/customers/${id}`), enabled: !!id });
  const act = useMutation({
    mutationFn: ({ path, method = 'POST' }: { path: string; method?: string }) => api(path, { method }),
    onSuccess: (_d, v) => { invalidate(); if (v.method === 'DELETE') { toast.success('Pelanggan dihapus'); onClose(); } else toast.success('Berhasil diperbarui'); },
    onError: (e) => toast.error(e.message),
  });
  const c = q.data;
  const unpaid = c?.invoices.filter((i) => i.status === 'unpaid') ?? [];

  const reminder = (inv?: Invoice) => {
    if (!c?.phone) return;
    const biz = settings.data?.businessName ?? 'kami';
    const msg = inv
      ? `Halo ${c.name}, kami dari ${biz} ingin mengingatkan tagihan internet periode ${periodLabel(inv.period)} sebesar ${rupiah(inv.amount)} dengan jatuh tempo ${dateOnly(inv.dueAt)}. Terima kasih 🙏`
      : `Halo ${c.name}, terima kasih telah berlangganan internet di ${biz} 🙏`;
    window.open(waLink(c.phone, msg), '_blank');
  };

  return (
    <Modal open={!!id} onClose={onClose} size="lg" title={c?.name ?? 'Memuat…'} description={c && `@${c.username} • ${c.plan?.name}`}>
      {!c ? <Skeleton className="h-64" /> : (
        <div className="space-y-6">
          {c.syncError && <div className="flex gap-2 rounded-xl border border-rose-500/30 bg-rose-500/5 p-3 text-sm text-rose-700 dark:text-rose-400"><AlertTriangle className="size-4 shrink-0" />{c.syncError}</div>}
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-xl bg-[var(--surface-2)] p-3.5"><p className="text-xs text-muted">Status</p><div className="mt-1.5"><StatusBadge c={{ status: c.status, billing: unpaid.some((i) => i.dueAt < Date.now()) ? 'overdue' : unpaid.length ? 'unpaid' : 'paid' }} /></div></div>
            <div className="rounded-xl bg-[var(--surface-2)] p-3.5"><p className="text-xs text-muted">Jatuh tempo berikutnya</p><p className="mt-1 font-bold">{dateOnly(c.nextDueAt)}</p></div>
            <div className="rounded-xl bg-[var(--surface-2)] p-3.5"><p className="text-xs text-muted">Tunggakan</p><p className={clsx('mt-1 font-bold', unpaid.length && 'text-rose-600')}>{rupiah(unpaid.reduce((a, b) => a + b.amount, 0))}</p></div>
          </div>

          <ul className="grid gap-3 text-sm sm:grid-cols-2">
            <li className="flex items-center gap-2"><Phone className="size-4 text-muted" />{c.phone || <span className="text-muted">Tidak ada nomor</span>}</li>
            <li className="flex items-center gap-2"><MapPin className="size-4 text-muted" />{c.address || <span className="text-muted">—</span>}</li>
            <li className="flex items-center gap-2"><Gauge className="size-4 text-muted" />{speed(c.plan.rateDown)} • {rupiah(c.plan.price)}/bulan</li>
            {isAdmin && (
              <li className="flex items-center gap-2"><KeyRound className="size-4 text-muted" />
                <span className="font-mono">{showPass ? c.password : '••••••'}</span>
                <button onClick={() => setShowPass((s) => !s)} className="text-muted hover:text-[var(--text)]">{showPass ? <EyeOff className="size-4" /> : <Eye className="size-4" />}</button>
              </li>
            )}
          </ul>

          <div className="flex flex-wrap gap-2">
            <Button icon={Wallet} onClick={() => onPay({ customerId: c.id, name: c.name, amount: unpaid[unpaid.length - 1]?.amount ?? c.plan.price, period: unpaid[unpaid.length - 1]?.period })}>
              {unpaid.length ? 'Terima pembayaran' : 'Bayar di muka'}
            </Button>
            {c.phone && <Button variant="secondary" icon={MessageCircle} onClick={() => reminder(unpaid[unpaid.length - 1])}>{unpaid.length ? 'Ingatkan via WA' : 'Chat WA'}</Button>}
            {isAdmin && <>
              <Button variant="secondary" icon={Pencil} onClick={() => onEdit(c)}>Ubah</Button>
              {c.status === 'active' && <Button variant="secondary" icon={Lock} loading={act.isPending} onClick={() => confirm(`Isolir ${c.name} sekarang? Internetnya akan diblokir.`) && act.mutate({ path: `/customers/${c.id}/isolate` })}>Isolir</Button>}
              {c.status !== 'active' && <Button variant="secondary" icon={Unlock} loading={act.isPending} onClick={() => act.mutate({ path: `/customers/${c.id}/activate` })}>{c.status === 'isolated' ? 'Buka isolir' : 'Aktifkan lagi'}</Button>}
              {c.status !== 'disabled' && <Button variant="ghost" icon={Power} onClick={() => confirm(`${c.name} berhenti berlangganan? Akun dinonaktifkan di router dan tidak ditagih lagi.`) && act.mutate({ path: `/customers/${c.id}/disable` })}>Berhenti</Button>}
              <Button variant="ghost" icon={Trash2} className="text-rose-600" onClick={() => confirm(`Hapus ${c.name} beserta akun PPPoE-nya di router?`) && act.mutate({ path: `/customers/${c.id}?router=1`, method: 'DELETE' })}>Hapus</Button>
            </>}
          </div>

          <div>
            <h3 className="mb-2 font-bold">Riwayat tagihan</h3>
            {c.invoices.length === 0 ? <p className="rounded-xl bg-[var(--surface-2)] p-4 text-sm text-muted">Belum ada tagihan. Tagihan dibuat otomatis 7 hari sebelum jatuh tempo.</p> : (
              <ul className="divide-y rounded-xl border">
                {c.invoices.map((i) => (
                  <li key={i.id} className="flex flex-wrap items-center gap-3 p-3">
                    <div className="flex-1">
                      <p className="font-semibold">{periodLabel(i.period)}</p>
                      <p className="text-xs text-muted">Jatuh tempo {dateOnly(i.dueAt)}{i.paidAt && ` • dibayar ${dateOnly(i.paidAt)} (${i.method})`}</p>
                    </div>
                    <span className="font-bold">{rupiah(i.amount)}</span>
                    {i.status === 'paid' ? <Badge tone="green">Lunas</Badge> : i.status === 'void' ? <Badge>Dibatalkan</Badge> : (
                      <div className="flex gap-1">
                        <Button size="sm" onClick={() => onPay({ customerId: c.id, name: c.name, amount: i.amount, period: i.period, invoiceId: i.id })}>Bayar</Button>
                        {isAdmin && <Button size="sm" variant="ghost" onClick={() => confirm('Batalkan tagihan ini (misal digratiskan)?') && act.mutate({ path: `/invoices/${i.id}/void` })}>Batalkan</Button>}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}

// ---------- Impor ----------
function ImportModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const invalidate = useInvalidate();
  const routers = useRouters();
  const plans = usePppPlans();
  const activePlans = (plans.data ?? []).filter((p) => p.active);
  const [rid, setRid] = useState<number | ''>('');
  const routerId = rid || routers.data?.[0]?.id;
  const [rows, setRows] = useState<Record<string, { checked: boolean; name: string; planId: number | '' }>>({});
  const [due, setDue] = useState(toInput(addMonth(Date.now())));
  const list = useQuery({
    queryKey: ['importable', routerId], enabled: open && !!routerId,
    queryFn: () => api<{ name: string; profile: string; comment: string; disabled: boolean }[]>(`/routers/${routerId}/ppp/importable`),
  });
  const imp = useMutation({
    mutationFn: () => api<{ imported: number }>(`/routers/${routerId}/ppp/import`, {
      method: 'POST',
      json: {
        items: (list.data ?? []).filter((s) => rows[s.name]?.checked !== false).map((s) => ({
          username: s.name, name: rows[s.name]?.name ?? (s.comment || s.name), planId: rows[s.name]?.planId || activePlans[0]?.id, nextDueAt: fromInput(due),
        })),
      },
    }),
    onSuccess: (r) => { toast.success(`${r.imported} pelanggan berhasil diimpor`); invalidate(); onClose(); },
    onError: (e) => toast.error(e.message),
  });
  const upd = (name: string, patch: Partial<{ checked: boolean; name: string; planId: number | '' }>, def: string) =>
    setRows((r) => {
      const base: { checked: boolean; name: string; planId: number | '' } = { checked: true, name: def, planId: '' };
      return { ...r, [name]: Object.assign(base, r[name], patch) };
    });
  const selectedCount = (list.data ?? []).filter((s) => rows[s.name]?.checked !== false).length;

  return (
    <Modal open={open} onClose={onClose} size="xl" title="Impor pelanggan dari router" description="Akun PPPoE yang sudah ada di MikroTik dimasukkan ke Wifinate tanpa perlu ketik ulang."
      footer={<><Button variant="secondary" onClick={onClose}>Batal</Button><Button icon={Download} loading={imp.isPending} disabled={!selectedCount || !activePlans.length} onClick={() => imp.mutate()}>Impor {selectedCount} pelanggan</Button></>}>
      <div className="space-y-4">
        {!activePlans.length && <Tip>Buat <b>paket PPPoE</b> terlebih dahulu supaya pelanggan bisa dipasangkan ke paket.</Tip>}
        <div className="grid gap-4 sm:grid-cols-2">
          {(routers.data?.length ?? 0) > 1 && (
            <Field label="Router"><Select value={routerId} onChange={(e) => setRid(Number(e.target.value))}>{routers.data!.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</Select></Field>
          )}
          <Field label="Jatuh tempo pertama (semua)" hint="Bisa diubah per pelanggan nanti."><Input type="date" value={due} onChange={(e) => setDue(e.target.value)} /></Field>
        </div>
        {list.isLoading ? <Skeleton className="h-40" /> : list.isError ? <p className="text-sm text-rose-600">{(list.error as Error).message}</p> : !list.data?.length ? (
          <p className="rounded-xl bg-[var(--surface-2)] p-6 text-center text-sm text-muted">Semua akun PPPoE di router ini sudah ada di Wifinate.</p>
        ) : (
          <div className="overflow-x-auto rounded-xl border">
            <table className="table-base">
              <thead><tr><th></th><th>Username</th><th>Nama pelanggan</th><th>Profil lama</th><th>Paket Wifinate</th></tr></thead>
              <tbody>
                {list.data.map((s) => {
                  const r = rows[s.name];
                  const def = s.comment || s.name;
                  return (
                    <tr key={s.name}>
                      <td><input type="checkbox" className="size-4 accent-brand-600" checked={r?.checked !== false} onChange={(e) => upd(s.name, { checked: e.target.checked }, def)} /></td>
                      <td className="font-mono font-semibold">{s.name}{s.disabled && <Badge>nonaktif</Badge>}</td>
                      <td><Input className="h-9 min-w-44 text-sm" value={r?.name ?? def} onChange={(e) => upd(s.name, { name: e.target.value }, def)} /></td>
                      <td className="text-muted">{s.profile}</td>
                      <td>
                        <Select className="h-9 min-w-44 text-sm" value={r?.planId || activePlans[0]?.id || ''} onChange={(e) => upd(s.name, { planId: Number(e.target.value) }, def)}>
                          {activePlans.map((p) => <option key={p.id} value={p.id}>{p.name} — {rupiahShort(p.price)}</option>)}
                        </Select>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Modal>
  );
}

// ---------- Paket PPPoE ----------
function PlansTab() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const qc = useQueryClient();
  const plans = usePppPlans();
  const [form, setForm] = useState<Partial<PppPlan> & { priceStr?: string } | null>(null);
  const save = useMutation({
    mutationFn: (f: NonNullable<typeof form>) => {
      const body = { name: f.name, price: Number(f.priceStr || 0), rateDown: f.rateDown || null, rateUp: f.rateUp || null, color: f.color };
      return f.id ? api<{ warning?: string }>(`/ppp-plans/${f.id}`, { method: 'PUT', json: body }) : api<{ warning?: string }>('/ppp-plans', { method: 'POST', json: body });
    },
    onSuccess: (r) => { toast.success('Paket tersimpan'); if (r.warning) toast.warning(r.warning); setForm(null); qc.invalidateQueries({ queryKey: ['ppp-plans'] }); },
    onError: (e) => toast.error(e.message),
  });
  const del = useMutation({
    mutationFn: (id: number) => api<{ message?: string }>(`/ppp-plans/${id}`, { method: 'DELETE' }),
    onSuccess: (r) => { toast.success(r.message ?? 'Paket dihapus'); qc.invalidateQueries({ queryKey: ['ppp-plans'] }); },
  });
  const list = (plans.data ?? []).filter((p) => p.active);
  const set = (patch: Partial<NonNullable<typeof form>>) => setForm((f) => (f ? { ...f, ...patch } : f));

  return (
    <>
      {isAdmin && <div className="mb-4 flex justify-end"><Button icon={Plus} onClick={() => setForm({ color: COLORS[list.length % COLORS.length], rateDown: '10M', rateUp: '5M', priceStr: '' })}>Paket baru</Button></div>}
      {plans.isLoading ? <Skeleton className="h-40" /> : !list.length ? (
        <div className="card"><EmptyState icon={PackageIcon} title="Belum ada paket PPPoE" description="Contoh: “Rumahan 10 Mbps — Rp150.000/bulan”."
          action={isAdmin && <Button icon={Plus} onClick={() => setForm({ color: COLORS[0], rateDown: '10M', rateUp: '5M', priceStr: '' })}>Buat paket</Button>} /></div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {list.map((p) => (
            <div key={p.id} className="card group overflow-hidden">
              <div className="h-1.5" style={{ background: p.color }} />
              <div className="p-5">
                <div className="flex items-start justify-between">
                  <div>
                    <h3 className="text-lg font-bold">{p.name}</h3>
                    <p className="mt-1 text-2xl font-extrabold" style={{ color: p.color }}>{rupiah(p.price)}<span className="text-sm font-medium text-muted">/bulan</span></p>
                  </div>
                  {isAdmin && (
                    <div className="flex gap-1 sm:opacity-0 sm:group-hover:opacity-100">
                      <button className="rounded-lg p-2 text-muted hover:bg-[var(--surface-2)]" onClick={() => setForm({ ...p, priceStr: String(p.price) })}><Pencil className="size-4" /></button>
                      <button className="rounded-lg p-2 text-muted hover:text-rose-600" onClick={() => confirm(`Hapus paket ${p.name}?`) && del.mutate(p.id)}><Trash2 className="size-4" /></button>
                    </div>
                  )}
                </div>
                <div className="mt-4 flex items-center gap-4 text-sm">
                  <span className="flex items-center gap-1.5"><Gauge className="size-4 text-muted" />↓ {speed(p.rateDown)} / ↑ {speed(p.rateUp)}</span>
                </div>
                <div className="mt-4 border-t pt-4"><Badge tone="blue">{p.customers} pelanggan</Badge></div>
              </div>
            </div>
          ))}
        </div>
      )}
      <Modal open={!!form} onClose={() => setForm(null)} title={form?.id ? 'Ubah paket PPPoE' : 'Paket PPPoE baru'}
        footer={<><Button variant="secondary" onClick={() => setForm(null)}>Batal</Button><Button loading={save.isPending} onClick={() => form && save.mutate(form)}>Simpan</Button></>}>
        {form && (
          <div className="space-y-4">
            <Field label="Nama paket"><Input autoFocus value={form.name ?? ''} onChange={(e) => set({ name: e.target.value })} placeholder="Rumahan 10 Mbps" /></Field>
            <Field label="Harga per bulan">
              <div className="relative"><span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-sm font-semibold text-muted">Rp</span>
                <Input className="pl-10" inputMode="numeric" value={form.priceStr ?? ''} onChange={(e) => set({ priceStr: e.target.value.replace(/\D/g, '') })} placeholder="150000" /></div>
            </Field>
            <Field label="Kecepatan download">
              <div className="flex flex-wrap gap-2">
                {['5M', '10M', '15M', '20M', '30M', '50M'].map((s) => <button type="button" key={s} onClick={() => set({ rateDown: s, rateUp: `${Math.max(1, Math.round(parseInt(s) / 2))}M` })} className={clsx('chip', form.rateDown === s && 'chip-active')}>{s.replace('M', '')} Mbps</button>)}
              </div>
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Download"><Input value={form.rateDown ?? ''} onChange={(e) => set({ rateDown: e.target.value })} /></Field>
              <Field label="Upload"><Input value={form.rateUp ?? ''} onChange={(e) => set({ rateUp: e.target.value })} /></Field>
            </div>
            <Field label="Warna">
              <div className="flex gap-2">{COLORS.map((c) => <button key={c} type="button" onClick={() => set({ color: c })} className={clsx('size-9 rounded-full ring-offset-2 ring-offset-[var(--surface)]', form.color === c && 'ring-2 ring-[var(--text)]')} style={{ background: c }} />)}</div>
            </Field>
            {form.id && <Tip>Mengubah kecepatan akan langsung memperbarui profil di router untuk semua pelanggan paket ini.</Tip>}
          </div>
        )}
      </Modal>
    </>
  );
}

// ---------- Tagihan ----------
function InvoicesTab({ onPay }: { onPay: (t: { customerId: number; name: string; amount: number; period?: string; invoiceId?: number }) => void }) {
  const settings = useSettings();
  const [status, setStatus] = useState<'unpaid' | 'paid'>('unpaid');
  const q = useQuery({ queryKey: ['invoices', status], queryFn: () => api<InvoiceRow[]>(`/invoices?status=${status}`) });
  const total = (q.data ?? []).reduce((a, b) => a + b.amount, 0);
  return (
    <div className="card overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b p-4">
        <div className="flex gap-2">
          {[['unpaid', 'Belum dibayar'], ['paid', 'Sudah dibayar']].map(([k, l]) => <button key={k} onClick={() => setStatus(k as 'unpaid' | 'paid')} className={clsx('chip h-8', status === k && 'chip-active')}>{l}</button>)}
        </div>
        <p className="text-sm">Total <b>{rupiah(total)}</b> dari {num(q.data?.length ?? 0)} tagihan</p>
      </div>
      <div className="overflow-x-auto">
        <table className="table-base">
          <thead><tr><th>Pelanggan</th><th>Periode</th><th>{status === 'paid' ? 'Dibayar' : 'Jatuh tempo'}</th><th className="text-right">Nominal</th><th></th></tr></thead>
          <tbody>
            {q.data?.map((i) => {
              const late = status === 'unpaid' && i.dueAt < Date.now();
              return (
                <tr key={i.id}>
                  <td><p className="font-semibold">{i.customerName}</p><p className="flex items-center gap-1.5 text-xs text-muted"><span className="size-1.5 rounded-full" style={{ background: i.planColor }} />{i.planName}{i.customerStatus === 'isolated' && <Badge tone="red">Terisolir</Badge>}</p></td>
                  <td>{periodLabel(i.period)}</td>
                  <td className={clsx(late ? 'font-semibold text-rose-600' : 'text-muted')}>{status === 'paid' ? `${dateOnly(i.paidAt!)} • ${i.method}` : `${dateOnly(i.dueAt)}${late ? ` (telat ${Math.ceil((Date.now() - i.dueAt) / DAY)} hari)` : ''}`}</td>
                  <td className="text-right font-bold">{rupiah(i.amount)}</td>
                  <td className="text-right">
                    {status === 'unpaid' && (
                      <div className="flex justify-end gap-1">
                        {i.phone && (
                          <a href={waLink(i.phone, `Halo ${i.customerName}, kami dari ${settings.data?.businessName ?? 'kami'} ingin mengingatkan tagihan internet periode ${periodLabel(i.period)} sebesar ${rupiah(i.amount)} dengan jatuh tempo ${dateOnly(i.dueAt)}. Terima kasih 🙏`)} target="_blank" rel="noreferrer">
                            <Button size="sm" variant="ghost" icon={MessageCircle} title="Ingatkan via WhatsApp" />
                          </a>
                        )}
                        <Button size="sm" onClick={() => onPay({ customerId: i.customerId, name: i.customerName, amount: i.amount, period: i.period, invoiceId: i.id })}>Bayar</Button>
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!q.isLoading && !q.data?.length && <p className="py-12 text-center text-sm text-muted">{status === 'unpaid' ? 'Tidak ada tagihan tertunggak. Mantap! 🎉' : 'Belum ada pembayaran.'}</p>}
      </div>
    </div>
  );
}

// ---------- Halaman ----------
export default function Customers() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const [tab, setTab] = useState<'customers' | 'invoices' | 'plans'>('customers');
  const [filter, setFilter] = useState<'' | 'overdue' | 'unpaid' | 'paid' | 'isolated' | 'disabled'>('');
  const [search, setSearch] = useState('');
  const [form, setForm] = useState<CForm | null>(null);
  const [detail, setDetail] = useState<number | null>(null);
  const [pay, setPay] = useState<{ customerId: number; name: string; amount: number; period?: string; invoiceId?: number } | null>(null);
  const [importing, setImporting] = useState(false);

  const summary = useQuery({ queryKey: ['customer-summary'], queryFn: () => api<CustomerSummary>('/customers/summary'), refetchInterval: 60_000 });
  const params = new URLSearchParams();
  if (filter === 'isolated' || filter === 'disabled') params.set('status', filter);
  else if (filter) params.set('billing', filter);
  if (search) params.set('search', search);
  const customers = useQuery({ queryKey: ['customers', params.toString()], queryFn: () => api<Customer[]>(`/customers?${params}`), enabled: tab === 'customers', refetchInterval: 60_000 });
  const list = useMemo(() => (filter === '' ? (customers.data ?? []).filter((c) => c.status !== 'disabled') : customers.data ?? []), [customers.data, filter]);

  const newForm = (): CForm => ({
    routerId: '', planId: '', name: '', phone: '', address: '', username: '', password: randomPass(),
    dueDate: toInput(addMonth(Date.now())), graceDays: '3', autoIsolate: true, note: '', payNow: true,
  });
  const editForm = (c: CustomerDetail): CForm => ({
    id: c.id, routerId: c.routerId, planId: c.planId, name: c.name, phone: c.phone ?? '', address: c.address ?? '', username: c.username,
    password: '', dueDate: toInput(c.nextDueAt), graceDays: String(c.graceDays), autoIsolate: c.autoIsolate, note: c.note ?? '', payNow: false,
  });

  const s = summary.data;
  const filters: { key: typeof filter; label: string; count?: number }[] = [
    { key: '', label: 'Semua' }, { key: 'overdue', label: 'Telat bayar', count: s?.overdue.n }, { key: 'unpaid', label: 'Ada tagihan' },
    { key: 'paid', label: 'Lunas' }, { key: 'isolated', label: 'Terisolir', count: s?.status.isolated }, { key: 'disabled', label: 'Berhenti' },
  ];

  return (
    <>
      <PageHeader title="Pelanggan PPPoE" description="Pelanggan bulanan: tagihan dibuat otomatis, isolir otomatis saat telat bayar, aktif lagi saat lunas."
        actions={isAdmin && <>
          <Button variant="secondary" icon={Download} onClick={() => setImporting(true)}>Impor dari router</Button>
          <Button icon={Plus} onClick={() => setForm(newForm())}>Pelanggan baru</Button>
        </>} />

      <div className="mb-6 grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        <StatCard label="Pelanggan aktif" value={num(s?.status.active ?? 0)} icon={Users} tone="green" sub={`${s?.dueSoon ?? 0} jatuh tempo minggu ini`} />
        <StatCard label="Terisolir" value={num(s?.status.isolated ?? 0)} icon={ShieldAlert} tone="rose" sub="internet diblokir" />
        <StatCard label="Tunggakan" value={rupiah(s?.overdue.total ?? 0)} icon={AlertTriangle} tone="amber" sub={`${s?.overdue.n ?? 0} pelanggan telat`} />
        <StatCard label="Terkumpul bulan ini" value={rupiah(s?.collected.total ?? 0)} icon={Receipt} sub={`Potensi ${rupiahShort(s?.mrr ?? 0)}/bulan`} />
      </div>

      <div className="mb-4 inline-flex rounded-xl border bg-[var(--surface)] p-1">
        {([['customers', 'Pelanggan'], ['invoices', 'Tagihan'], ['plans', 'Paket PPPoE']] as const).map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)} className={clsx('rounded-lg px-4 py-2 text-sm font-semibold transition', tab === k ? 'bg-brand-600 text-white shadow' : 'text-muted hover:text-[var(--text)]')}>{l}</button>
        ))}
      </div>

      {tab === 'plans' ? <PlansTab /> : tab === 'invoices' ? <InvoicesTab onPay={setPay} /> : (
        <div className="card overflow-hidden">
          <div className="flex flex-col gap-3 border-b p-4 lg:flex-row lg:items-center">
            <div className="-mx-1 flex gap-2 overflow-x-auto px-1 lg:flex-wrap">
              {filters.map((f) => (
                <button key={f.key} onClick={() => setFilter(f.key)} className={clsx('chip h-8 shrink-0', filter === f.key && 'chip-active')}>
                  {f.label}{!!f.count && <span className={clsx('rounded-full px-1.5 text-xs', filter === f.key ? 'bg-white/20' : 'bg-rose-500/10 text-rose-600')}>{f.count}</span>}
                </button>
              ))}
            </div>
            <div className="relative lg:ml-auto lg:w-72">
              <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
              <Input className="h-9 pl-9 text-sm" placeholder="Cari nama, username, HP, alamat" value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
          </div>

          {customers.isLoading ? <div className="p-5"><Skeleton className="h-48" /></div> : !list.length ? (
            search || filter ? <p className="py-14 text-center text-sm text-muted">Tidak ada pelanggan yang cocok.</p> : (
              <EmptyState icon={Users} title="Belum ada pelanggan PPPoE" description="Tambahkan pelanggan baru, atau impor akun PPPoE yang sudah ada di router Anda."
                action={isAdmin && <div className="flex gap-2"><Button variant="secondary" icon={Download} onClick={() => setImporting(true)}>Impor</Button><Button icon={Plus} onClick={() => setForm(newForm())}>Pelanggan baru</Button></div>} />
            )
          ) : (
            <ul className="divide-y">
              {list.map((c) => {
                const due = dueText(c);
                return (
                  <li key={c.id} className="flex cursor-pointer flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3.5 transition hover:bg-[var(--surface-2)] sm:px-5" onClick={() => setDetail(c.id)}>
                    <span className="grid size-10 shrink-0 place-items-center rounded-full font-bold text-white" style={{ background: c.planColor }}>{c.name[0]?.toUpperCase()}</span>
                    <div className="min-w-0 flex-1 basis-40">
                      <p className="truncate font-semibold">{c.name} {c.syncError && <AlertTriangle className="inline size-4 text-rose-500" />}</p>
                      <p className="truncate text-xs text-muted">@{c.username} • {c.planName}{c.address ? ` • ${c.address}` : ''}</p>
                    </div>
                    <div className="hidden w-36 text-sm sm:block">
                      <p className="flex items-center gap-1.5 text-xs text-muted"><CalendarClock className="size-3.5" />Jatuh tempo</p>
                      <p className={clsx('font-semibold', due.tone)}>{due.text}</p>
                    </div>
                    <div className="w-28 text-right">
                      <StatusBadge c={c} />
                      {c.unpaidTotal > 0 && <p className="mt-1 text-xs font-semibold text-rose-600">{rupiah(c.unpaidTotal)}</p>}
                    </div>
                    <div onClick={(e) => e.stopPropagation()}>
                      {c.status !== 'disabled' && (
                        <Button size="sm" variant={c.unpaidTotal ? 'primary' : 'secondary'} icon={Wallet}
                          onClick={() => setPay({ customerId: c.id, name: c.name, amount: c.unpaidCount ? c.unpaidTotal / c.unpaidCount : c.planPrice })}>Bayar</Button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}

      {form && <CustomerForm initial={form} onClose={() => setForm(null)} />}
      <CustomerDetailModal id={detail} onClose={() => setDetail(null)} onEdit={(c) => { setDetail(null); setForm(editForm(c)); }} onPay={(t) => setPay(t)} />
      <PayModal target={pay} onClose={() => setPay(null)} />
      <ImportModal open={importing} onClose={() => setImporting(false)} />
    </>
  );
}
