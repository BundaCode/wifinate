import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import clsx from 'clsx';
import { Plus, Store, Wallet, History, Pencil, MessageCircle, PlusCircle } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { useSettings } from '@/lib/queries';
import { dateTime, num, rupiah, waNumber } from '@/lib/format';
import type { LedgerEntry, Reseller } from '@/lib/types';
import { Badge, Button, EmptyState, Field, Input, Modal, PageHeader, Skeleton, StatCard, Tip, Toggle } from '@/components/ui';

const LEDGER_LABEL = { topup: 'Isi saldo', purchase: 'Beli voucher', refund: 'Pengembalian', adjust: 'Koreksi' } as const;
const QUICK = [50_000, 100_000, 250_000, 500_000, 1_000_000];

function TopupModal({ r, onClose }: { r: Reseller; onClose: () => void }) {
  const qc = useQueryClient();
  const settings = useSettings();
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [adjust, setAdjust] = useState(false);
  const save = useMutation({
    mutationFn: () => api<{ balance: number }>(`/resellers/${r.id}/topup`, { method: 'POST', json: { amount: Number(amount) * (adjust ? -1 : 1), type: adjust ? 'adjust' : 'topup', note: note || undefined } }),
    onSuccess: (res) => {
      toast.success(`Saldo ${r.name} sekarang ${rupiah(res.balance)}`);
      qc.invalidateQueries({ queryKey: ['resellers'] });
      if (r.phone && !adjust && confirm('Kirim konfirmasi ke reseller lewat WhatsApp?')) {
        window.open(`https://wa.me/${waNumber(r.phone)}?text=${encodeURIComponent(`Halo ${r.name}, saldo reseller ${settings.data?.businessName ?? ''} sudah ditambah ${rupiah(Number(amount))}. Saldo sekarang ${rupiah(res.balance)}. Terima kasih 🙏`)}`, '_blank');
      }
      onClose();
    },
    onError: (e) => toast.error(e.message),
  });
  return (
    <Modal open onClose={onClose} title={adjust ? 'Koreksi saldo' : 'Isi saldo'} description={`${r.name} • saldo sekarang ${rupiah(r.balance)}`}
      footer={<><Button variant="secondary" onClick={onClose}>Batal</Button><Button loading={save.isPending} disabled={!Number(amount)} onClick={() => save.mutate()}>{adjust ? 'Kurangi saldo' : 'Tambah saldo'}</Button></>}>
      <div className="space-y-4">
        <div className="flex flex-wrap gap-2">
          {QUICK.map((q) => <button key={q} type="button" onClick={() => setAmount(String(q))} className={clsx('chip', Number(amount) === q && 'chip-active')}>{rupiah(q)}</button>)}
        </div>
        <Field label="Nominal">
          <div className="relative"><span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-sm font-semibold text-muted">Rp</span>
            <Input className="pl-10" inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value.replace(/\D/g, ''))} autoFocus /></div>
        </Field>
        <Field label="Catatan" hint="Contoh: Transfer BCA, tunai"><Input value={note} onChange={(e) => setNote(e.target.value)} /></Field>
        <Toggle checked={adjust} onChange={setAdjust} label="Koreksi (kurangi saldo)" description="Gunakan jika salah input atau reseller menarik kembali saldonya." />
      </div>
    </Modal>
  );
}

type RForm = { id?: number; name: string; username: string; password: string; phone: string; discountPct: string; initialBalance: string; active: boolean };

