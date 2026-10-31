# Wifinate

Aplikasi web untuk mengelola **bisnis WiFi voucher (hotspot) & PPPoE MikroTik**. Dibuat supaya **orang awam** pun bisa menjalankan usaha WiFi tanpa harus paham setting MikroTik.

> Mirip Mikhmon, tapi lebih lengkap: wizard setup hotspot, masa aktif voucher diurus otomatis oleh server, laporan penjualan dengan grafik & filter, mode gelap, dan nyaman dipakai di HP.

## Fitur

| Fitur | Keterangan |
|---|---|
| 🧙 **Wizard setup hotspot** | Pilih port internet & port pelanggan → preview langkah dalam bahasa awam → **backup otomatis** → terapkan. |
| 📦 **Paket harga** | Harga, masa aktif, batas pemakaian, kecepatan, jumlah perangkat, kuota. Pilihan cepat (1 jam, 3 jam, 1 hari, …). |
| 🎟️ **Generate voucher** | Ratusan voucher sekaligus, langsung dikirim ke router secara paralel. Kode tanpa karakter membingungkan (0/O, 1/I). |
| 🖨️ **Cetak PDF** | Kartu voucher A4 (3–5 kolom) dengan nama usaha, harga, masa aktif & **QR code login otomatis**. |
| ⏱️ **Masa aktif otomatis** | Server memantau login pertama, menghitung masa aktif, lalu menghapus & memutus voucher yang habis. |
| 📊 **Laporan penjualan** | Gabungan voucher & PPPoE (bisa dipisah). Filter periode (hari ini, 7/30 hari, bulan ini/lalu, tahun ini, tanggal bebas), router, paket. Grafik pendapatan, per paket, **jam ramai**, perbandingan periode sebelumnya, ekspor Excel (CSV) & cetak. |
| 👤 **Pelanggan PPPoE** | Paket bulanan, data pelanggan, akun PPPoE langsung dibuat di router, **impor akun yang sudah ada** dari MikroTik. |
| 🧾 **Tagihan otomatis** | Tagihan bulan berikutnya dibuat H-7 jatuh tempo, terima pembayaran (tunai/transfer/QRIS), bayar di muka, riwayat tagihan, **pengingat WhatsApp** sekali klik. |
| 🔒 **Isolir otomatis** | Pelanggan yang telat bayar melewati masa toleransi otomatis diisolir (internet diblokir), dan **aktif kembali otomatis saat lunas**. |
| 🎨 **Halaman login hotspot** | Desain modern (judul, sapaan, warna, daftar harga otomatis, tombol beli via WA) dengan preview langsung, dipasang ke router sekali klik. |
| 🚫 **Halaman isolir** | Pelanggan terisolir yang membuka website melihat **nama, jumlah tagihan, dan cara bayar** + tombol WA. |
| 🧙 **Wizard server PPPoE** | Pool IP, profil, server PPPoE, profil & firewall isolir, NAT — dengan preview & backup otomatis. |
| 📡 **Monitor** | **Grafik trafik live** per port (WebSocket, tiap detik), pelanggan hotspot & PPPoE yang sedang online. |
| 👥 **Multi pengguna** | Admin (akses penuh) & kasir (buat/cetak voucher, terima pembayaran). |
| 🧪 **Router demo** | Coba semua fitur tanpa MikroTik asli. |

Rencana tahap berikutnya ada di [docs/SKENARIO.md](docs/SKENARIO.md).

## Teknologi

- **Frontend:** Vite + React + TypeScript, Tailwind CSS, TanStack Query, Recharts
- **Backend:** Node.js + Fastify + TypeScript
- **Database:** SQLite (mode WAL) + Drizzle ORM
- **MikroTik:** RouterOS API (port 8728 / API-SSL 8729)

## Menjalankan

### Cara paling mudah: Docker

```bash
docker compose up -d --build
```

Buka `http://IP-SERVER:8080`, lalu buat akun pemilik. Data tersimpan di folder `./data`.
Port `8081` dipakai untuk halaman isolir pelanggan PPPoE.

### Untuk pengembangan

Butuh Node.js 20+.

```bash
npm install
npm run dev
```

- Web: http://localhost:5173 (otomatis meneruskan `/api` ke server)
- Server API: http://localhost:8080

### Build produksi tanpa Docker

```bash
npm install
npm run build
npm start
```

## Persiapan di MikroTik

1. Winbox → **IP → Services** → aktifkan **api** (port 8728) atau **api-ssl** (8729).
2. Disarankan membuat user khusus: **System → Users** → grup `full` (atau grup dengan izin `api,read,write,policy,test`).
3. Server Wifinate harus bisa menjangkau IP router. Jika Wifinate di VPS, gunakan IP publik/VPN ke router.

## Struktur

```
server/   API Fastify, database SQLite, driver MikroTik, penjadwal voucher, PDF
web/      Tampilan React (Vite)
docs/     Skenario & rencana pengembangan
```

## Keamanan

- Password pengguna di-hash dengan **scrypt**.
- Password router disimpan terenkripsi **AES-256-GCM** dengan kunci di `data/secret.key` (dibuat otomatis — **jangan dibagikan**, ikut backup folder `data`).
