import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '../db.js';
import type { RosCommand } from '../mikrotik/types.js';

export const LAN_LIST = 'wifinate-lan';
const rate = z.string().regex(/^\d+[kKmM]$/, 'Contoh: 10M').nullable();

export const divisionSchema = z.object({
  name: z.string().min(2, 'Nama divisi minimal 2 huruf').max(30),
  mode: z.enum(['port', 'vlan']),
  /** Mode port: port khusus divisi. Mode vlan: port trunk ke switch. */
  iface: z.string().min(1, 'Pilih port'),
  vlanId: z.coerce.number().int().min(2).max(4094).nullable().default(null),
  prefix: z.string().regex(/^(10|172|192)\.(\d{1,3})\.(\d{1,3})$/, 'Contoh: 192.168.10'),
  rateDown: rate.default(null),
  rateUp: rate.default(null),
  /** Tidak bisa mengakses jaringan divisi lain (cocok untuk tamu). */
  isolate: z.boolean().default(false),
});

export const lanSetupSchema = z.object({
  wanInterface: z.string().min(1),
  divisions: z.array(divisionSchema).min(1, 'Tambahkan minimal satu divisi').max(20),
});

export type Division = z.infer<typeof divisionSchema>;

export const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 20) || 'divisi';
export const commentOf = (slug: string) => `wifinate:lan:${slug}`;
const ifaceOf = (d: Division, slug: string) => (d.mode === 'vlan' ? `vlan${d.vlanId}-${slug}` : d.iface);

/** Validasi silang: subnet, VLAN, port tidak boleh bentrok dengan divisi lain/yang sudah ada. */
export function validateDivisions(routerId: number, list: Division[]): string | null {
  const existing = db.select().from(schema.lanNetworks).where(eq(schema.lanNetworks.routerId, routerId)).all();
  const all = [...existing.map((e) => ({ ...e, existing: true })), ...list.map((d) => ({ ...d, slug: slugify(d.name), existing: false }))];
  const seen = { prefix: new Map<string, string>(), vlan: new Map<string, string>(), port: new Map<string, string>(), slug: new Set<string>() };
  for (const d of all) {
    if (d.mode === 'vlan' && !d.vlanId) return `Divisi "${d.name}": isi nomor VLAN.`;
    if (seen.slug.has(d.slug)) return `Nama divisi "${d.name}" sudah dipakai.`;
    seen.slug.add(d.slug);
    if (seen.prefix.has(d.prefix)) return `Jaringan ${d.prefix}.x dipakai dua kali ("${seen.prefix.get(d.prefix)}" dan "${d.name}").`;
    seen.prefix.set(d.prefix, d.name);
    if (d.mode === 'vlan') {
      const k = `${d.iface}:${d.vlanId}`;
      if (seen.vlan.has(k)) return `VLAN ${d.vlanId} dipakai dua kali.`;
      seen.vlan.set(k, d.name);
    } else {
      if (seen.port.has(d.iface)) return `Port ${d.iface} dipakai dua divisi ("${seen.port.get(d.iface)}" dan "${d.name}"). Gunakan mode VLAN jika ingin berbagi port.`;
      seen.port.set(d.iface, d.name);
    }
  }
  return null;
}

