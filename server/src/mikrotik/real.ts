import { RouterOSAPI } from 'node-routeros';
import type {
  ActiveSession, HotspotUserInput, HotspotUserStat, PppActive, PppProfileInput, PppSecret, RosCommand, RouterDriver, RouterInfo,
  RouterInterface, TrafficSample, QueueStat,
} from './types.js';

type Row = Record<string, string>;

/** Mengubah durasi MikroTik (contoh: "1w2d3h4m5s") menjadi detik. */
export function parseRosDuration(s: string | undefined): number {
  if (!s) return 0;
  const units: Record<string, number> = { w: 604800, d: 86400, h: 3600, m: 60, s: 1 };
  let total = 0;
  // Format lama "01:02:03"
  if (s.includes(':')) {
    const parts = s.split(':').map(Number);
    while (parts.length < 3) parts.unshift(0);
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  }
  for (const m of s.matchAll(/(\d+)([wdhms])/g)) total += Number(m[1]) * units[m[2]];
  return total;
}

function toParams(params: Record<string, string>): string[] {
  return Object.entries(params).map(([k, v]) => `=${k}=${v}`);
}

export class RealDriver implements RouterDriver {
  private api: RouterOSAPI;
  private ready: Promise<unknown> | null = null;

  constructor(opts: { host: string; port: number; user: string; password: string; tls: boolean }) {
    this.api = new RouterOSAPI({
      host: opts.host,
      port: opts.port,
      user: opts.user,
      password: opts.password,
      timeout: 10,
      keepalive: true,
      ...(opts.tls ? { tls: { rejectUnauthorized: false } } : {}),
    });
    // Jangan sampai error koneksi membuat proses server berhenti.
    this.api.on('error', () => { this.ready = null; });
    this.api.on('close', () => { this.ready = null; });
  }

  private async conn(): Promise<RouterOSAPI> {
    if (!this.api.connected) {
      this.ready ??= this.api.connect().catch((e) => { this.ready = null; throw e; });
      await this.ready;
    }
    return this.api;
  }

  private async run(path: string, params: Record<string, string> | string[] = {}): Promise<Row[]> {
    const api = await this.conn();
    const p = Array.isArray(params) ? params : toParams(params);
    return (await api.write(path, p)) as unknown as Row[];
  }

  async info(): Promise<RouterInfo> {
    const [res] = await this.run('/system/resource/print');
    const [id] = await this.run('/system/identity/print');
    return {
      identity: id?.name ?? '',
      version: res?.version ?? '',
      board: res?.['board-name'] ?? '',
      uptime: res?.uptime ?? '',
      cpuLoad: Number(res?.['cpu-load'] ?? 0),
      freeMemory: Number(res?.['free-memory'] ?? 0),
      totalMemory: Number(res?.['total-memory'] ?? 0),
    };
  }

  async interfaces(): Promise<RouterInterface[]> {
    const rows = await this.run('/interface/print');
    return rows.map((r) => ({
      name: r.name, type: r.type, running: r.running === 'true', disabled: r.disabled === 'true',
    }));
  }

  async upsertUserProfile(p: { name: string; rateLimit?: string; sharedUsers: number }) {
    const existing = await this.run('/ip/hotspot/user/profile/print', [`?name=${p.name}`]);
    const params: Record<string, string> = {
      'shared-users': String(p.sharedUsers),
      'rate-limit': p.rateLimit ?? '',
    };
    if (existing[0]) await this.run('/ip/hotspot/user/profile/set', { '.id': existing[0]['.id'], ...params });
    else await this.run('/ip/hotspot/user/profile/add', { name: p.name, ...params });
  }

  async addHotspotUsers(users: HotspotUserInput[]) {
    const api = await this.conn();
    // Kirim paralel per kelompok kecil: jauh lebih cepat daripada satu per satu.
    const CHUNK = 25;
    for (let i = 0; i < users.length; i += CHUNK) {
      await Promise.all(users.slice(i, i + CHUNK).map((u) => {
        const params: Record<string, string> = { name: u.name, password: u.password, profile: u.profile };
        if (u.limitUptime) params['limit-uptime'] = u.limitUptime;
        if (u.limitBytesTotal) params['limit-bytes-total'] = String(u.limitBytesTotal);
        if (u.comment) params.comment = u.comment;
        return api.write('/ip/hotspot/user/add', toParams(params));
      }));
    }
  }

  async removeHotspotUsers(names: string[]) {
    if (!names.length) return;
    const wanted = new Set(names);
    const rows = await this.run('/ip/hotspot/user/print', ['=.proplist=.id,name']);
    const ids = rows.filter((r) => wanted.has(r.name)).map((r) => r['.id']);
    for (let i = 0; i < ids.length; i += 50) {
      await this.run('/ip/hotspot/user/remove', { '.id': ids.slice(i, i + 50).join(',') });
    }
  }

  async kickActive(names: string[]) {
    if (!names.length) return;
    const wanted = new Set(names);
    const rows = await this.run('/ip/hotspot/active/print', ['=.proplist=.id,user']);
    const ids = rows.filter((r) => wanted.has(r.user)).map((r) => r['.id']);
    if (ids.length) await this.run('/ip/hotspot/active/remove', { '.id': ids.join(',') });
  }

  async hotspotUserStats(): Promise<HotspotUserStat[]> {
    const rows = await this.run('/ip/hotspot/user/print', ['=.proplist=name,uptime,bytes-in,bytes-out']);
    return rows.map((r) => ({
      name: r.name,
      uptimeSec: parseRosDuration(r.uptime),
      bytesIn: Number(r['bytes-in'] ?? 0),
      bytesOut: Number(r['bytes-out'] ?? 0),
    }));
  }

