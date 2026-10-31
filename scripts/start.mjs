// Menjalankan Wifinate. Jika hasil build belum ada (mis. baru diunduh), build otomatis dulu.
// Bekerja di Windows, macOS, dan Linux.
import { spawnSync, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const serverEntry = join(root, 'server', 'dist', 'index.js');
const webIndex = join(root, 'web', 'dist', 'index.html');

const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 22 || (major === 22 && minor < 16)) {
  console.error(`\n❌ Wifinate butuh Node.js 22.16 atau lebih baru (terpasang: ${process.versions.node}). Unduh versi LTS di https://nodejs.org\n`);
  process.exit(1);
}

if (!existsSync(join(root, 'node_modules'))) {
  console.error('\n❌ Dependensi belum terpasang. Jalankan dulu:  npm install\n');
  process.exit(1);
}

if (!existsSync(serverEntry) || !existsSync(webIndex)) {
  console.log('\n🔨 Hasil build belum ada, membangun aplikasi (sekali saja, ±1 menit)...\n');
  const r = spawnSync('npm run build', { cwd: root, stdio: 'inherit', shell: true });
  if (r.status !== 0) {
    console.error('\n❌ Build gagal. Lihat pesan error di atas.\n');
    process.exit(r.status ?? 1);
  }
}

process.env.NODE_ENV ??= 'production';
const child = spawn(process.execPath, [serverEntry], { cwd: join(root, 'server'), stdio: 'inherit', env: process.env });
child.on('exit', (code) => process.exit(code ?? 0));
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => child.kill(sig));
