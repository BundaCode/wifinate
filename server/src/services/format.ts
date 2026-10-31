/** Menit → teks Indonesia yang mudah dibaca: 90 → "1 jam 30 menit", 1440 → "1 hari". */
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

/** Menit → format durasi MikroTik: 90 → "1h30m". */
export function rosMinutes(min: number): string {
  const d = Math.floor(min / 1440);
  const h = Math.floor((min % 1440) / 60);
  const m = min % 60;
  return `${d ? `${d}d` : ''}${h ? `${h}h` : ''}${m ? `${m}m` : ''}` || '0s';
}

export function rupiah(n: number): string {
  return `Rp${n.toLocaleString('id-ID')}`;
}

export function rateLimit(down?: string | null, up?: string | null): string | undefined {
  if (!down && !up) return undefined;
  // Format MikroTik: upload/download (dari sisi router: rx/tx)
  return `${up || '0'}/${down || '0'}`;
}

/** Nama profil di MikroTik untuk paket tertentu. */
export function profileName(pkg: { id: number }): string {
  return `wifinate-p${pkg.id}`;
}
