import Fastify, { type FastifyInstance } from 'fastify';
import { and, eq, isNotNull } from 'drizzle-orm';
import { z } from 'zod';
import net from 'node:net';
import { db, schema } from '../db.js';
import { friendlyRouterError, getDriver, getDriverById } from '../mikrotik/pool.js';
import type { RosCommand } from '../mikrotik/types.js';
import { ISOLIR_LIST } from '../services/pppoe.js';
import { periodOf } from '../services/pppoe.js';
import { previewMikrotik, renderIsolirHtml, renderLoginHtml, type IsolirInfo } from '../services/pages.js';
import { getSettings, saveSettings } from '../services/settings.js';
import { requireAdmin, requireAuth } from './auth.js';

export const ISOLIR_PORT = Number(process.env.ISOLIR_PORT ?? 8081);

const serverUrlSchema = z.string().regex(/^https?:\/\/[^/\s]+\/?$/, 'Contoh: http://192.168.88.10:8080');

// ---------- Cari pelanggan berdasarkan IP (untuk halaman isolir) ----------
let pppCache: { at: number; map: Map<string, { routerId: number; name: string }> } | null = null;

async function pppByIp(): Promise<Map<string, { routerId: number; name: string }>> {
  if (pppCache && Date.now() - pppCache.at < 30_000) return pppCache.map;
  const map = new Map<string, { routerId: number; name: string }>();
  const routers = db.select().from(schema.routers).where(isNotNull(schema.routers.pppLocalAddress)).all();
  await Promise.allSettled(routers.map(async (r) => {
    for (const a of await getDriver(r).pppActive()) map.set(a.address, { routerId: r.id, name: a.name });
  }));
  pppCache = { at: Date.now(), map };
  return map;
}

export async function isolirInfoForIp(ip: string): Promise<IsolirInfo | null> {
  const clean = ip.replace(/^::ffff:/, '');
  const hit = (await pppByIp()).get(clean);
  if (!hit) return null;
  const c = db.select().from(schema.customers)
    .where(and(eq(schema.customers.routerId, hit.routerId), eq(schema.customers.username, hit.name))).get();
  if (!c) return null;
  const unpaid = db.select().from(schema.invoices)
    .where(and(eq(schema.invoices.customerId, c.id), eq(schema.invoices.status, 'unpaid'))).all();
  const fmt = (p: string) => { const [y, m] = p.split('-').map(Number); return new Date(y, m - 1, 1).toLocaleDateString('id-ID', { month: 'long', year: 'numeric' }); };
  return {
    name: c.name,
    amount: unpaid.reduce((a, b) => a + b.amount, 0),
    periods: (unpaid.length ? unpaid.map((i) => i.period) : [periodOf(c.nextDueAt)]).map(fmt),
  };
}

function planIsolirPage(serverHost: string): RosCommand[] {
  return [
    {
      path: '/ip/firewall/filter/add',
      params: {
        chain: 'forward', 'src-address-list': ISOLIR_LIST, 'dst-address': serverHost, protocol: 'tcp', 'dst-port': String(ISOLIR_PORT),
        action: 'accept', comment: 'wifinate:isolir izinkan halaman info', 'place-before': 'comment:wifinate:pppoe blokir isolir',
      },
      description: `Pelanggan terisolir tetap boleh membuka halaman info di ${serverHost}:${ISOLIR_PORT}.`,
    },
    {
      path: '/ip/firewall/nat/add',
      params: {
        chain: 'dstnat', 'src-address-list': ISOLIR_LIST, protocol: 'tcp', 'dst-port': '80', action: 'dst-nat',
        'to-addresses': serverHost, 'to-ports': String(ISOLIR_PORT), comment: 'wifinate:isolir arahkan ke halaman info',
      },
      description: 'Setiap kali pelanggan terisolir membuka website (http), diarahkan ke halaman “Tagihan belum dibayar”.',
    },
  ];
}

function hostOf(url: string): string {
  const host = new URL(url).hostname;
  if (!net.isIPv4(host)) {
    throw Object.assign(new Error('Untuk halaman isolir, alamat Wifinate harus berupa IP (mis. http://192.168.88.10:8080), bukan nama domain.'), { statusCode: 400 });
  }
  return host;
}

