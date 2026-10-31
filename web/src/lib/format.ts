export const rupiah = (n: number) => `Rp${Math.round(n).toLocaleString('id-ID')}`;

export const rupiahShort = (n: number) => {
  if (n >= 1_000_000_000) return `Rp${(n / 1_000_000_000).toFixed(1).replace('.0', '')} M`;
  if (n >= 1_000_000) return `Rp${(n / 1_000_000).toFixed(1).replace('.0', '')} jt`;
  if (n >= 1_000) return `Rp${(n / 1_000).toFixed(0)} rb`;
  return `Rp${n}`;
};

export const num = (n: number) => n.toLocaleString('id-ID');

export function humanMinutes(min: number | null | undefined): string {
  if (!min) return 'Tanpa batas';
  const parts: string[] = [];
  const d = Math.floor(min / 1440);
  const h = Math.floor((min % 1440) / 60);
  const m = min % 60;
  if (d) parts.push(`${d} hari`);
  if (h) parts.push(`${h} jam`);
  if (m) parts.push(`${m} menit`);
  return parts.join(' ');
}

export function humanSeconds(sec: number): string {
  if (sec < 60) return `${sec} dtk`;
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (d) return `${d}h ${h}j`;
  if (h) return `${h}j ${m}m`;
  return `${m} mnt`;
}

export function bytes(n: number): string {
  if (n < 1024) return `${n} B`;
  const u = ['KB', 'MB', 'GB', 'TB'];
  let i = -1;
  do { n /= 1024; i++; } while (n >= 1024 && i < u.length - 1);
  return `${n.toFixed(n >= 100 ? 0 : 1)} ${u[i]}`;
}

export function speed(v: string | null): string {
  if (!v) return 'Tanpa batas';
  const m = v.match(/^(\d+)([kKmM]?)$/);
  if (!m) return v;
  return `${m[1]} ${m[2].toLowerCase() === 'k' ? 'Kbps' : 'Mbps'}`;
}

export const dateTime = (ms: number) =>
  new Date(ms).toLocaleString('id-ID', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

export const dateShort = (ms: number) => new Date(ms).toLocaleDateString('id-ID', { day: 'numeric', month: 'short' });

export function relative(ms: number): string {
  const diff = Date.now() - ms;
  const abs = Math.abs(diff);
  const fut = diff < 0;
  const f = (n: number, u: string) => (fut ? `${n} ${u} lagi` : `${n} ${u} lalu`);
  if (abs < 60_000) return fut ? 'sebentar lagi' : 'baru saja';
  if (abs < 3_600_000) return f(Math.round(abs / 60_000), 'menit');
  if (abs < 86_400_000) return f(Math.round(abs / 3_600_000), 'jam');
  return f(Math.round(abs / 86_400_000), 'hari');
}

/** Label sumbu grafik dari bucket "2026-10-31" / "2026-10-31 13:00" / "2026-10". */
export function bucketLabel(b: string): string {
  if (/^\d{4}-\d{2}$/.test(b)) {
    const [y, m] = b.split('-').map(Number);
    return new Date(y, m - 1, 1).toLocaleDateString('id-ID', { month: 'short', year: '2-digit' });
  }
  if (b.includes(' ')) return b.slice(11, 16);
  const [y, m, d] = b.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('id-ID', { day: 'numeric', month: 'short' });
}

/** Label sumbu grafik yang ringkas: 280000 → "280rb", 1200000 → "1,2jt". */
export const axisShort = (n: number) => {
  if (n >= 1_000_000) return `${(n / 1_000_000).toLocaleString('id-ID', { maximumFractionDigits: 1 })}jt`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}rb`;
  return String(n);
};

export const dateOnly = (ms: number) => new Date(ms).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });

export function periodLabel(p: string): string {
  const [y, m] = p.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('id-ID', { month: 'long', year: 'numeric' });
}

/** Bit per detik → teks: 12.4 Mbps */
export function bps(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)} Gbps`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)} Mbps`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(0)} Kbps`;
  return `${n} bps`;
}

/** Nomor HP Indonesia → format wa.me (62…). */
export function waNumber(phone: string): string {
  const d = phone.replace(/\D/g, '');
  if (d.startsWith('0')) return `62${d.slice(1)}`;
  return d;
}
