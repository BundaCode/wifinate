import { z } from 'zod';
import type { RosCommand } from '../mikrotik/types.js';

export const hotspotSetupSchema = z.object({
  /** Port tempat pelanggan terhubung, mis. ether2 / wlan1 / bridge. */
  lanInterface: z.string().min(1),
  /** Port yang terhubung ke internet (ISP), mis. ether1. */
  wanInterface: z.string().min(1),
  /** Jaringan pelanggan, 3 oktet pertama. Contoh: 10.5.50 → 10.5.50.0/24 */
  networkPrefix: z.string().regex(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/, 'Contoh format: 10.5.50'),
  dnsName: z.string().min(3).regex(/^[a-z0-9.-]+$/i, 'Hanya huruf, angka, titik, dan tanda minus'),
  hotspotName: z.string().min(2).regex(/^[a-z0-9_-]+$/i, 'Tanpa spasi'),
});

export type HotspotSetupInput = z.infer<typeof hotspotSetupSchema>;

/**
 * Menyusun daftar perintah untuk menyiapkan hotspot dari nol.
 * Setiap langkah punya penjelasan bahasa awam yang ditampilkan di preview sebelum diterapkan.
 */
export function planHotspot(i: HotspotSetupInput): RosCommand[] {
  const net = i.networkPrefix;
  const tag = `wifinate:${i.hotspotName}`;
  return [
    {
      path: '/ip/address/add',
      params: { address: `${net}.1/24`, interface: i.lanInterface, comment: tag },
      description: `Memberi alamat ${net}.1 pada port ${i.lanInterface} sebagai gerbang WiFi pelanggan.`,
    },
    {
      path: '/ip/pool/add',
      params: { name: `${i.hotspotName}-pool`, ranges: `${net}.10-${net}.254`, comment: tag },
      description: `Menyiapkan 245 alamat IP (${net}.10 – ${net}.254) untuk perangkat pelanggan.`,
    },
    {
      path: '/ip/dhcp-server/network/add',
      params: { address: `${net}.0/24`, gateway: `${net}.1`, 'dns-server': `${net}.1`, comment: tag },
      description: 'Mengatur gateway & DNS yang dibagikan otomatis ke HP/laptop pelanggan.',
    },
    {
      path: '/ip/dhcp-server/add',
      params: { name: `${i.hotspotName}-dhcp`, interface: i.lanInterface, 'address-pool': `${i.hotspotName}-pool`, 'lease-time': '1h', disabled: 'no' },
      description: 'Menyalakan DHCP agar perangkat pelanggan langsung dapat IP saat konek WiFi.',
    },
    {
      path: '/ip/dns/set',
      params: { 'allow-remote-requests': 'yes' },
      description: 'Mengizinkan router menjawab DNS supaya halaman login bisa muncul.',
    },
    {
      path: '/ip/hotspot/profile/add',
      params: {
        name: `${i.hotspotName}-profile`, 'hotspot-address': `${net}.1`, 'dns-name': i.dnsName,
        'login-by': 'http-chap,http-pap,cookie', 'html-directory': 'hotspot',
      },
      description: `Membuat halaman login di alamat http://${i.dnsName}.`,
    },
    {
      path: '/ip/hotspot/add',
      params: {
        name: i.hotspotName, interface: i.lanInterface, 'address-pool': `${i.hotspotName}-pool`,
        profile: `${i.hotspotName}-profile`, disabled: 'no',
      },
      description: `Menyalakan hotspot "${i.hotspotName}". Pelanggan wajib login voucher sebelum bisa internetan.`,
    },
    {
      path: '/ip/firewall/nat/add',
      params: { chain: 'srcnat', action: 'masquerade', 'out-interface': i.wanInterface, comment: tag },
      description: `Menyambungkan pelanggan ke internet lewat port ${i.wanInterface}.`,
    },
  ];
}
