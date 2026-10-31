import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Plus, Package as PackageIcon, Clock, Gauge, Users, CalendarClock, Pencil, Trash2, HardDrive } from 'lucide-react';
import clsx from 'clsx';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { usePackages } from '@/lib/queries';
import { humanMinutes, rupiah, speed } from '@/lib/format';
import type { Package } from '@/lib/types';
import { Badge, Button, EmptyState, Field, Input, Modal, PageHeader, Skeleton, Tip } from '@/components/ui';

const COLORS = ['#6366f1', '#0ea5e9', '#22c55e', '#f59e0b', '#ef4444', '#ec4899', '#8b5cf6', '#14b8a6'];

const DURATIONS = [
  { label: '1 jam', min: 60 }, { label: '3 jam', min: 180 }, { label: '6 jam', min: 360 }, { label: '12 jam', min: 720 },
  { label: '1 hari', min: 1440 }, { label: '3 hari', min: 4320 }, { label: '7 hari', min: 10080 }, { label: '30 hari', min: 43200 },
];
const SPEEDS = ['1M', '2M', '3M', '5M', '10M', '20M'];

type Form = {
  id?: number; name: string; price: string; uptimeLimitMin: number | null; validityMin: number | null;
  rateDown: string; rateUp: string; sharedUsers: string; quotaMb: string; color: string;
};

const empty: Form = { name: '', price: '', uptimeLimitMin: null, validityMin: 1440, rateDown: '5M', rateUp: '2M', sharedUsers: '1', quotaMb: '', color: COLORS[0] };

function DurationPicker({ value, onChange, allowNone }: { value: number | null; onChange: (v: number | null) => void; allowNone: string }) {
  const [custom, setCustom] = useState(false);
  const isPreset = value === null || DURATIONS.some((d) => d.min === value);
  return (
    <div>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => { setCustom(false); onChange(null); }} className={clsx('chip', value === null && !custom && 'chip-active')}>{allowNone}</button>
        {DURATIONS.map((d) => (
          <button type="button" key={d.min} onClick={() => { setCustom(false); onChange(d.min); }} className={clsx('chip', value === d.min && !custom && 'chip-active')}>{d.label}</button>
        ))}
        <button type="button" onClick={() => setCustom(true)} className={clsx('chip', (custom || !isPreset) && 'chip-active')}>Lainnya…</button>
      </div>
      {(custom || !isPreset) && (
        <div className="mt-2 flex items-center gap-2">
          <Input type="number" min={1} className="w-32" value={value ?? ''} onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)} placeholder="90" />
          <span className="text-sm text-muted">menit {value ? `(= ${humanMinutes(value)})` : ''}</span>
        </div>
      )}
    </div>
  );
}

