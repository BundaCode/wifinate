import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '../db.js';
import { friendlyRouterError, getDriverById } from '../mikrotik/pool.js';
import {
  commentOf, getDivision, hasNat, lanSetupSchema, planLan, queueCommand, REMOVE_PATHS, saveDivisions, slugify, validateDivisions,
} from '../services/lan.js';
import { requireAdmin, requireAuth } from './auth.js';

const rid = (req: { params: unknown }) => Number((req.params as { id: string }).id);

async function removeDivisionFromRouter(routerId: number, slug: string) {
  const { driver } = await getDriverById(routerId);
  let n = 0;
  for (const p of REMOVE_PATHS) n += await driver.removeByComment(p, commentOf(slug));
  return n;
}

export default async function lanRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAuth);
  app.addHook('preHandler', requireAdmin);

  /** Daftar divisi + pemakaian internet live (dari simple queue). */
  app.get('/api/routers/:id/lan', async (req) => {
    const routerId = rid(req);
    const list = db.select().from(schema.lanNetworks).where(eq(schema.lanNetworks.routerId, routerId)).orderBy(schema.lanNetworks.id).all();
    let stats: Awaited<ReturnType<Awaited<ReturnType<typeof getDriverById>>['driver']['queueStats']>> = [];
    let error: string | null = null;
    if (list.length) {
      try { stats = await (await getDriverById(routerId)).driver.queueStats(); } catch (e) { error = friendlyRouterError(e); }
    }
    const byName = new Map(stats.map((s) => [s.name, s]));
    return {
      error,
      divisions: list.map((d) => ({ ...d, stats: byName.get(`lan-${d.slug}`) ?? null })),
    };
  });

  app.post('/api/routers/:id/lan/preview', async (req, reply) => {
    const routerId = rid(req);
    const input = lanSetupSchema.parse(req.body);
    const err = validateDivisions(routerId, input.divisions);
    if (err) return reply.code(400).send({ message: err });
    return { steps: planLan(input, { includeNat: !hasNat(routerId) }) };
  });

  app.post('/api/routers/:id/lan/apply', async (req, reply) => {
    const routerId = rid(req);
    const input = lanSetupSchema.parse(req.body);
    const err = validateDivisions(routerId, input.divisions);
    if (err) return reply.code(400).send({ message: err });
    const { driver } = await getDriverById(routerId);
    const steps = planLan(input, { includeNat: !hasNat(routerId) });
    const backupName = `wifinate-sebelum-lan-${new Date().toISOString().slice(0, 10)}`;
    try { await driver.backup(backupName); } catch (e) {
      return reply.code(502).send({ message: `Gagal membuat backup, setting dibatalkan. ${friendlyRouterError(e)}` });
    }
    let done = 0;
    try {
      for (const s of steps) { await driver.apply([s]); done++; }
    } catch (e) {
      // Batalkan otomatis: hapus semua yang sudah sempat dibuat untuk divisi-divisi ini.
      let rolledBack = true;
      for (const d of input.divisions) {
        try { await removeDivisionFromRouter(routerId, slugify(d.name)); } catch { rolledBack = false; }
      }
      return reply.code(502).send({
        message: `Gagal di langkah ${done + 1}: ${steps[done].description} — ${friendlyRouterError(e)}. ${rolledBack
          ? 'Perubahan sudah dibatalkan otomatis, router kembali seperti semula.'
          : `Sebagian perubahan mungkin tertinggal. Backup tersimpan: "${backupName}".`}`,
      });
    }
    saveDivisions(routerId, input.divisions);
    return { ok: true, backupName };
  });

  /** Ubah batas bandwidth divisi. */
  app.put('/api/routers/:id/lan/:lanId', async (req, reply) => {
    const routerId = rid(req);
    const d = getDivision(routerId, Number((req.params as { lanId: string }).lanId));
    if (!d) return reply.code(404).send({ message: 'Divisi tidak ditemukan' });
    const body = z.object({
      rateDown: z.string().regex(/^\d+[kKmM]$/, 'Contoh: 10M').nullable(),
      rateUp: z.string().regex(/^\d+[kKmM]$/, 'Contoh: 5M').nullable(),
    }).parse(req.body);
    const { driver } = await getDriverById(routerId);
    try {
      await driver.removeByComment('/queue/simple', commentOf(d.slug));
      if (body.rateDown || body.rateUp) await driver.apply([queueCommand({ ...body, prefix: d.prefix, slug: d.slug })]);
    } catch (e) {
      return reply.code(502).send({ message: friendlyRouterError(e) });
    }
    return db.update(schema.lanNetworks).set(body).where(eq(schema.lanNetworks.id, d.id)).returning().get();
  });

  /** Hapus divisi: semua setting di router yang ditandai untuk divisi ini ikut dihapus. */
  app.delete('/api/routers/:id/lan/:lanId', async (req, reply) => {
    const routerId = rid(req);
    const d = getDivision(routerId, Number((req.params as { lanId: string }).lanId));
    if (!d) return reply.code(404).send({ message: 'Divisi tidak ditemukan' });
    try {
      const removed = await removeDivisionFromRouter(routerId, d.slug);
      db.delete(schema.lanNetworks).where(eq(schema.lanNetworks.id, d.id)).run();
      return { ok: true, removed };
    } catch (e) {
      return reply.code(502).send({ message: friendlyRouterError(e) });
    }
  });
}
