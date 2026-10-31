export interface RouterInfo {
  identity: string;
  version: string;
  board: string;
  uptime: string;
  cpuLoad: number;
  freeMemory: number;
  totalMemory: number;
}

export interface RouterInterface {
  name: string;
  type: string;
  running: boolean;
  disabled: boolean;
}

export interface HotspotUserInput {
  name: string;
  password: string;
  profile: string;
  limitUptime?: string;
  limitBytesTotal?: number;
  comment?: string;
}

export interface HotspotUserStat {
  name: string;
  uptimeSec: number;
  bytesIn: number;
  bytesOut: number;
}

export interface ActiveSession {
  user: string;
  address: string;
  mac: string;
  uptimeSec: number;
  bytesIn: number;
  bytesOut: number;
  server: string;
}

export interface PppActive {
  name: string;
  service: string;
  address: string;
  callerId: string;
  uptimeSec: number;
}

export interface PppSecret {
  name: string;
  password: string;
  profile: string;
  service: string;
  disabled: boolean;
  comment: string;
}

export interface PppProfileInput {
  name: string;
  rateLimit?: string;
  localAddress?: string | null;
  remoteAddress?: string | null;
  addressList?: string;
}

export interface TrafficSample { rx: number; tx: number }

export interface QueueStat {
  name: string;
  target: string;
  /** bit/detik */
  rateUp: number;
  rateDown: number;
  bytesUp: number;
  bytesDown: number;
  maxLimit: string;
}

/** Satu perintah RouterOS beserta penjelasan untuk orang awam. */
export interface RosCommand {
  path: string; // contoh: /ip/address/add
  params: Record<string, string>;
  description: string;
}

export interface RouterDriver {
  info(): Promise<RouterInfo>;
  interfaces(): Promise<RouterInterface[]>;
  upsertUserProfile(p: { name: string; rateLimit?: string; sharedUsers: number }): Promise<void>;
  addHotspotUsers(users: HotspotUserInput[]): Promise<void>;
  removeHotspotUsers(names: string[]): Promise<void>;
  kickActive(names: string[]): Promise<void>;
  hotspotUserStats(): Promise<HotspotUserStat[]>;
  activeSessions(): Promise<ActiveSession[]>;
  pppActive(): Promise<PppActive[]>;
  upsertPppProfile(p: PppProfileInput): Promise<void>;
  upsertPppSecret(s: { name: string; password: string; profile: string; comment?: string; disabled?: boolean }): Promise<void>;
  setPppSecret(name: string, patch: { profile?: string; disabled?: boolean; password?: string }): Promise<void>;
  removePppSecret(name: string): Promise<void>;
  kickPpp(name: string): Promise<void>;
  pppSecrets(): Promise<PppSecret[]>;
  /** Kecepatan trafik saat ini pada interface (bit per detik). */
  monitorTraffic(iface: string): Promise<TrafficSample>;
  queueStats(): Promise<QueueStat[]>;
  /** Hapus semua item pada path (mis. /ip/address) yang komentarnya persis sama. */
  removeByComment(path: string, comment: string): Promise<number>;
  backup(name: string): Promise<void>;
  apply(cmds: RosCommand[]): Promise<void>;
  close(): Promise<void>;
}