  async activeSessions(): Promise<ActiveSession[]> {
    const rows = await this.run('/ip/hotspot/active/print');
    return rows.map((r) => ({
      user: r.user,
      address: r.address,
      mac: r['mac-address'],
      uptimeSec: parseRosDuration(r.uptime),
      bytesIn: Number(r['bytes-in'] ?? 0),
      bytesOut: Number(r['bytes-out'] ?? 0),
      server: r.server,
    }));
  }

  async pppActive(): Promise<PppActive[]> {
    const rows = await this.run('/ppp/active/print');
    return rows.map((r) => ({
      name: r.name, service: r.service, address: r.address, callerId: r['caller-id'], uptimeSec: parseRosDuration(r.uptime),
    }));
  }

  async upsertPppProfile(p: PppProfileInput) {
    const existing = await this.run('/ppp/profile/print', [`?name=${p.name}`]);
    const params: Record<string, string> = { 'rate-limit': p.rateLimit ?? '' };
    if (p.localAddress) params['local-address'] = p.localAddress;
    if (p.remoteAddress) params['remote-address'] = p.remoteAddress;
    if (p.addressList !== undefined) params['address-list'] = p.addressList;
    if (existing[0]) await this.run('/ppp/profile/set', { '.id': existing[0]['.id'], ...params });
    else await this.run('/ppp/profile/add', { name: p.name, ...params });
  }

  private async secretId(name: string): Promise<string | undefined> {
    const rows = await this.run('/ppp/secret/print', [`?name=${name}`, '=.proplist=.id']);
    return rows[0]?.['.id'];
  }

  async upsertPppSecret(sec: { name: string; password: string; profile: string; comment?: string; disabled?: boolean }) {
    const params: Record<string, string> = {
      password: sec.password, profile: sec.profile, service: 'pppoe', disabled: sec.disabled ? 'yes' : 'no',
    };
    if (sec.comment) params.comment = sec.comment;
    const id = await this.secretId(sec.name);
    if (id) await this.run('/ppp/secret/set', { '.id': id, ...params });
    else await this.run('/ppp/secret/add', { name: sec.name, ...params });
  }

  async setPppSecret(name: string, patch: { profile?: string; disabled?: boolean; password?: string }) {
    const id = await this.secretId(name);
    if (!id) throw new Error(`Akun PPPoE "${name}" tidak ada di router`);
    const params: Record<string, string> = {};
    if (patch.profile) params.profile = patch.profile;
    if (patch.password) params.password = patch.password;
    if (patch.disabled !== undefined) params.disabled = patch.disabled ? 'yes' : 'no';
    await this.run('/ppp/secret/set', { '.id': id, ...params });
  }

  async removePppSecret(name: string) {
    const id = await this.secretId(name);
    if (id) await this.run('/ppp/secret/remove', { '.id': id });
  }

  async kickPpp(name: string) {
    const rows = await this.run('/ppp/active/print', [`?name=${name}`, '=.proplist=.id']);
    if (rows.length) await this.run('/ppp/active/remove', { '.id': rows.map((r) => r['.id']).join(',') });
  }

  async pppSecrets(): Promise<PppSecret[]> {
    const rows = await this.run('/ppp/secret/print');
    return rows.map((r) => ({
      name: r.name, password: r.password ?? '', profile: r.profile ?? 'default', service: r.service ?? 'any',
      disabled: r.disabled === 'true', comment: r.comment ?? '',
    }));
  }

  async monitorTraffic(iface: string): Promise<TrafficSample> {
    const [r] = await this.run('/interface/monitor-traffic', [`=interface=${iface}`, '=once=']);
    return { rx: Number(r?.['rx-bits-per-second'] ?? 0), tx: Number(r?.['tx-bits-per-second'] ?? 0) };
  }

  async queueStats(): Promise<QueueStat[]> {
    const rows = await this.run('/queue/simple/print', ['=.proplist=name,target,rate,bytes,max-limit']);
    const pair = (v?: string) => (v ?? '0/0').split('/').map(Number);
    return rows.map((r) => {
      const [ru, rd] = pair(r.rate);
      const [bu, bd] = pair(r.bytes);
      return { name: r.name, target: r.target, rateUp: ru, rateDown: rd, bytesUp: bu, bytesDown: bd, maxLimit: r['max-limit'] ?? '' };
    });
  }

  async removeByComment(path: string, comment: string): Promise<number> {
    const rows = await this.run(`${path}/print`, [`?comment=${comment}`, '=.proplist=.id']);
    if (rows.length) await this.run(`${path}/remove`, { '.id': rows.map((r) => r['.id']).join(',') });
    return rows.length;
  }

  async backup(name: string) {
    await this.run('/system/backup/save', { name, 'dont-encrypt': 'yes' });
  }

  async apply(cmds: RosCommand[]) {
    for (const c of cmds) {
      const params = { ...c.params };
      // "place-before=comment:<teks>" → cari aturan dengan komentar itu agar urutan firewall benar.
      const pb = params['place-before'];
      if (pb?.startsWith('comment:')) {
        const base = c.path.replace(/\/add$/, '');
        const rows = await this.run(`${base}/print`, [`?comment=${pb.slice(8)}`, '=.proplist=.id']);
        if (rows[0]) params['place-before'] = rows[0]['.id'];
        else delete params['place-before'];
      }
      await this.run(c.path, params);
    }
  }

  async close() {
    try { await this.api.close(); } catch { /* sudah tertutup */ }
  }
}