export default function Packages() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const qc = useQueryClient();
  const { data, isLoading } = usePackages();
  const [form, setForm] = useState<Form | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const save = useMutation({
    mutationFn: (f: Form) => {
      const body = {
        name: f.name, price: Number(f.price || 0), uptimeLimitMin: f.uptimeLimitMin, validityMin: f.validityMin,
        rateDown: f.rateDown || null, rateUp: f.rateUp || null, sharedUsers: Number(f.sharedUsers || 1),
        quotaMb: f.quotaMb ? Math.round(Number(f.quotaMb) * 1024) : null, color: f.color,
      };
      return f.id ? api(`/packages/${f.id}`, { method: 'PUT', json: body }) : api('/packages', { method: 'POST', json: body });
    },
    onSuccess: () => { toast.success('Paket tersimpan'); setForm(null); qc.invalidateQueries({ queryKey: ['packages'] }); },
    onError: (e) => { if (e instanceof ApiError && e.fields) setErrors(e.fields); toast.error(e.message); },
  });

  const remove = useMutation({
    mutationFn: (id: number) => api<{ message?: string }>(`/packages/${id}`, { method: 'DELETE' }),
    onSuccess: (r) => { toast.success(r.message ?? 'Paket dihapus'); qc.invalidateQueries({ queryKey: ['packages'] }); },
    onError: (e) => toast.error(e.message),
  });

  const edit = (p: Package) => {
    setErrors({});
    setForm({
      id: p.id, name: p.name, price: String(p.price), uptimeLimitMin: p.uptimeLimitMin, validityMin: p.validityMin,
      rateDown: p.rateDown ?? '', rateUp: p.rateUp ?? '', sharedUsers: String(p.sharedUsers),
      quotaMb: p.quotaMb ? String(p.quotaMb / 1024) : '', color: p.color,
    });
  };

  const list = (data ?? []).filter((p) => p.active);
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => (f ? { ...f, [k]: v } : f));

  return (
    <>
      <PageHeader
        title="Paket voucher"
        description="Daftar harga voucher hotspot. Setiap voucher mengikuti aturan paketnya: harga, lama pakai, kecepatan."
        actions={isAdmin && <Button icon={Plus} onClick={() => { setErrors({}); setForm({ ...empty, color: COLORS[(data?.length ?? 0) % COLORS.length] }); }}>Paket baru</Button>}
      />

      {isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-56" />)}</div>
      ) : list.length === 0 ? (
        <div className="card">
          <EmptyState icon={PackageIcon} title="Belum ada paket" description="Buat paket pertama Anda, misalnya “3 Jam — Rp2.000” atau “Harian — Rp5.000”."
            action={isAdmin && <Button icon={Plus} onClick={() => setForm(empty)}>Buat paket</Button>} />
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {list.map((p) => (
            <div key={p.id} className="card group relative overflow-hidden">
              <div className="h-1.5" style={{ background: p.color }} />
              <div className="p-5">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="text-lg font-bold">{p.name}</h3>
                    <p className="mt-1 text-2xl font-extrabold tracking-tight" style={{ color: p.color }}>{rupiah(p.price)}</p>
                  </div>
                  {isAdmin && (
                    <div className="flex gap-1 opacity-100 transition sm:opacity-0 sm:group-hover:opacity-100">
                      <button onClick={() => edit(p)} className="rounded-lg p-2 text-muted hover:bg-[var(--surface-2)]" title="Ubah"><Pencil className="size-4" /></button>
                      <button onClick={() => confirm(`Hapus paket "${p.name}"?`) && remove.mutate(p.id)} className="rounded-lg p-2 text-muted hover:bg-rose-500/10 hover:text-rose-600" title="Hapus"><Trash2 className="size-4" /></button>
                    </div>
                  )}
                </div>
                <ul className="mt-4 grid grid-cols-2 gap-3 text-sm">
                  <li className="flex items-center gap-2"><CalendarClock className="size-4 text-muted" /><span><span className="block text-xs text-muted">Masa aktif</span>{humanMinutes(p.validityMin)}</span></li>
                  <li className="flex items-center gap-2"><Clock className="size-4 text-muted" /><span><span className="block text-xs text-muted">Batas pakai</span>{humanMinutes(p.uptimeLimitMin)}</span></li>
                  <li className="flex items-center gap-2"><Gauge className="size-4 text-muted" /><span><span className="block text-xs text-muted">Kecepatan</span>{speed(p.rateDown)}</span></li>
                  <li className="flex items-center gap-2"><Users className="size-4 text-muted" /><span><span className="block text-xs text-muted">Perangkat</span>{p.sharedUsers} HP/laptop</span></li>
                  {p.quotaMb && <li className="flex items-center gap-2"><HardDrive className="size-4 text-muted" /><span><span className="block text-xs text-muted">Kuota</span>{(p.quotaMb / 1024).toLocaleString('id-ID')} GB</span></li>}
                </ul>
                <div className="mt-4 flex gap-2 border-t pt-4">
                  <Badge tone="blue">{p.unused} siap jual</Badge>
                  <Badge tone="green">{p.activeCount} aktif</Badge>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <Modal
        open={!!form} onClose={() => setForm(null)} size="lg"
        title={form?.id ? 'Ubah paket' : 'Paket baru'}
        description="Isi seperlunya saja. Yang kosong berarti tanpa batas."
        footer={<><Button variant="secondary" onClick={() => setForm(null)}>Batal</Button><Button loading={save.isPending} onClick={() => form && save.mutate(form)}>Simpan paket</Button></>}
      >
        {form && (
          <div className="space-y-5">
            <div className="grid gap-4 sm:grid-cols-[1fr_180px]">
              <Field label="Nama paket" error={errors.name}><Input value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="contoh: Hemat 3 Jam" autoFocus /></Field>
              <Field label="Harga jual" error={errors.price}>
                <div className="relative">
                  <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-sm font-semibold text-muted">Rp</span>
                  <Input inputMode="numeric" className="pl-10" value={form.price} onChange={(e) => set('price', e.target.value.replace(/\D/g, ''))} placeholder="2000" />
                </div>
              </Field>
            </div>

            <Field label="Masa aktif" hint="Dihitung sejak pelanggan pertama kali login. Setelah lewat, voucher hangus.">
              <DurationPicker value={form.validityMin} onChange={(v) => set('validityMin', v)} allowNone="Tanpa batas" />
            </Field>

            <Field label="Batas pemakaian" hint="Total waktu online. Berhenti dihitung saat pelanggan logout. Cocok untuk paket per jam.">
              <DurationPicker value={form.uptimeLimitMin} onChange={(v) => set('uptimeLimitMin', v)} allowNone="Tanpa batas" />
            </Field>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Kecepatan download" error={errors.rateDown}>
                <div className="flex flex-wrap gap-2">
                  {SPEEDS.map((s) => <button type="button" key={s} onClick={() => set('rateDown', s)} className={clsx('chip', form.rateDown === s && 'chip-active')}>{s.replace('M', '')} Mbps</button>)}
                </div>
                <Input className="mt-2" value={form.rateDown} onChange={(e) => set('rateDown', e.target.value)} placeholder="Kosong = tanpa batas" />
              </Field>
              <Field label="Kecepatan upload" error={errors.rateUp} hint="Biasanya setengah dari download.">
                <Input value={form.rateUp} onChange={(e) => set('rateUp', e.target.value)} placeholder="contoh: 2M atau 512k" />
              </Field>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Jumlah perangkat" hint="Berapa HP/laptop yang boleh pakai 1 voucher bersamaan.">
                <Input type="number" min={1} max={50} value={form.sharedUsers} onChange={(e) => set('sharedUsers', e.target.value)} />
              </Field>
              <Field label="Kuota (GB)" hint="Opsional. Kosong = tanpa batas kuota.">
                <Input type="number" min={0} step="0.5" value={form.quotaMb} onChange={(e) => set('quotaMb', e.target.value)} placeholder="Tanpa batas" />
              </Field>
            </div>

            <Field label="Warna label" hint="Membantu membedakan paket di voucher & laporan.">
              <div className="flex gap-2">
                {COLORS.map((c) => (
                  <button type="button" key={c} onClick={() => set('color', c)} className={clsx('size-9 rounded-full ring-offset-2 ring-offset-[var(--surface)] transition', form.color === c && 'ring-2 ring-[var(--text)]')} style={{ background: c }} />
                ))}
              </div>
            </Field>

            <Tip>
              <b>Contoh:</b> Paket “Hemat” dengan <b>batas pemakaian 3 jam</b> dan <b>masa aktif 1 hari</b>. Pelanggan bisa memakai total 3 jam,
              tapi harus habis dalam 24 jam sejak login pertama.
            </Tip>
          </div>
        )}
      </Modal>
    </>
  );
}
