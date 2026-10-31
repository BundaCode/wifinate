import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import fastifyStatic from '@fastify/static';
import websocket from '@fastify/websocket';
import { ZodError } from 'zod';
import { APP_SECRET, HOST, IS_PROD, PORT } from './config.js';
import './db.js';
import authRoutes from './routes/auth.js';
import routerRoutes from './routes/routers.js';
import businessRoutes from './routes/business.js';
import pppoeRoutes, { trafficWs } from './routes/pppoe.js';
import pageRoutes, { startIsolirServer } from './routes/pages.js';
import lanRoutes from './routes/lan.js';
import { startScheduler } from './services/scheduler.js';

const app = Fastify({
  logger: { level: process.env.LOG_LEVEL ?? 'info' },
  trustProxy: true,
});

await app.register(cors, { origin: IS_PROD ? false : true });
await app.register(jwt, { secret: APP_SECRET.toString('hex') });
await app.register(websocket);

// Pesan error yang ramah: validasi form ditampilkan per isian.
app.setErrorHandler((err, _req, reply) => {
  if (err instanceof ZodError) {
    const first = err.issues[0];
    return reply.code(400).send({
      message: first?.message ?? 'Data yang diisi belum lengkap.',
      fields: Object.fromEntries(err.issues.map((i) => [i.path.join('.'), i.message])),
    });
  }
  const status = (err as { statusCode?: number }).statusCode ?? 500;
  if (status >= 500) app.log.error(err);
  return reply.code(status).send({ message: status >= 500 ? 'Terjadi kesalahan di server. Coba lagi sebentar.' : (err as Error).message });
});

app.get('/api/health', async () => ({ ok: true, time: Date.now() }));
await app.register(authRoutes);
await app.register(routerRoutes);
await app.register(businessRoutes);
await app.register(pppoeRoutes);
await app.register(trafficWs);
await app.register(pageRoutes);
await app.register(lanRoutes);

// Produksi: server sekaligus menyajikan tampilan web hasil build Vite.
const webDist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../web/dist');
if (fs.existsSync(webDist)) {
  await app.register(fastifyStatic, { root: webDist, wildcard: false, maxAge: '1h' });
  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith('/api/')) return reply.code(404).send({ message: 'Tidak ditemukan' });
    return reply.header('Cache-Control', 'no-cache').sendFile('index.html');
  });
}

startScheduler((m) => app.log.info(m));
await startIsolirServer((m) => app.log.info(m));

await app.listen({ port: PORT, host: HOST });
app.log.info(`Wifinate siap di http://localhost:${PORT}`);
