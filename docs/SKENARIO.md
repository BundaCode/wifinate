# Skenario Penggunaan Wifinate

Dokumen ini menjadi pegangan alur aplikasi dari sudut pandang pemilik usaha yang **tidak paham setting jaringan**.

## Alur awal: dari router kosong sampai voucher terjual

### 0. Persiapan
- MikroTik tersambung internet (mis. `ether1` dari ISP), port lain untuk pelanggan (mis. `ether2` / `wlan1`).
- Wifinate dijalankan di PC/mini PC/STB satu jaringan dengan router (paling simpel), atau di VPS dengan akses ke router (IP publik / VPN).

### 1. Daftar akun pemilik
Isi nama usaha, nama, nomor WA, username, password. Nama usaha & WA otomatis tampil di voucher.

### 2. Hubungkan router
Menu **Router → Tambah router** → isi IP, username, password → **Tes koneksi** → **Simpan**.
Belum punya alat? Klik **router demo**.

### 3. Wizard hotspot
**Router → Siapkan hotspot**:
1. Pilih port internet (biasanya `ether1`).
2. Pilih port pelanggan.
3. Lihat rencana (alamat IP, pool, DHCP, DNS, hotspot, NAT) dalam bahasa awam.
4. **Terapkan** → Wifinate membuat backup dulu (`wifinate-sebelum-setup-<tanggal>`), lalu menjalankan langkah satu per satu. Jika gagal, pesan menyebut langkah yang gagal & nama backup.

### 4. Buat paket
Contoh:

| Paket | Harga | Batas pemakaian | Masa aktif | Kecepatan | Perangkat |
|---|---|---|---|---|---|
| Hemat | Rp2.000 | 3 jam | 1 hari | 5 Mbps | 1 |
| Harian | Rp5.000 | — | 1 hari | 10 Mbps | 1 |
| Bulanan | Rp50.000 | — | 30 hari | 10 Mbps | 2 |

- **Batas pemakaian** = total waktu online (berhenti dihitung saat logout). Ditegakkan oleh router (`limit-uptime`).
- **Masa aktif** = dihitung sejak login pertama. Ditegakkan oleh penjadwal Wifinate.

### 5. Format voucher (Pengaturan)
Jenis karakter, panjang kode, awalan, password = kode, jumlah kolom per A4.

### 6. Generate & cetak
**Voucher → Buat voucher** → pilih paket & jumlah → **Cetak PDF** → print → gunting.

### 7. Operasional harian
```
Belum dipakai → Aktif (login pertama, penjualan dicatat) → Habis (masa aktif / batas pakai / kuota)
```
Penjadwal berjalan tiap 30 detik: mencatat aktivasi, memperbarui pemakaian, menghapus & memutus voucher yang habis, dan memantau status router.

## Alur PPPoE (Tahap 2 — sudah tersedia)

1. **Router → Siapkan PPPoE**: pilih port internet & port pelanggan → preview → backup → terapkan.
   Membuat pool IP, profil dasar, server PPPoE, profil `wifinate-isolir` + firewall blokir, dan NAT.
2. **Pelanggan → Paket PPPoE**: buat paket bulanan, mis. “Rumahan 10 Mbps — Rp150.000”.
   Setiap paket menjadi profil `wifinate-ppp<id>` di router (kecepatan ikut diperbarui saat paket diubah).
3. **Pelanggan baru**: isi nama, WA, alamat, pilih paket. Username & password PPPoE dibuat (bisa acak).
   Opsi “Bayar bulan pertama sekarang” langsung mencatat pembayaran. Sudah punya pelanggan di MikroTik? Pakai **Impor dari router**.
4. **Siklus tagihan otomatis** (dicek tiap menit):
   ```
   H-7 jatuh tempo → tagihan dibuat → jatuh tempo → lewat toleransi (default 3 hari) → ISOLIR otomatis
   Bayar → tagihan lunas, jatuh tempo maju 1 bulan → jika terisolir: AKTIF lagi otomatis
   ```
   Isolir = profil akun diganti ke `wifinate-isolir` (128k + masuk address-list yang diblokir firewall) dan sesi diputus agar langsung berlaku.
5. **Tagihan**: daftar tunggakan, tombol **Bayar** dan **Ingatkan via WA** (pesan tagihan otomatis terisi).
6. Pembayaran masuk **Laporan** sebagai kanal PPPoE.

Catatan: aturan firewall isolir ditambahkan di akhir daftar filter. Jika router punya aturan `accept` umum di chain forward sebelumnya, pindahkan aturan `wifinate:pppoe blokir isolir` ke atas.

## Rencana tahap berikutnya

### Tahap 2b — sisa
- Editor halaman login hotspot (logo, warna, daftar harga) yang di-upload ke router.
- Halaman informasi “Anda terisolir, silakan bayar” untuk pelanggan yang diisolir.

### Tahap 3 — Jaringan kantor & multi-lokasi
- Wizard **LAN kantor**: bagi jaringan per divisi (VLAN/IP), DHCP, dan bandwidth (simple queue / PCQ), contoh: Keuangan 10 Mbps, Marketing 20 Mbps, Tamu 5 Mbps.
- Preview + backup + safe mode untuk setiap perubahan.
- Akun reseller dengan saldo deposit.
- Notifikasi WhatsApp (stok voucher menipis, router offline).
