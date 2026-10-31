import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Wallet, Plus, Printer, Ticket, History, BadgePercent, CheckCircle2 } from 'lucide-react';
import clsx from 'clsx';
import { api, openFile } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { usePackages } from '@/lib/queries';
import { dateTime, num, rupiah } from '@/lib/format';
import type { Batch, ResellerMe } from '@/lib/types';
import { Badge, Button, EmptyState, PageHeader, Skeleton, StatCard } from '@/components/ui';
import { GenerateModal } from './Vouchers';

const LEDGER_LABEL = { topup: 'Isi saldo', purchase: 'Beli voucher', refund: 'Pengembalian', adjust: 'Koreksi saldo' } as const;

/** Beranda khusus reseller: saldo, beli voucher, cetak, riwayat. */
export default function ResellerHome() {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const me = useQuery({ queryKey: ['reseller-me'], queryFn: () => api<ResellerMe>('/reseller/me'), refetchInterval: 30_000 });
  const batches = useQuery({ queryKey: ['batches'], queryFn: () => api<Batch[]>('/batches') });
  const packages = usePackages();

  if (!me.data) return <Skeleton className="h-64" />;
  const m = me.data;
  const pk = (packages.data ?? []).filter((p) => p.active);

  return (
    <>
      <PageHeader title={`Halo, ${user?.name} 👋`} description="Beli voucher dari saldo Anda, cetak, lalu jual ke pelanggan."
        actions={<Button icon={Plus} onClick={() => setOpen(true)} disabled={!m.balance}>Beli voucher</Button>} />

      <div className="mb-6 overflow-hidden rounded-3xl bg-gradient-to-br from-brand-600 via-brand-600 to-violet-700 p-6 text-white shadow-xl shadow-brand-600/20 sm:p-8">
        <div className="flex flex-wrap items-end justify-between gap-6">
          <div>
            <p className="flex items-center gap-2 text-sm font-semibold text-white/80"><Wallet className="size-4" />Saldo Anda</p>
            <p className="mt-2 text-4xl font-extrabold tracking-tight sm:text-5xl">{rupiah(m.balance)}</p>
            <p className="mt-2 text-sm text-white/80">Isi saldo dengan menghubungi pemilik usaha.</p>
          </div>
          <div className="rounded-2xl bg-white/15 px-5 py-4 backdrop-blur">
            <p className="flex items-center gap-1.5 text-sm text-white/80"><BadgePercent className="size-4" />Diskon Anda</p>
            <p className="text-3xl font-extrabold">{m.discountPct}%</p>
          </div>
        </div>
      </div>

      <div className="mb-6 grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        <StatCard label="Voucher dibeli" value={num(m.stats.vouchers)} icon={Ticket} />
        <StatCard label="Belum terpakai" value={num(m.stats.unused)} icon={Ticket} tone="sky" sub="stok siap jual" />
        <StatCard label="Sudah dipakai" value={num(m.stats.used)} icon={CheckCircle2} tone="green" />
        <StatCard label="Belanja bulan ini" value={rupiah(m.stats.spentMonth)} icon={Wallet} tone="amber" />
      </div>

      {pk.length > 0 && (
        <div className="card mb-6 p-5">
          <h3 className="mb-3 font-bold">Harga untuk Anda</h3>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {pk.map((p) => {
              const cost = Math.round((p.price * (100 - m.discountPct)) / 100);
              return (
                <div key={p.id} className="flex items-center gap-3 rounded-xl bg-[var(--surface-2)] p-3.5">
                  <span className="h-10 w-1.5 rounded-full" style={{ background: p.color }} />
                  <div className="flex-1">
                    <p className="font-semibold">{p.name}</p>
                    <p className="text-xs text-muted">Jual {rupiah(p.price)} • untung {rupiah(p.price - cost)}/voucher</p>
                  </div>
                  <p className="font-extrabold">{rupiah(cost)}</p>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="grid gap-6 xl:grid-cols-2">
        <div className="card overflow-hidden">
          <h3 className="flex items-center gap-2 border-b px-5 py-4 font-bold"><Printer className="size-4" />Voucher saya</h3>
          {!batches.data?.length ? (
            <EmptyState icon={Ticket} title="Belum ada voucher" description="Klik “Beli voucher”, lalu cetak dan jual ke pelanggan."
              action={<Button icon={Plus} onClick={() => setOpen(true)} disabled={!m.balance}>Beli voucher</Button>} />
          ) : (
            <ul className="divide-y">
              {batches.data.map((b) => (
                <li key={b.id} className="flex items-center gap-3 px-5 py-3.5">
                  <span className="grid size-10 place-items-center rounded-xl text-white" style={{ background: b.color }}><Ticket className="size-5" /></span>
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold">{b.packageName} × {b.count}</p>
                    <p className="text-xs text-muted">{dateTime(b.createdAt)} • {b.unused} belum dipakai</p>
                  </div>
                  <Button size="sm" variant="secondary" icon={Printer} disabled={!b.unused}
                    onClick={() => openFile(`/vouchers/print?batchId=${b.id}`).catch((e) => toast.error(e.message))}>Cetak</Button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="card overflow-hidden">
          <h3 className="flex items-center gap-2 border-b px-5 py-4 font-bold"><History className="size-4" />Riwayat saldo</h3>
          <ul className="divide-y">
            {m.ledger.map((l) => (
              <li key={l.id} className="flex items-center gap-3 px-5 py-3">
                <div className="flex-1">
                  <p className="text-sm font-semibold">{LEDGER_LABEL[l.type]}{l.note ? <span className="font-normal text-muted"> — {l.note}</span> : ''}</p>
                  <p className="text-xs text-muted">{dateTime(l.createdAt)} • saldo {rupiah(l.balanceAfter)}</p>
                </div>
                <span className={clsx('font-bold', l.amount > 0 ? 'text-emerald-600' : 'text-[var(--text)]')}>{l.amount > 0 ? '+' : '−'}{rupiah(Math.abs(l.amount))}</span>
              </li>
            ))}
            {!m.ledger.length && <li className="p-6 text-center text-sm text-muted">Belum ada transaksi.</li>}
          </ul>
        </div>
      </div>

      {m.balance === 0 && <p className="mt-4 text-center"><Badge tone="amber">Saldo Anda habis — hubungi pemilik untuk isi saldo</Badge></p>}
      <GenerateModal open={open} onClose={() => setOpen(false)} reseller={{ balance: m.balance, discountPct: m.discountPct }} />
    </>
  );
}
