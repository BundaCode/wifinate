import { and, eq, inArray } from 'drizzle-orm';
import { db, schema } from '../db.js';
import { decrypt } from '../crypto.js';
import { DemoDriver } from './demo.js';
import { RealDriver } from './real.js';
import type { RouterDriver } from './types.js';

type RouterRow = typeof schema.routers.$inferSelect;

/** Koneksi ke router dibiarkan terbuka & dipakai ulang supaya setiap perintah langsung jalan. */
const drivers = new Map<number, { driver: RouterDriver; key: string }>();

function keyOf(r: RouterRow) {
  return [r.host, r.port, r.username, r.passwordEnc, r.useTls, r.isDemo].join('|');
}

export function createDriver(r: Pick<RouterRow, 'id' | 'host' | 'port' | 'username' | 'useTls' | 'isDemo'> & { password: string }): RouterDriver {
  if (r.isDemo) return new DemoDriver(r.id);
  return new RealDriver({ host: r.host, port: r.port, user: r.username, password: r.password, tls: r.useTls });
}

export function getDriver(r: RouterRow): RouterDriver {
  const key = keyOf(r);
  const cached = drivers.get(r.id);
  if (cached && cached.key === key) return cached.driver;
  cached?.driver.close();
  const driver = createDriver({ ...r, password: decrypt(r.passwordEnc) });
  if (driver instanceof DemoDriver) {
    // Router demo hidup di memori: isi ulang dengan voucher yang masih berlaku setelah server restart.
    const rows = db.select().from(schema.vouchers)
      .where(and(eq(schema.vouchers.routerId, r.id), inArray(schema.vouchers.status, ['new', 'active']))).all();
    driver.seed(rows.map((v) => ({ name: v.code, password: v.password, uptimeSec: v.uptimeSec })));
    const lan = db.select().from(schema.lanNetworks).where(eq(schema.lanNetworks.routerId, r.id)).all();
    driver.apply(lan.filter((d) => d.rateDown || d.rateUp).map((d) => ({
      path: '/queue/simple/add', description: '',
      params: { name: `lan-${d.slug}`, target: `${d.prefix}.0/24`, 'max-limit': `${d.rateUp ?? '0'}/${d.rateDown ?? '0'}`, comment: `wifinate:lan:${d.slug}` },
    })));
  }
  drivers.set(r.id, { driver, key });
  return driver;
}

export async function getDriverById(id: number): Promise<{ router: RouterRow; driver: RouterDriver }> {
  const router = db.select().from(schema.routers).where(eq(schema.routers.id, id)).get();
  if (!router) throw Object.assign(new Error('Router tidak ditemukan'), { statusCode: 404 });
  return { router, driver: getDriver(router) };
}

export function dropDriver(id: number) {
  drivers.get(id)?.driver.close();
  drivers.delete(id);
}

/** Mengubah error teknis menjadi pesan yang mudah dipahami. */
export function friendlyRouterError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  const errno = (e as { errno?: string })?.errno ?? '';
  if (/ECONNREFUSED/.test(msg + errno)) return 'Router menolak koneksi. Pastikan layanan API aktif (IP → Services → api, port 8728).';
  if (/ETIMEDOUT|EHOSTUNREACH|ENETUNREACH|timed? ?out/i.test(msg + errno)) return 'Router tidak bisa dihubungi. Periksa kabel/jaringan dan pastikan alamat IP benar.';
  if (/ENOTFOUND/.test(msg + errno)) return 'Alamat router tidak dikenal. Periksa kembali penulisan IP atau nama domain.';
  if (/cannot log in|invalid user|password/i.test(msg)) return 'Username atau password router salah.';
  if (/already have/i.test(msg)) return 'Data dengan nama yang sama sudah ada di router.';
  return `Router membalas: ${msg}`;
}
