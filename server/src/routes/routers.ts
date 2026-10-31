import type { FastifyInstance } from 'fastify';
import { and, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '../db.js';
import { encrypt } from '../crypto.js';
import { createDriver, dropDriver, friendlyRouterError, getDriverById } from '../mikrotik/pool.js';
import { hotspotSetupSchema, planHotspot } from '../services/hotspotSetup.js';
import { syncRouter } from '../services/scheduler.js';
import { requireAdmin, requireAuth } from './auth.js';

const routerBody = z.object({
  name: z.string().min(1, 'Nama router wajib diisi'),
  host: z.string().min(1, 'Alamat IP wajib diisi'),
  port: z.coerce.number().int().min(1).max(65535).default(8728),
  username: z.string().min(1, 'Username wajib diisi'),
  password: z.string().default(''),
  useTls: z.boolean().default(false),
  isDemo: z.boolean().default(false),
});

function publicRouter(r: typeof schema.routers.$inferSelect) {
  const { passwordEnc: _omit, ...rest } = r;
  return rest;
}

export default async function routerRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAuth);

  app.get('/api/routers', async (req) => {
    const list = db.select().from(schema.routers).all();
    // Reseller cukup tahu nama router (untuk memilih lokasi voucher).
    if (req.user.role === 'reseller') return list.map((r) => ({ id: r.id, name: r.name }));
    return list.map(publicRouter);
  });

  /** Tes koneksi sebelum disimpan. */
  app.post('/api/routers/test', async (req, reply) => {
    const body = routerBody.parse(req.body);
    const driver = createDriver({ id: -1, ...body });
    try {
      const [info, interfaces] = await Promise.all([driver.info(), driver.interfaces()]);
      return { ok: true, info, interfaces };
    } catch (e) {
      return reply.code(400).send({ message: friendlyRouterError(e) });
    } finally {
      await driver.close();
    }
  });

  app.post('/api/routers', { preHandler: requireAdmin }, async (req) => {
    const body = routerBody.parse(req.body);
    const { password, ...rest } = body;
    const r = db.insert(schema.routers).values({ ...rest, passwordEnc: encrypt(password), createdAt: Date.now() }).returning().get();
    syncRouter(r).catch(() => {});
    return publicRouter(r);
  });

  app.put('/api/routers/:id', { preHandler: requireAdmin }, async (req) => {
    const id = Number((req.params as { id: string }).id);
    const body = routerBody.partial().parse(req.body);
    const { password, ...rest } = body;
    const patch: Partial<typeof schema.routers.$inferInsert> = { ...rest };
    if (password) patch.passwordEnc = encrypt(password);
    const r = db.update(schema.routers).set(patch).where(eq(schema.routers.id, id)).returning().get();
    dropDriver(id);
    return publicRouter(r);
  });

  app.delete('/api/routers/:id', { preHandler: requireAdmin }, async (req) => {
    const id = Number((req.params as { id: string }).id);
    dropDriver(id);
    db.delete(schema.routers).where(eq(schema.routers.id, id)).run();
    return { ok: true };
  });

  app.get('/api/routers/:id/info', async (req, reply) => {
    const { driver } = await getDriverById(Number((req.params as { id: string }).id));
    try {
      return await driver.info();
    } catch (e) {
      return reply.code(502).send({ message: friendlyRouterError(e) });
    }
  });

  app.get('/api/routers/:id/interfaces', async (req, reply) => {
    const { driver } = await getDriverById(Number((req.params as { id: string }).id));
    try {
      return await driver.interfaces();
    } catch (e) {
      return reply.code(502).send({ message: friendlyRouterError(e) });
    }
  });

  /** Monitoring: siapa saja yang sedang online (hotspot + PPPoE). */
  app.get('/api/routers/:id/active', async (req, reply) => {
    const { driver } = await getDriverById(Number((req.params as { id: string }).id));
    try {
      const [hotspot, ppp] = await Promise.all([driver.activeSessions(), driver.pppActive().catch(() => [])]);
      const codes = hotspot.map((h) => h.user);
      const meta = new Map(
        codes.length
          ? db.select({ code: schema.vouchers.code, packageName: schema.packages.name, color: schema.packages.color, expiresAt: schema.vouchers.expiresAt })
            .from(schema.vouchers).innerJoin(schema.packages, eq(schema.packages.id, schema.vouchers.packageId))
            .where(and(eq(schema.vouchers.routerId, Number((req.params as { id: string }).id)), inArray(schema.vouchers.code, codes)))
            .all().map((v) => [v.code, v])
          : [],
      );
      return { hotspot: hotspot.map((h) => ({ ...h, voucher: meta.get(h.user) ?? null })), ppp };
    } catch (e) {
      return reply.code(502).send({ message: friendlyRouterError(e) });
    }
  });

  /** Wizard hotspot: preview langkah-langkah (tidak mengubah router). */
  app.post('/api/routers/:id/hotspot/preview', { preHandler: requireAdmin }, async (req) => {
    const input = hotspotSetupSchema.parse(req.body);
    return { steps: planHotspot(input) };
  });

  /** Wizard hotspot: backup dulu, lalu terapkan. */
  app.post('/api/routers/:id/hotspot/apply', { preHandler: requireAdmin }, async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const input = hotspotSetupSchema.parse(req.body);
    const { driver } = await getDriverById(id);
    const steps = planHotspot(input);
    const backupName = `wifinate-sebelum-setup-${new Date().toISOString().slice(0, 10)}`;
    try {
      await driver.backup(backupName);
    } catch (e) {
      return reply.code(502).send({ message: `Gagal membuat backup, setting dibatalkan. ${friendlyRouterError(e)}` });
    }
    let done = 0;
    try {
      for (const step of steps) {
        await driver.apply([step]);
        done++;
      }
    } catch (e) {
      return reply.code(502).send({
        message: `Berhenti di langkah ${done + 1}: ${steps[done].description} — ${friendlyRouterError(e)}. Backup tersimpan di router dengan nama "${backupName}".`,
        done,
      });
    }
    db.update(schema.routers).set({ hotspotServer: input.hotspotName, dnsName: input.dnsName }).where(eq(schema.routers.id, id)).run();
    return { ok: true, backupName, done };
  });
}
