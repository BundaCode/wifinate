import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import clsx from 'clsx';
import { Save, Store, Ticket, Users, Plus, Trash2 } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useSettings } from '@/lib/queries';
import type { Settings as S, User } from '@/lib/types';
import { Badge, Button, Field, Input, Modal, PageHeader, Select, Skeleton, Toggle } from '@/components/ui';

function sampleCode(s: S) {
  const sets = { numeric: '23456789', alpha: 'ABCDEFGHJKMNPQRSTUVWXYZ', alnum: 'ABCDEFGHJKMNPQRSTUVWXYZ23456789' };
  const cs = sets[s.codeCharset];
  let out = '';
  for (let i = 0; i < s.codeLength; i++) out += cs[(i * 7 + 3) % cs.length];
  return s.codePrefix + out;
}

function Section({ icon: Icon, title, description, children }: { icon: typeof Store; title: string; description: string; children: React.ReactNode }) {
  return (
    <div className="card grid gap-6 p-6 lg:grid-cols-[280px_1fr]">
      <div>
        <span className="grid size-10 place-items-center rounded-xl bg-brand-500/10 text-brand-600"><Icon className="size-5" /></span>
        <h2 className="mt-3 font-bold">{title}</h2>
        <p className="mt-1 text-sm text-muted">{description}</p>
      </div>
      <div className="space-y-4">{children}</div>
    </div>
  );
}

function UsersSection() {
  const { user: me } = useAuth();
  const qc = useQueryClient();
  const users = useQuery({ queryKey: ['users'], queryFn: () => api<(User & { createdAt: number })[]>('/users') });
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ name: '', username: '', password: '', role: 'kasir' as 'admin' | 'kasir' });
  const add = useMutation({
    mutationFn: () => api('/users', { method: 'POST', json: f }),
    onSuccess: () => { toast.success('Akun dibuat'); setOpen(false); setF({ name: '', username: '', password: '', role: 'kasir' }); qc.invalidateQueries({ queryKey: ['users'] }); },
    onError: (e) => toast.error(e.message),
  });
  const del = useMutation({
    mutationFn: (id: number) => api(`/users/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['users'] }),
    onError: (e) => toast.error(e.message),
  });
  return (
    <Section icon={Users} title="Pengguna" description="Tambahkan akun kasir/penjaga. Kasir bisa membuat & mencetak voucher, tapi tidak bisa mengubah router atau pengaturan.">
      <ul className="divide-y rounded-xl border">
        {users.data?.map((u) => (
          <li key={u.id} className="flex items-center gap-3 p-3">
            <span className="grid size-9 place-items-center rounded-full bg-brand-600 text-sm font-bold text-white">{u.name[0]?.toUpperCase()}</span>
            <div className="flex-1"><p className="font-semibold">{u.name}</p><p className="text-xs text-muted">@{u.username}</p></div>
            <Badge tone={u.role === 'admin' ? 'brand' : 'gray'}>{u.role === 'admin' ? 'Admin' : 'Kasir'}</Badge>
            {u.id !== me?.id && <button onClick={() => confirm(`Hapus akun ${u.name}?`) && del.mutate(u.id)} className="rounded-lg p-2 text-muted hover:text-rose-600"><Trash2 className="size-4" /></button>}
          </li>
        ))}
      </ul>
      <Button variant="secondary" icon={Plus} onClick={() => setOpen(true)}>Tambah pengguna</Button>
      <Modal open={open} onClose={() => setOpen(false)} title="Tambah pengguna"
        footer={<><Button variant="secondary" onClick={() => setOpen(false)}>Batal</Button><Button loading={add.isPending} onClick={() => add.mutate()}>Simpan</Button></>}>
        <div className="space-y-4">
          <Field label="Nama"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Username"><Input value={f.username} onChange={(e) => setF({ ...f, username: e.target.value })} /></Field>
            <Field label="Password"><Input type="password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} /></Field>
          </div>
          <Field label="Peran">
            <Select value={f.role} onChange={(e) => setF({ ...f, role: e.target.value as 'admin' | 'kasir' })}>
              <option value="kasir">Kasir — buat & cetak voucher</option>
              <option value="admin">Admin — akses penuh</option>
            </Select>
          </Field>
        </div>
      </Modal>
    </Section>
  );
}

export default function Settings() {
  const qc = useQueryClient();
  const { data } = useSettings();
  const [s, setS] = useState<S | null>(null);
  useEffect(() => { if (data) setS(data); }, [data]);
  const save = useMutation({
    mutationFn: (v: S) => api<S>('/settings', { method: 'PUT', json: v }),
    onSuccess: (v) => { qc.setQueryData(['settings'], v); toast.success('Pengaturan tersimpan'); },
    onError: (e) => toast.error(e.message),
  });
  if (!s) return <Skeleton className="h-96" />;
  const set = <K extends keyof S>(k: K, v: S[K]) => setS({ ...s, [k]: v });
  const dirty = JSON.stringify(s) !== JSON.stringify(data);

  return (
    <>
      <PageHeader title="Pengaturan" description="Profil usaha, tampilan voucher, dan akun pengguna."
        actions={<Button icon={Save} disabled={!dirty} loading={save.isPending} onClick={() => save.mutate(s)}>Simpan perubahan</Button>} />
      <div className="space-y-6">
        <Section icon={Store} title="Profil usaha" description="Ditampilkan di voucher yang dicetak.">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Nama usaha"><Input value={s.businessName} onChange={(e) => set('businessName', e.target.value)} /></Field>
            <Field label="No. WhatsApp"><Input value={s.phone} onChange={(e) => set('phone', e.target.value)} /></Field>
          </div>
          <Field label="Alamat"><Input value={s.address} onChange={(e) => set('address', e.target.value)} /></Field>
          <Field label="Pesan di bawah voucher"><Input value={s.voucherFooter} onChange={(e) => set('voucherFooter', e.target.value)} maxLength={60} /></Field>
        </Section>

        <Section icon={Ticket} title="Format voucher" description="Atur bentuk kode voucher dan tata letak cetak.">
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Jenis karakter">
              <Select value={s.codeCharset} onChange={(e) => set('codeCharset', e.target.value as S['codeCharset'])}>
                <option value="numeric">Angka saja</option>
                <option value="alpha">Huruf saja</option>
                <option value="alnum">Huruf + angka</option>
              </Select>
            </Field>
            <Field label="Panjang kode"><Input type="number" min={4} max={16} value={s.codeLength} onChange={(e) => set('codeLength', Number(e.target.value))} /></Field>
            <Field label="Awalan" hint="Opsional, mis. HM-"><Input value={s.codePrefix} maxLength={6} onChange={(e) => set('codePrefix', e.target.value.toUpperCase())} /></Field>
          </div>
          <Toggle checked={s.passwordSameAsCode} onChange={(v) => set('passwordSameAsCode', v)} label="Password sama dengan kode" description="Pelanggan cukup mengetik satu kode. Paling mudah & paling umum." />
          <Field label="Kartu per baris (lembar A4)">
            <div className="flex gap-2">
              {[3, 4, 5].map((n) => <button key={n} type="button" onClick={() => set('printColumns', n)} className={clsx('chip', s.printColumns === n && 'chip-active')}>{n} kolom</button>)}
            </div>
          </Field>
          <div className="rounded-xl bg-[var(--surface-2)] p-4">
            <p className="text-xs font-semibold text-muted">Contoh kode</p>
            <p className="mt-1 font-mono text-2xl font-bold tracking-widest">{sampleCode(s)}</p>
          </div>
        </Section>

        <UsersSection />
      </div>
    </>
  );
}
