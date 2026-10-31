import { useEffect, useState } from 'react';
import { getToken } from '@/lib/api';
import { Smartphone } from 'lucide-react';

/** Preview halaman (login hotspot / isolir) dalam bingkai HP, diperbarui saat pengaturan diubah. */
export default function PagePreview({ kind, draft }: { kind: 'login' | 'isolir'; draft: Record<string, unknown> }) {
  const [html, setHtml] = useState('');
  const body = JSON.stringify(draft);

  useEffect(() => {
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/pages/${kind}/preview`, {
          method: 'POST', signal: ctrl.signal, body,
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken() ?? ''}` },
        });
        if (res.ok) setHtml(await res.text());
      } catch { /* dibatalkan */ }
    }, 350);
    return () => { clearTimeout(t); ctrl.abort(); };
  }, [kind, body]);

  return (
    <div className="flex flex-col items-center">
      <div className="relative w-[280px] rounded-[36px] border-[10px] border-slate-900 bg-slate-900 shadow-2xl dark:border-slate-700">
        <div className="absolute left-1/2 top-0 z-10 h-5 w-24 -translate-x-1/2 rounded-b-2xl bg-slate-900 dark:bg-slate-700" />
        <iframe title={`Preview ${kind}`} srcDoc={html} sandbox="" className="h-[520px] w-full rounded-[26px] bg-white" />
      </div>
      <p className="mt-3 flex items-center gap-1.5 text-xs text-muted"><Smartphone className="size-3.5" />Tampilan di HP pelanggan</p>
    </div>
  );
}