function ResellerForm({ initial, onClose }: { initial: RForm; onClose: () => void }) {
  const qc = useQueryClient();
  const [f, setF] = useState(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const set = <K extends keyof RForm>(k: K, v: RForm[K]) => setF({ ...f, [k]: v });
  const save = useMutation({
    mutationFn: () => f.id
      ? api(`/resellers/${f.id}`, { method: 'PUT', json: { name: f.name, phone: f.phone || null, discountPct: Number(f.discountPct), active: f.active, password: f.password || undefined } })
      : api('/resellers', { method: 'POST', json: { ...f, phone: f.phone || null, discountPct: Number(f.discountPct), initialBalance: Number(f.initialBalance || 0) } }),
    onSuccess: () => { toast.success('Reseller tersimpan'); qc.invalidateQueries({ queryKey: ['resellers'] }); onClose(); },
    onError: (e) => { if (e instanceof ApiError && e.fields) setErrors(e.fields); toast.error(e.message); },
  });
  return (
    <Modal open onClose={onClose} title={f.id ? 'Ubah reseller' : 'Reseller baru'} description={f.id ? undefined : 'Reseller login dengan akun ini untuk membeli voucher dari saldonya.'}
      footer={<><Button variant="secondary" onClick={onClose}>Batal</Button><Button loading={save.isPending} onClick={() => save.mutate()}>Simpan</Button></>}>
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Nama reseller / toko" error={errors.name}><Input value={f.name} autoFocus onChange={(e) => set('name', e.target.value)} placeholder="Warung Bu Sari" /></Field>
          <Field label="No. WhatsApp"><Input value={f.phone} inputMode="tel" onChange={(e) => set('phone', e.target.value)} /></Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Username login" error={errors.username}><Input value={f.username} disabled={!!f.id} onChange={(e) => set('username', e.target.value)} /></Field>
          <Field label="Password" error={errors.password} hint={f.id ? 'Kosongkan jika tidak diganti.' : undefined}><Input value={f.password} onChange={(e) => set('password', e.target.value)} /></Field>
        </div>
        <Field label="Diskon (%)" hint="Reseller membeli voucher seharga harga jual dikurangi diskon ini. Selisihnya jadi untung reseller.">
          <div className="flex flex-wrap items-center gap-2">
            {[5, 10, 15, 20].map((d) => <button key={d} type="button" onClick={() => set('discountPct', String(d))} className={clsx('chip', Number(f.discountPct) === d && 'chip-active')}>{d}%</button>)}
            <Input className="h-9 w-20" inputMode="numeric" value={f.discountPct} onChange={(e) => set('discountPct', e.target.value.replace(/\D/g, ''))} />
          </div>
        </Field>
        {!f.id && <Field label="Saldo awal" hint="Opsional"><Input inputMode="numeric" value={f.initialBalance} onChange={(e) => set('initialBalance', e.target.value.replace(/\D/g, ''))} placeholder="0" /></Field>}
        {f.id && <Toggle checked={f.active} onChange={(v) => set('active', v)} label="Akun aktif" description="Nonaktifkan untuk menghentikan sementara tanpa menghapus riwayat." />}
        {!f.id && <Tip>Contoh: voucher <b>Rp5.000</b> dengan diskon <b>10%</b> → reseller membayar <b>Rp4.500</b> dari saldo, untung Rp500 per voucher.</Tip>}
      </div>
    </Modal>
  );
}

function LedgerModal({ r, onClose }: { r: Reseller; onClose: () => void }) {
  const q = useQuery({ queryKey: ['ledger', r.id], queryFn: () => api<LedgerEntry[]>(`/resellers/${r.id}/ledger`) });
  return (
    <Modal open onClose={onClose} size="lg" title={`Riwayat saldo — ${r.name}`} description={`Saldo sekarang ${rupiah(r.balance)}`}>
      {q.isLoading ? <Skeleton className="h-40" /> : (
        <ul className="divide-y rounded-xl border">
          {q.data?.map((l) => (
            <li key={l.id} className="flex items-center gap-3 p-3">
              <div className="flex-1">
                <p className="text-sm font-semibold">{LEDGER_LABEL[l.type]}{l.note ? <span className="font-normal text-muted"> — {l.note}</span> : ''}</p>
                <p className="text-xs text-muted">{dateTime(l.createdAt)} • saldo {rupiah(l.balanceAfter)}</p>
              </div>
              <span className={clsx('font-bold', l.amount > 0 ? 'text-emerald-600' : '')}>{l.amount > 0 ? '+' : '−'}{rupiah(Math.abs(l.amount))}</span>
            </li>
          ))}
          {!q.data?.length && <li className="p-6 text-center text-sm text-muted">Belum ada transaksi.</li>}
        </ul>
      )}
    </Modal>
  );
}

export default function Resellers() {
  const list = useQuery({ queryKey: ['resellers'], queryFn: () => api<Reseller[]>('/resellers') });
  const [form, setForm] = useState<RForm | null>(null);
  const [topup, setTopup] = useState<Reseller | null>(null);
  const [ledger, setLedger] = useState<Reseller | null>(null);
  const data = list.data ?? [];
  const totalBalance = data.reduce((a, r) => a + r.balance, 0);
  const spent = data.reduce((a, r) => a + r.stats.spentMonth, 0);
  const newForm: RForm = { name: '', username: '', password: '', phone: '', discountPct: '10', initialBalance: '', active: true };

  return (
    <>
      <PageHeader title="Reseller" description="Mitra yang menjual voucher Anda (warung, konter, dll). Mereka membeli dari saldo deposit dengan harga diskon."
        actions={<Button icon={Plus} onClick={() => setForm(newForm)}>Reseller baru</Button>} />
      <div className="mb-6 grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-3">
        <StatCard label="Reseller aktif" value={num(data.filter((r) => r.active).length)} icon={Store} />
        <StatCard label="Pembelian bulan ini" value={rupiah(spent)} icon={Wallet} tone="green" sub="masuk ke laporan penjualan" />
        <StatCard label="Total saldo reseller" value={rupiah(totalBalance)} icon={Wallet} tone="amber" sub="deposit yang belum dipakai" />
      </div>
      {list.isLoading ? <Skeleton className="h-48" /> : !data.length ? (
        <div className="card"><EmptyState icon={Store} title="Belum ada reseller" description="Tambahkan warung atau konter yang ingin ikut menjual voucher Anda."
          action={<Button icon={Plus} onClick={() => setForm(newForm)}>Reseller baru</Button>} /></div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {data.map((r) => (
            <div key={r.id} className={clsx('card p-5', !r.active && 'opacity-60')}>
              <div className="flex items-start gap-3">
                <span className="grid size-11 place-items-center rounded-full bg-amber-500 font-bold text-white">{r.name[0]?.toUpperCase()}</span>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-bold">{r.name} {!r.active && <Badge>Nonaktif</Badge>}</p>
                  <p className="text-xs text-muted">@{r.username} • diskon {r.discountPct}%</p>
                </div>
                <button className="rounded-lg p-2 text-muted hover:bg-[var(--surface-2)]" onClick={() => setForm({ id: r.id, name: r.name, username: r.username, password: '', phone: r.phone ?? '', discountPct: String(r.discountPct), initialBalance: '', active: r.active })}><Pencil className="size-4" /></button>
              </div>
              <div className="mt-4 rounded-xl bg-[var(--surface-2)] p-4">
                <p className="text-xs text-muted">Saldo</p>
                <p className={clsx('text-2xl font-extrabold', r.balance < 20_000 && 'text-amber-600')}>{rupiah(r.balance)}</p>
              </div>
              <div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs">
                <div><p className="font-bold">{num(r.stats.vouchers)}</p><p className="text-muted">dibeli</p></div>
                <div><p className="font-bold">{num(r.stats.unused)}</p><p className="text-muted">stok</p></div>
                <div><p className="font-bold">{rupiah(r.stats.spentMonth)}</p><p className="text-muted">bulan ini</p></div>
              </div>
              <div className="mt-4 flex flex-wrap gap-2 border-t pt-4">
                <Button size="sm" icon={PlusCircle} onClick={() => setTopup(r)}>Isi saldo</Button>
                <Button size="sm" variant="secondary" icon={History} onClick={() => setLedger(r)}>Riwayat</Button>
                {r.phone && <a href={`https://wa.me/${waNumber(r.phone)}`} target="_blank" rel="noreferrer"><Button size="sm" variant="ghost" icon={MessageCircle} /></a>}
              </div>
            </div>
          ))}
        </div>
      )}
      {form && <ResellerForm initial={form} onClose={() => setForm(null)} />}
      {topup && <TopupModal r={topup} onClose={() => setTopup(null)} />}
      {ledger && <LedgerModal r={ledger} onClose={() => setLedger(null)} />}
    </>
  );
}
