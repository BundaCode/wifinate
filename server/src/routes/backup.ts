import fs from 'node:fs';
import type { FastifyInstance } from 'fastify';
import { backupFileName, backupPath, createBackupBuffer, listBackups, stageRestore } from '../services/backup.js';
import { requireAdmin, requireAuth } from './auth.js';

export default async function backupRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAuth);
  app.addHook('preHandler', requireAdmin);

  // File backup dikirim apa adanya (bukan JSON/multipart).
  app.addContentTypeParser('application/octet-stream', { parseAs: 'buffer', bodyLimit: 512 * 1024 * 1024 }, (_req, body, done) => done(null, body));

  app.get('/api/backups', async () => listBackups());

  /** Unduh backup terbaru saat ini juga. */
  app.get('/api/backups/now', async (_req, reply) =>
    reply.header('Content-Type', 'application/octet-stream')
      .header('Content-Disposition', `attachment; filename="${backupFileName().replace('.wifinate', `-${Date.now() % 100000}.wifinate`)}"`)
      .send(await createBackupBuffer()));

  /** Unduh salah satu backup otomatis. */
  app.get('/api/backups/file/:name', async (req, reply) => {
    const p = backupPath((req.params as { name: string }).name);
    if (!p) return reply.code(404).send({ message: 'Backup tidak ditemukan' });
    return reply.header('Content-Type', 'application/octet-stream')
      .header('Content-Disposition', `attachment; filename="${(req.params as { name: string }).name}"`)
      .send(fs.createReadStream(p));
  });

  /**
   * Pulihkan dari file backup. Data saat ini disimpan dulu di folder backups,
   * lalu aplikasi dinyalakan ulang agar database lama tidak sedang terbuka saat diganti.
   */
  app.post('/api/backups/restore', async (req, reply) => {
    if (!Buffer.isBuffer(req.body)) return reply.code(400).send({ message: 'Kirim file backup (.wifinate).' });
    const summary = stageRestore(req.body);
    reply.send({ ok: true, summary, message: 'Backup siap dipulihkan. Aplikasi dinyalakan ulang…' });
    app.log.warn('Pemulihan backup dijadwalkan, aplikasi akan restart.');
    // Docker (restart: unless-stopped) / systemd / pm2 akan menyalakan ulang otomatis.
    setTimeout(() => process.exit(0), 800);
  });

  /** Pulihkan dari backup otomatis yang ada di server. */
  app.post('/api/backups/file/:name/restore', async (req, reply) => {
    const p = backupPath((req.params as { name: string }).name);
    if (!p) return reply.code(404).send({ message: 'Backup tidak ditemukan' });
    const summary = stageRestore(fs.readFileSync(p));
    reply.send({ ok: true, summary, message: 'Backup siap dipulihkan. Aplikasi dinyalakan ulang…' });
    setTimeout(() => process.exit(0), 800);
  });
}
