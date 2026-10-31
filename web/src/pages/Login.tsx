import { useState, type FormEvent } from 'react';
import { CheckCircle2, Printer, BarChart3, Activity } from 'lucide-react';
import { toast } from 'sonner';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import type { User } from '@/lib/types';
import { Button, Field, Input } from '@/components/ui';
import { Logo } from '@/components/Layout';

export default function LoginPage() {
  const { needsSetup, signIn } = useAuth();
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [f, setF] = useState({ businessName: '', name: '', username: '', password: '', phone: '' });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErrors({});
    try {
      const res = needsSetup
        ? await api<{ token: string; user: User }>('/auth/setup', { method: 'POST', json: f })
        : await api<{ token: string; user: User }>('/auth/login', { method: 'POST', json: { username: f.username, password: f.password } });
      signIn(res.token, res.user);
      toast.success(needsSetup ? 'Akun berhasil dibuat. Selamat datang!' : `Halo, ${res.user.name}!`);
    } catch (err) {
      if (err instanceof ApiError && err.fields) setErrors(err.fields);
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid min-h-screen lg:grid-cols-[1.1fr_1fr]">
      <div className="relative hidden overflow-hidden bg-gradient-to-br from-brand-700 via-brand-600 to-violet-700 p-12 text-white lg:flex lg:flex-col">
        <div className="absolute -right-24 -top-24 size-96 rounded-full bg-white/10 blur-3xl" />
        <div className="absolute -bottom-32 -left-16 size-96 rounded-full bg-violet-400/20 blur-3xl" />
        <div className="relative flex items-center gap-2.5 text-xl font-extrabold"><Logo className="[&_span:last-child]:text-white" /></div>
        <div className="relative mt-auto max-w-lg">
          <h1 className="text-4xl font-extrabold leading-tight tracking-tight">Bisnis WiFi voucher jadi gampang, rapi, dan untung.</h1>
          <p className="mt-4 text-lg text-white/80">Tanpa perlu paham setting MikroTik. Semua dipandu langkah demi langkah.</p>
          <ul className="mt-10 space-y-4">
            {[
              [Printer, 'Buat & cetak ratusan voucher dalam hitungan detik'],
              [Activity, 'Pantau pelanggan hotspot & PPPoE secara langsung'],
              [BarChart3, 'Laporan penjualan lengkap dengan grafik & filter'],
              [CheckCircle2, 'Masa aktif voucher diurus otomatis'],
            ].map(([Icon, text], i) => {
              const I = Icon as typeof Printer;
              return (
                <li key={i} className="flex items-center gap-3 text-[15px]">
                  <span className="grid size-9 place-items-center rounded-xl bg-white/15"><I className="size-[18px]" /></span>
                  {text as string}
                </li>
              );
            })}
          </ul>
        </div>
      </div>

      <div className="flex items-center justify-center p-6 sm:p-12">
        <form onSubmit={submit} className="w-full max-w-md">
          <Logo className="mb-10 lg:hidden" />
          <h2 className="text-3xl font-extrabold tracking-tight">{needsSetup ? 'Mulai usaha WiFi Anda' : 'Masuk'}</h2>
          <p className="mt-2 text-muted">
            {needsSetup ? 'Buat akun pemilik terlebih dahulu. Hanya butuh 1 menit.' : 'Silakan masuk untuk mengelola usaha WiFi Anda.'}
          </p>

          <div className="mt-8 space-y-4">
            {needsSetup && (
              <>
                <Field label="Nama usaha" hint="Tampil di voucher & halaman login WiFi." error={errors.businessName}>
                  <Input value={f.businessName} onChange={set('businessName')} placeholder="contoh: Mantap WiFi" required autoFocus />
                </Field>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Nama Anda" error={errors.name}><Input value={f.name} onChange={set('name')} placeholder="Budi" required /></Field>
                  <Field label="No. WhatsApp" hint="Opsional"><Input value={f.phone} onChange={set('phone')} placeholder="0812xxxx" inputMode="tel" /></Field>
                </div>
              </>
            )}
            <Field label="Username" error={errors.username}>
              <Input value={f.username} onChange={set('username')} placeholder="admin" autoComplete="username" required autoFocus={!needsSetup} />
            </Field>
            <Field label="Password" error={errors.password} hint={needsSetup ? 'Minimal 6 karakter.' : undefined}>
              <Input type="password" value={f.password} onChange={set('password')} placeholder="••••••••" autoComplete={needsSetup ? 'new-password' : 'current-password'} required />
            </Field>
          </div>

          <Button type="submit" size="lg" className="mt-8 w-full" loading={busy}>
            {needsSetup ? 'Buat akun & mulai' : 'Masuk'}
          </Button>
        </form>
      </div>
    </div>
  );
}
