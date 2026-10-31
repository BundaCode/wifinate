import type {
  ActiveSession, HotspotUserInput, HotspotUserStat, PppActive, RosCommand, RouterDriver, RouterInfo, RouterInterface,
} from './types.js';

interface DemoUser extends HotspotUserInput { uptimeSec: number; bytes: number; online: boolean; mac: string; ip: string }

const states = new Map<number, Map<string, DemoUser>>();

/**
 * Router simulasi: supaya pemilik usaha bisa mencoba semua fitur tanpa MikroTik asli.
 * Setiap kali ditanya, sebagian voucher "dipakai" pelanggan secara acak.
 */
export class DemoDriver implements RouterDriver {
  private users: Map<string, DemoUser>;
  private started = Date.now();

  constructor(private routerId: number) {
    if (!states.has(routerId)) states.set(routerId, new Map());
    this.users = states.get(routerId)!;
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
    return [
      { name: 'budi-rumah', service: 'pppoe', address: '172.16.0.11', callerId: 'D4:6E:0E:11:22:33', uptimeSec: 86400 * 2 + 3600 },
      { name: 'warung-sari', service: 'pppoe', address: '172.16.0.12', callerId: 'D4:6E:0E:44:55:66', uptimeSec: 7200 },
    ];
  }

  async backup() {}
  async apply(_cmds: RosCommand[]) {}
  async close() {}
}
