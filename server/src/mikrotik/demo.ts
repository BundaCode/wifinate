import type {
  ActiveSession, HotspotUserInput, HotspotUserStat, PppActive, PppSecret, RosCommand, RouterDriver, RouterInfo,
  RouterInterface, TrafficSample,
} from './types.js';

interface DemoUser extends HotspotUserInput { uptimeSec: number; bytes: number; online: boolean; mac: string; ip: string }

const states = new Map<number, Map<string, DemoUser>>();
const pppStates = new Map<number, Map<string, PppSecret & { online: boolean; since: number; ip: string }>>();

/** Contoh pelanggan PPPoE yang sudah ada di router demo (untuk mencoba fitur impor). */
const DEMO_SECRETS: PppSecret[] = [
  { name: 'budi-rumah', password: 'budi123', profile: 'paket-10M', service: 'pppoe', disabled: false, comment: 'Budi - Jl. Melati 3' },
  { name: 'warung-sari', password: 'sari456', profile: 'paket-20M', service: 'pppoe', disabled: false, comment: 'Warung Bu Sari' },
  { name: 'kos-anggrek', password: 'kos789', profile: 'paket-20M', service: 'pppoe', disabled: false, comment: 'Kos Anggrek lt.2' },
];

/**
 * Router simulasi: supaya pemilik usaha bisa mencoba semua fitur tanpa MikroTik asli.
 * Setiap kali ditanya, sebagian voucher "dipakai" pelanggan secara acak.
 */
export class DemoDriver implements RouterDriver {
  private users: Map<string, DemoUser>;
  private started = Date.now();

  private ppp: Map<string, PppSecret & { online: boolean; since: number; ip: string }>;
  private wave = Math.random() * 10;

  constructor(private routerId: number) {
    if (!states.has(routerId)) states.set(routerId, new Map());
    this.users = states.get(routerId)!;
    if (!pppStates.has(routerId)) {
      pppStates.set(routerId, new Map(DEMO_SECRETS.map((s, i) => [s.name, { ...s, online: true, since: Date.now() - (i + 1) * 3_600_000 * 7, ip: `172.16.0.${11 + i}` }])));
    }
    this.ppp = pppStates.get(routerId)!;
  }

  private tick() {
    for (const u of this.users.values()) {
      if (u.online) {
        u.uptimeSec += 30;
        u.bytes += Math.round(Math.random() * 30_000_000);
        if (Math.random() < 0.05) u.online = false;
      } else if (Math.random() < (u.uptimeSec === 0 ? 0.08 : 0.15)) {
        u.online = true;
      }
    }
  }

  seed(list: { name: string; password: string; uptimeSec: number }[]) {
    if (this.users.size) return;
    for (const u of list) {
      this.addOne({ name: u.name, password: u.password, profile: 'default' });
      this.users.get(u.name)!.uptimeSec = u.uptimeSec;
    }
  }

  private addOne(u: HotspotUserInput) {
    const n = this.users.size + 10;
    const hex = (x: number) => x.toString(16).padStart(2, '0').toUpperCase();
    this.users.set(u.name, {
      ...u, uptimeSec: 0, bytes: 0, online: false,
      mac: `AA:BB:CC:${hex((n >> 8) & 255)}:${hex(n & 255)}:01`,
      ip: `10.5.50.${(n % 240) + 10}`,
    });
  }

  async info(): Promise<RouterInfo> {
    const up = Math.floor((Date.now() - this.started) / 1000) + 3 * 86400;
    return {
      identity: 'Router-Demo', version: '7.16 (simulasi)', board: 'hAP ax2 (demo)',
      uptime: `${Math.floor(up / 86400)}d${Math.floor((up % 86400) / 3600)}h`,
      cpuLoad: 5 + Math.round(Math.random() * 20), freeMemory: 600e6, totalMemory: 1024e6,
    };
  }

  async interfaces(): Promise<RouterInterface[]> {
    return [
      { name: 'ether1', type: 'ether', running: true, disabled: false },
      { name: 'ether2', type: 'ether', running: true, disabled: false },
      { name: 'ether3', type: 'ether', running: false, disabled: false },
      { name: 'wlan1', type: 'wlan', running: true, disabled: false },
      { name: 'bridge-lan', type: 'bridge', running: true, disabled: false },
    ];
  }

  async upsertUserProfile() {}

  async addHotspotUsers(list: HotspotUserInput[]) {
    for (const u of list) this.addOne(u);
  }

  async removeHotspotUsers(names: string[]) { names.forEach((n) => this.users.delete(n)); }

  async kickActive(names: string[]) {
    names.forEach((n) => { const u = this.users.get(n); if (u) u.online = false; });
  }

  async hotspotUserStats(): Promise<HotspotUserStat[]> {
    this.tick();
    return [...this.users.values()].map((u) => ({
      name: u.name, uptimeSec: u.uptimeSec, bytesIn: Math.round(u.bytes * 0.1), bytesOut: Math.round(u.bytes * 0.9),
    }));
  }

  async activeSessions(): Promise<ActiveSession[]> {
    return [...this.users.values()].filter((u) => u.online).map((u) => ({
      user: u.name, address: u.ip, mac: u.mac, uptimeSec: u.uptimeSec,
      bytesIn: Math.round(u.bytes * 0.1), bytesOut: Math.round(u.bytes * 0.9), server: 'wifinate',
    }));
  }

  async pppActive(): Promise<PppActive[]> {
    return [...this.ppp.values()].filter((p) => p.online && !p.disabled).map((p) => ({
      name: p.name, service: 'pppoe', address: p.ip, callerId: `D4:6E:0E:00:${p.ip.split('.')[3].padStart(2, '0')}:01`,
      uptimeSec: Math.floor((Date.now() - p.since) / 1000),
    }));
  }

  async upsertPppProfile() {}

  async upsertPppSecret(sec: { name: string; password: string; profile: string; comment?: string; disabled?: boolean }) {
    const cur = this.ppp.get(sec.name);
    this.ppp.set(sec.name, {
      name: sec.name, password: sec.password, profile: sec.profile, service: 'pppoe', disabled: !!sec.disabled,
      comment: sec.comment ?? '', online: cur?.online ?? Math.random() < 0.8, since: cur?.since ?? Date.now(),
      ip: cur?.ip ?? `172.16.0.${20 + this.ppp.size}`,
    });
  }

  async setPppSecret(name: string, patch: { profile?: string; disabled?: boolean; password?: string }) {
    const cur = this.ppp.get(name);
    if (!cur) throw new Error(`Akun PPPoE "${name}" tidak ada di router`);
    Object.assign(cur, Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)));
  }

  async removePppSecret(name: string) { this.ppp.delete(name); }

  async kickPpp(name: string) {
    const cur = this.ppp.get(name);
    if (cur) { cur.since = Date.now(); cur.online = !cur.disabled; }
  }

  async pppSecrets(): Promise<PppSecret[]> {
    return [...this.ppp.values()].map(({ online: _o, since: _s, ip: _i, ...s }) => s);
  }

  async monitorTraffic(iface: string): Promise<TrafficSample> {
    this.wave += 0.35;
    const base = iface === 'ether1' ? 45e6 : 18e6;
    const rx = Math.max(0, base + Math.sin(this.wave) * base * 0.35 + (Math.random() - 0.5) * base * 0.4);
    const tx = Math.max(0, rx * (0.12 + Math.random() * 0.08));
    return { rx: Math.round(rx), tx: Math.round(tx) };
  }

  async backup() {}
  async apply(_cmds: RosCommand[]) {}
  async close() {}
}