function divisionCommands(d: Division): RosCommand[] {
  const slug = slugify(d.name);
  const tag = commentOf(slug);
  const iface = ifaceOf(d, slug);
  const p = d.prefix;
  const cmds: RosCommand[] = [];
  if (d.mode === 'vlan') {
    cmds.push({
      path: '/interface/vlan/add', params: { name: iface, 'vlan-id': String(d.vlanId), interface: d.iface, comment: tag },
      description: `[${d.name}] Membuat VLAN ${d.vlanId} di port ${d.iface} (switch harus diatur dengan VLAN yang sama).`,
    });
  }
  cmds.push(
    {
      path: '/ip/address/add', params: { address: `${p}.1/24`, interface: iface, comment: tag },
      description: `[${d.name}] Gateway ${p}.1 untuk jaringan divisi ini.`,
    },
    {
      path: '/ip/pool/add', params: { name: `lan-${slug}-pool`, ranges: `${p}.10-${p}.254`, comment: tag },
      description: `[${d.name}] Menyiapkan alamat ${p}.10 – ${p}.254 untuk komputer & HP karyawan.`,
    },
    {
      path: '/ip/dhcp-server/network/add', params: { address: `${p}.0/24`, gateway: `${p}.1`, 'dns-server': `${p}.1`, comment: tag },
      description: `[${d.name}] Gateway & DNS dibagikan otomatis.`,
    },
    {
      path: '/ip/dhcp-server/add', params: { name: `lan-${slug}`, interface: iface, 'address-pool': `lan-${slug}-pool`, 'lease-time': '1d', disabled: 'no', comment: tag },
      description: `[${d.name}] Menyalakan DHCP: perangkat langsung dapat IP saat dicolok/konek.`,
    },
    {
      path: '/ip/firewall/address-list/add', params: { list: LAN_LIST, address: `${p}.0/24`, comment: tag },
      description: `[${d.name}] Mendaftarkan jaringan ini sebagai jaringan kantor.`,
    },
  );
  if (d.rateDown || d.rateUp) {
    cmds.push({
      path: '/queue/simple/add',
      params: {
        name: `lan-${slug}`, target: `${p}.0/24`, 'max-limit': `${d.rateUp ?? '0'}/${d.rateDown ?? '0'}`,
        queue: 'pcq-upload-default/pcq-download-default', comment: tag,
      },
      description: `[${d.name}] Batas internet ↓${d.rateDown ?? 'bebas'} / ↑${d.rateUp ?? 'bebas'}, dibagi rata ke semua perangkat di divisi ini.`,
    });
  }
  if (d.isolate) {
    cmds.push({
      path: '/ip/firewall/filter/add',
      params: { chain: 'forward', 'src-address': `${p}.0/24`, 'dst-address-list': LAN_LIST, action: 'drop', comment: tag },
      description: `[${d.name}] Diisolasi: tidak bisa mengakses komputer/printer divisi lain, hanya internet.`,
    });
  }
  return cmds;
}

export function planLan(input: z.infer<typeof lanSetupSchema>, opts: { includeNat: boolean }): RosCommand[] {
  const cmds = input.divisions.flatMap(divisionCommands);
  cmds.push({ path: '/ip/dns/set', params: { 'allow-remote-requests': 'yes' }, description: 'Router menjawab DNS untuk semua divisi.' });
  if (opts.includeNat) {
    cmds.push({
      path: '/ip/firewall/nat/add',
      params: { chain: 'srcnat', action: 'masquerade', 'src-address-list': LAN_LIST, 'out-interface': input.wanInterface, comment: 'wifinate:lan' },
      description: `Semua jaringan kantor terhubung ke internet lewat ${input.wanInterface}.`,
    });
  }
  return cmds;
}

/** Urutan hapus dibalik dari urutan buat, supaya tidak ada yang masih dipakai. */
export const REMOVE_PATHS = [
  '/queue/simple', '/ip/firewall/filter', '/ip/firewall/address-list', '/ip/dhcp-server', '/ip/dhcp-server/network',
  '/ip/pool', '/ip/address', '/interface/vlan',
];

export function hasNat(routerId: number) {
  return !!db.select().from(schema.lanNetworks).where(eq(schema.lanNetworks.routerId, routerId)).get();
}

export function saveDivisions(routerId: number, list: Division[]) {
  const now = Date.now();
  for (const d of list) {
    db.insert(schema.lanNetworks).values({
      routerId, name: d.name, slug: slugify(d.name), mode: d.mode, iface: d.iface, vlanId: d.mode === 'vlan' ? d.vlanId : null,
      prefix: d.prefix, rateDown: d.rateDown, rateUp: d.rateUp, isolate: d.isolate, createdAt: now,
    }).run();
  }
}

export function getDivision(routerId: number, id: number) {
  return db.select().from(schema.lanNetworks).where(and(eq(schema.lanNetworks.routerId, routerId), eq(schema.lanNetworks.id, id))).get();
}

export function queueCommand(d: Pick<Division, 'rateDown' | 'rateUp' | 'prefix'> & { slug: string }): RosCommand {
  return divisionCommands({ ...d, name: d.slug, mode: 'port', iface: '', vlanId: null, isolate: false })
    .find((c) => c.path === '/queue/simple/add')!;
}
