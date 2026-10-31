import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { KeyRound, LogOut, MonitorSmartphone } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import type { User } from '@/lib/types';
import { Button, Field, Input, Modal } from './ui';

/** Akun saya: ganti password & keluar dari semua perangkat (untuk semua peran). */
export default function AccountModal({ onClose }: { onClose: () => void }) {
  const { user, signIn, signOut } = useAuth();
  const [f, setF] = useState({ oldPassword: '', newPassword: '', confirm: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});

  const change = useMutation({
    mutationFn: () => {
      if (f.newPassword !== f.confirm) throw new ApiError('Konfirmasi password tidak sama.', 400, { confirm: 'Tidak sama dengan password baru.' });
      return api<{ token: string; user: User }>('/auth/password', { method: 'POST', json: { oldPassword: f.oldPassword, newPassword: f.newPassword } });
    },
    onSuccess: (r) => { signIn(r.token, r.user); toast.success('Password diganti. Perangkat lain otomatis keluar.'); onClose(); },
    onError: (e) => { if (e instanceof ApiError && e.fields) setErrors(e.fields); toast.error(e.message); },
  });
  const logoutAll = useMutation({
    mutationFn: () => api<{ token: string; user: User }>('/auth/logout-all', { method: 'POST' }),
    onSuccess: (r) => { signIn(r.token, r.user); toast.success('Semua perangkat lain sudah dikeluarkan.'); onClose(); },
    onError: (e) => toast.error(e.message),
  });

  return (
    <Modal open onClose={onClose} title="Akun saya" description={`${user?.name} • @${user?.username}`}>
      <div className="space-y-6">
        <div className="space-y-4">
          <h3 className="flex items-center gap-2 font-bold"><KeyRound className="size-4" />Ganti password</h3>
          <Field label="Password lama" error={errors.oldPassword}><Input type="password" autoComplete="current-password" value={f.oldPassword} onChange={(e) => setF({ ...f, oldPassword: e.target.value })} /></Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Password baru" error={errors.newPassword} hint="Minimal 6 karakter."><Input type="password" autoComplete="new-password" value={f.newPassword} onChange={(e) => setF({ ...f, newPassword: e.target.value })} /></Field>
            <Field label="Ulangi password baru" error={errors.confirm}><Input type="password" autoComplete="new-password" value={f.confirm} onChange={(e) => setF({ ...f, confirm: e.target.value })} /></Field>
          </div>
          <Button loading={change.isPending} disabled={!f.oldPassword || !f.newPassword} onClick={() => { setErrors({}); change.mutate(); }}>Simpan password baru</Button>
        </div>
        <div className="space-y-3 border-t pt-5">
          <h3 className="flex items-center gap-2 font-bold"><MonitorSmartphone className="size-4" />Perangkat</h3>
          <p className="text-sm text-muted">HP hilang atau pernah login di komputer orang lain? Keluarkan semua perangkat lain. Anda tetap masuk di perangkat ini.</p>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" loading={logoutAll.isPending} onClick={() => confirm('Keluarkan semua perangkat lain?') && logoutAll.mutate()}>Keluar dari semua perangkat lain</Button>
            <Button variant="ghost" icon={LogOut} className="text-rose-600" onClick={signOut}>Keluar</Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
