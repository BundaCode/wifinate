import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import clsx from 'clsx';
import { Save, Store, Ticket, Users, Plus, Trash2, LogIn, ShieldAlert, Download, MessageCircle, Send, CheckCircle2, XCircle, Clock, DatabaseBackup } from 'lucide-react';
import { dateTime } from '@/lib/format';
import PagePreview from '@/components/PagePreview';
import BackupSection from '@/components/BackupSection';
import { openFile } from '@/lib/api';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useSettings } from '@/lib/queries';
import type { Settings as S, User } from '@/lib/types';
import { Badge, Button, Field, Input, Modal, PageHeader, Select, Skeleton, Tip, Toggle } from '@/components/ui';

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
      <div className="min-w-0 space-y-4">{children}</div>
    </div>
  );
}

interface NotifLog { id: number; kind: string; target: string; message: string; status: 'pending' | 'sent' | 'failed'; error: string | null; createdAt: number }

function NotifySection({ s, set, dirty }: { s: S; set: <K extends keyof S>(k: K, v: S[K]) => void; dirty: boolean }) {
  const log = useQuery({ queryKey: ['notify-log'], queryFn: () => api<NotifLog[]>('/notify/log'), refetchInterval: 30_000 });
  const test = useMutation({
    mutationFn: () => api('/notify/test', { method: 'POST', json: {} }),
    onSuccess: () => { toast.success('Pesan uji terkirim. Cek WhatsApp Anda.'); log.refetch(); },
    onError: (e) => toast.error(e.message, { duration: 10_000 }),
  });
  const on = s.waProvider !== 'off';
  return (
    <Section icon={MessageCircle} title="Notifikasi WhatsApp" description="Kabar otomatis ke WA Anda (router mati, stok menipis, ringkasan harian) dan pengingat tagihan ke pelanggan.">
      <Field label="Gateway WhatsApp">
        <div className="flex flex-wrap gap-2">
          {([['off', 'Mati'], ['fonnte', 'Fonnte'], ['webhook', 'Webhook kustom']] as const).map(([k, l]) => (
            <button key={k} type="button" onClick={() => set('waProvider', k)} className={clsx('chip', s.waProvider === k && 'chip-active')}>{l}</button>
          ))}
        </div>
      </Field>
      {s.waProvider === 'fonnte' && (
        <Tip>Daftar di <a className="font-semibold text-brand-600 underline" href="https://fonnte.com" target="_blank" rel="noreferrer">fonnte.com</a>, sambungkan nomor WA dengan scan QR, lalu salin <b>Token</b> perangkat ke sini.</Tip>
      )}
      {s.waProvider === 'webhook' && (
        <Field label="URL webhook" hint='Wifinate mengirim POST JSON {"target":"62812…","message":"…"} dengan header Authorization: Bearer <token>.'>
          <Input value={s.waWebhookUrl} onChange={(e) => set('waWebhookUrl', e.target.value)} placeholder="https://gateway-saya.com/send" />
        </Field>
      )}
      {on && (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Token" hint={s.waTokenSet ? 'Token tersimpan. Isi hanya jika ingin mengganti.' : undefined}>
              <Input type="password" value={s.waToken} onChange={(e) => set('waToken', e.target.value)} placeholder={s.waTokenSet ? '•••••••• (tersimpan)' : 'Tempel token di sini'} autoComplete="off" />
            </Field>
            <Field label="Nomor WA pemilik" hint="Penerima notifikasi untuk Anda."><Input value={s.waOwnerNumber} inputMode="tel" onChange={(e) => set('waOwnerNumber', e.target.value)} placeholder="0812xxxx" /></Field>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <Toggle checked={s.notifyRouterDown} onChange={(v) => set('notifyRouterDown', v)} label="Router mati / hidup lagi" description="Dikirim jika router tidak bisa dihubungi lebih dari 2 menit." />
            <Toggle checked={s.notifyIsolir} onChange={(v) => set('notifyIsolir', v)} label="Pelanggan diisolir otomatis" />
            <Toggle checked={s.notifyPayment} onChange={(v) => set('notifyPayment', v)} label="Pembayaran PPPoE diterima" />
            <Toggle checked={s.notifyCustomer} onChange={(v) => set('notifyCustomer', v)} label="Kirim ke pelanggan PPPoE" description="Pengingat H-3 & hari jatuh tempo, info isolir, dan ucapan terima kasih setelah bayar." />
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <div className="rounded-xl border p-3.5">
              <Toggle checked={s.notifyLowStock} onChange={(v) => set('notifyLowStock', v)} label="Stok voucher menipis" />
              {s.notifyLowStock && <div className="mt-2 flex items-center gap-2 text-sm"><span className="text-muted">Jika kurang dari</span><Input className="h-9 w-24" type="number" min={1} value={s.lowStockThreshold} onChange={(e) => set('lowStockThreshold', Number(e.target.value))} /><span className="text-muted">voucher</span></div>}
            </div>
            <div className="rounded-xl border p-3.5">
              <Toggle checked={s.notifyDailySummary} onChange={(v) => set('notifyDailySummary', v)} label="Ringkasan penjualan harian" />
              {s.notifyDailySummary && <div className="mt-2 flex items-center gap-2 text-sm"><span className="text-muted">Dikirim pukul</span>
                <Select className="h-9 w-28" value={s.dailySummaryHour} onChange={(e) => set('dailySummaryHour', Number(e.target.value))}>
                  {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{String(h).padStart(2, '0')}.00</option>)}
                </Select></div>}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="secondary" icon={Send} loading={test.isPending} disabled={dirty} onClick={() => test.mutate()}>Kirim pesan uji</Button>
            {dirty && <span className="text-xs text-muted">Simpan perubahan dulu sebelum menguji.</span>}
          </div>
        </>
      )}
      {!!log.data?.length && (
        <div>
          <p className="mb-2 text-sm font-semibold">Pesan terakhir</p>
          <ul className="max-h-72 divide-y overflow-y-auto rounded-xl border">
            {log.data.map((n) => (
              <li key={n.id} className="flex gap-3 p-3 text-sm">
                {n.status === 'sent' ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-500" /> : n.status === 'failed' ? <XCircle className="mt-0.5 size-4 shrink-0 text-rose-500" /> : <Clock className="mt-0.5 size-4 shrink-0 text-muted" />}
                <div className="min-w-0 flex-1">
                  <p className="truncate">{n.message.split('\n')[0].replace(/\*/g, '')}</p>
                  <p className="text-xs text-muted">{dateTime(n.createdAt)} • ke {n.target}{n.error && <span className="text-rose-600"> • {n.error}</span>}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Section>
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
    mutationFn: (v: S) => {
      // Field turunan (tidak disimpan) & token kosong tidak dikirim.
      const { waTokenSet: _t, ...rest } = v;
      return api<S>('/settings', { method: 'PUT', json: rest });
    },
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

        <Section icon={LogIn} title="Halaman login hotspot" description="Tampilan yang muncul saat pelanggan konek WiFi. Pasang ke router lewat menu Router → Pasang halaman login.">
          <div className="grid gap-6 xl:grid-cols-[1fr_300px]">
            <div className="space-y-4">
              <Field label="Judul"><Input value={s.loginTitle} maxLength={60} onChange={(e) => set('loginTitle', e.target.value)} /></Field>
              <Field label="Kalimat sambutan"><Input value={s.loginWelcome} maxLength={200} onChange={(e) => set('loginWelcome', e.target.value)} /></Field>
              <Field label="Warna utama" hint="Dipakai di halaman login dan kartu voucher.">
                <div className="flex flex-wrap items-center gap-2">
                  {['#4f46e5', '#0ea5e9', '#059669', '#d97706', '#dc2626', '#db2777', '#7c3aed', '#0f172a'].map((c) => (
                    <button key={c} type="button" onClick={() => set('brandColor', c)} className={clsx('size-9 rounded-full ring-offset-2 ring-offset-[var(--surface)]', s.brandColor === c && 'ring-2 ring-[var(--text)]')} style={{ background: c }} />
                  ))}
                  <input type="color" value={s.brandColor} onChange={(e) => set('brandColor', e.target.value)} className="size-9 cursor-pointer rounded-full border-0 bg-transparent" title="Warna lain" />
                </div>
              </Field>
              <Toggle checked={s.loginShowPrices} onChange={(v) => set('loginShowPrices', v)} label="Tampilkan daftar harga voucher" description="Diambil otomatis dari menu Paket voucher." />
              <p className="text-xs text-muted">Nomor WhatsApp dari profil usaha dipakai untuk tombol “Beli voucher via WhatsApp”.</p>
              <Button variant="secondary" icon={Download} onClick={() => openFile('/pages/login/download', { download: 'login.html' })}>Unduh login.html (pasang manual)</Button>
            </div>
            <PagePreview kind="login" draft={s as unknown as Record<string, unknown>} />
          </div>
        </Section>

        <Section icon={ShieldAlert} title="Halaman isolir PPPoE" description="Muncul saat pelanggan yang diisolir membuka website. Nama & jumlah tagihan pelanggan tampil otomatis.">
          <div className="grid gap-6 xl:grid-cols-[1fr_300px]">
            <div className="space-y-4">
              <Field label="Pesan"><textarea className="input h-28 py-3" value={s.isolirMessage} maxLength={500} onChange={(e) => set('isolirMessage', e.target.value)} /></Field>
              <Field label="Cara pembayaran" hint="Contoh: BCA 1234567890 a.n. Budi • DANA 0812xxxx">
                <textarea className="input h-28 py-3" value={s.paymentInfo} maxLength={500} onChange={(e) => set('paymentInfo', e.target.value)} placeholder={'BCA 1234567890 a.n. Budi\nDANA / OVO 0812xxxx'} />
              </Field>
            </div>
            <PagePreview kind="isolir" draft={s as unknown as Record<string, unknown>} />
          </div>
        </Section>

        <NotifySection s={s} set={set} dirty={dirty} />

        <UsersSection />

        <Section icon={DatabaseBackup} title="Backup & pulihkan" description="Simpan salinan seluruh data (voucher, pelanggan, tagihan, saldo reseller, pengaturan) dan kembalikan bila perlu.">
          <BackupSection />
        </Section>
      </div>
    </>
  );
}