export default async function pageRoutes(app: FastifyInstance) {
  // ---------- Publik (diambil router / dibuka pelanggan) ----------
  app.get('/public/hotspot/login.html', async (_req, reply) =>
    reply.header('Content-Type', 'text/html; charset=utf-8').header('Cache-Control', 'no-store').send(renderLoginHtml()));

  app.get('/isolir', async (req, reply) =>
    reply.header('Content-Type', 'text/html; charset=utf-8').header('Cache-Control', 'no-store')
      .send(renderIsolirHtml(await isolirInfoForIp(req.ip).catch(() => null))));

  // ---------- Admin ----------
  app.register(async (admin) => {
    admin.addHook('preHandler', requireAuth);

    // Preview menerima pengaturan yang belum disimpan supaya bisa dilihat langsung saat mengetik.
    const draft = (body: unknown) => ({ ...getSettings(), ...(body && typeof body === 'object' ? body : {}) });

    admin.post('/api/pages/login/preview', async (req, reply) =>
      reply.header('Content-Type', 'text/html; charset=utf-8').send(previewMikrotik(renderLoginHtml(draft(req.body)))));

    admin.get('/api/pages/login/download', async (_req, reply) =>
      reply.header('Content-Type', 'text/html; charset=utf-8').header('Content-Disposition', 'attachment; filename="login.html"').send(renderLoginHtml()));

    admin.post('/api/pages/isolir/preview', async (req, reply) =>
      reply.header('Content-Type', 'text/html; charset=utf-8')
        .send(renderIsolirHtml({ name: 'Pak Budi', amount: 150000, periods: [new Date().toLocaleDateString('id-ID', { month: 'long', year: 'numeric' })] }, draft(req.body))));

    /** Router mengunduh login.html dari Wifinate dengan /tool/fetch. */
    admin.post('/api/routers/:id/login-page/install', { preHandler: requireAdmin }, async (req, reply) => {
      const { serverUrl } = z.object({ serverUrl: serverUrlSchema }).parse(req.body);
      const base = serverUrl.replace(/\/$/, '');
      saveSettings({ serverUrl: base });
      const { router, driver } = await getDriverById(Number((req.params as { id: string }).id));
      const dir = 'hotspot';
      try {
        await driver.apply([{
          path: '/tool/fetch', params: { url: `${base}/public/hotspot/login.html`, 'dst-path': `${dir}/login.html`, mode: base.startsWith('https') ? 'https' : 'http' },
          description: 'Mengunduh halaman login',
        }]);
      } catch (e) {
        return reply.code(502).send({
          message: `Router gagal mengunduh halaman dari ${base}. Pastikan router bisa menjangkau alamat itu. Detail: ${friendlyRouterError(e)}`,
        });
      }
      return { ok: true, path: `${dir}/login.html`, router: router.name };
    });

    admin.post('/api/routers/:id/isolir-page/preview', { preHandler: requireAdmin }, async (req) => {
      const { serverUrl } = z.object({ serverUrl: serverUrlSchema }).parse(req.body);
      return { steps: planIsolirPage(hostOf(serverUrl)), port: ISOLIR_PORT };
    });

    admin.post('/api/routers/:id/isolir-page/apply', { preHandler: requireAdmin }, async (req, reply) => {
      const { serverUrl } = z.object({ serverUrl: serverUrlSchema }).parse(req.body);
      const steps = planIsolirPage(hostOf(serverUrl));
      saveSettings({ serverUrl: serverUrl.replace(/\/$/, '') });
      const { driver } = await getDriverById(Number((req.params as { id: string }).id));
      try { await driver.apply(steps); } catch (e) {
        return reply.code(502).send({ message: friendlyRouterError(e) });
      }
      return { ok: true };
    });

    admin.get('/api/pages/server-url', async (req) => ({
      saved: getSettings().serverUrl,
      // Tebakan awal dari alamat yang sedang dipakai admin.
      guess: `${req.protocol}://${req.headers.host ?? ''}`,
    }));
  });
}

/**
 * Server kecil terpisah untuk halaman isolir: semua alamat (mis. http://google.com yang di-dst-nat router)
 * dijawab dengan halaman info tagihan. trustProxy dimatikan supaya IP pelanggan asli yang dipakai.
 */
export async function startIsolirServer(log: (m: string) => void) {
  const app = Fastify({ trustProxy: false });
  app.all('/*', async (req, reply) =>
    reply.header('Content-Type', 'text/html; charset=utf-8').header('Cache-Control', 'no-store')
      .send(renderIsolirHtml(await isolirInfoForIp(req.ip).catch(() => null))));
  try {
    await app.listen({ port: ISOLIR_PORT, host: '0.0.0.0' });
    log(`Halaman isolir siap di port ${ISOLIR_PORT}`);
  } catch (e) {
    log(`Halaman isolir tidak bisa berjalan di port ${ISOLIR_PORT}: ${(e as Error).message}`);
  }
}
