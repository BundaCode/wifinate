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

## Rencana tahap berikutnya

### Tahap 2 — PPPoE & monitoring lanjutan
- Pelanggan PPPoE: tambah pelanggan → pilih paket → selesai.
- Tanggal jatuh tempo, **isolir otomatis** saat telat bayar, buka isolir saat lunas.
- Tagihan bulanan & pencatatan pembayaran (masuk laporan penjualan kanal `pppoe`).
- Grafik trafik live per interface (WebSocket).
- Editor halaman login hotspot (logo, warna, daftar harga) yang di-upload ke router.

### Tahap 3 — Jaringan kantor & multi-lokasi
- Wizard **LAN kantor**: bagi jaringan per divisi (VLAN/IP), DHCP, dan bandwidth (simple queue / PCQ), contoh: Keuangan 10 Mbps, Marketing 20 Mbps, Tamu 5 Mbps.
- Preview + backup + safe mode untuk setiap perubahan.
- Akun reseller dengan saldo deposit.
- Notifikasi WhatsApp (stok voucher menipis, router offline).
