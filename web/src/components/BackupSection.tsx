import { useRef, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { DatabaseBackup, Download, Upload, RotateCcw, ShieldAlert } from 'lucide-react';
import { api, ApiError, getToken, openFile } from '@/lib/api';
import { bytes, dateTime } from '@/lib/format';
import { Button, Modal, Spinner, Tip } from './ui';

interface BackupInfo { name: string; size: number; createdAt: number }
interface RestoreResult { summary: { users: number; vouchers: number; customers: number; createdAt: number }; message: string }

/** Tunggu server menyala lagi setelah pemulihan, lalu muat ulang halaman (perlu login lagi). */
async function waitForRestart() {
  await new Promise((r) => setTimeout(r, 2000));
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch('/api/health')).ok) break; } catch { /* masih restart */ }
    await new Promise((r) => setTimeout(r, 1000));
  }
  window.location.href = '/';
}

export default function BackupSection() {
  const list = useQuery({ queryKey: ['backups'], queryFn: () => api<BackupInfo[]>('/backups') });
  const fileRef = useRef<HTMLInputElement>(null);
  const [restoring, setRestoring] = useState<string | null>(null);

  const restore = useMutation({
    mutationFn: async (src: { file?: File; name?: string }) => {
      if (src.name) return api<RestoreResult>(`/backups/file/${encodeURIComponent(src.name)}/restore`, { method: 'POST' });
      const res = await fetch('/api/backups/restore', {
        method: 'POST', body: src.file,
        headers: { 'Content-Type': 'application/octet-stream', Authorization: `Bearer ${getToken() ?? ''}` },
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new ApiError(data?.message ?? 'Gagal memulihkan', res.status);
      return data as RestoreResult;
    },
    onMutate: (src) => setRestoring(src.name ?? src.file?.name ?? 'backup'),
    onSuccess: async (r) => {
      toast.success(`Data dipulihkan: ${r.summary.vouchers} voucher, ${r.summary.customers} pelanggan. Menyalakan ulang…`);
      await waitForRestart();
    },
    onError: (e) => { setRestoring(null); toast.error(e.message); },
  });

  const confirmRestore = (label: string) =>
    confirm(`Pulihkan data dari "${label}"?\n\nSemua data SEKARANG akan diganti dengan isi backup ini. Data sekarang tetap disimpan di folder backups untuk jaga-jaga. Semua pengguna perlu login ulang.`);

  return (
    <>
      <div className="flex flex-wrap gap-2">
        <Button icon={Download} onClick={() => openFile('/backups/now', { download: `wifinate-backup-${new Date().toISOString().slice(0, 10)}.wifinate` }).catch((e) => toast.error(e.message))}>
          Unduh backup sekarang
        </Button>
        <Button variant="secondary" icon={Upload} onClick={() => fileRef.current?.click()}>Pulihkan dari file…</Button>
        <input ref={fileRef} type="file" accept=".wifinate" className="hidden" onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f && confirmRestore(f.name)) restore.mutate({ file: f });
        }} />
      </div>
      <Tip>Backup otomatis dibuat <b>setiap hari</b> (14 hari terakhir disimpan di server). Sesekali <b>unduh backup</b> dan simpan di HP/Google Drive supaya aman jika server rusak.</Tip>
      <div className="flex gap-3 rounded-xl border border-amber-500/30 bg-amber-500/5 p-3.5 text-sm">
        <ShieldAlert className="mt-0.5 size-4 shrink-0 text-amber-600" />
        <span>File backup berisi seluruh data termasuk kunci password router. <b>Jangan dibagikan</b> ke orang lain.</span>
      </div>
      <div>
        <p className="mb-2 text-sm font-semibold">Backup otomatis di server</p>
        {list.isLoading ? <Spinner /> : !list.data?.length ? (
          <p className="rounded-xl bg-[var(--surface-2)] p-4 text-sm text-muted">Belum ada. Backup pertama dibuat otomatis mulai pukul 03.00.</p>
        ) : (
          <ul className="divide-y rounded-xl border">
            {list.data.map((b) => (
              <li key={b.name} className="flex flex-wrap items-center gap-3 p-3">
                <DatabaseBackup className="size-4 text-muted" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{b.name}</p>
                  <p className="text-xs text-muted">{dateTime(b.createdAt)} • {bytes(b.size)}</p>
                </div>
                <Button size="sm" variant="ghost" icon={Download} title="Unduh" onClick={() => openFile(`/backups/file/${encodeURIComponent(b.name)}`, { download: b.name }).catch((e) => toast.error(e.message))} />
                <Button size="sm" variant="ghost" icon={RotateCcw} title="Pulihkan" onClick={() => confirmRestore(b.name) && restore.mutate({ name: b.name })} />
              </li>
            ))}
          </ul>
        )}
      </div>

      <Modal open={!!restoring} onClose={() => {}} title="Memulihkan data…">
        <div className="flex flex-col items-center py-6 text-center">
          <Spinner className="size-10" />
          <p className="mt-4 font-semibold">{restore.isSuccess ? 'Menyalakan ulang aplikasi…' : `Memeriksa ${restoring}…`}</p>
          <p className="mt-1 text-sm text-muted">Jangan tutup halaman ini. Setelah selesai, silakan login kembali.</p>
        </div>
      </Modal>
    </>
  );
}
