# Tutorial: Usaha WiFi Voucher dengan MikroTik 5 Port + Wifinate

Panduan langkah demi langkah dari router baru sampai voucher pertama terjual.
Cocok untuk router 5 port seperti **hEX (RB750Gr3)**, **hAP lite**, **hAP ac²**, **RB750**.

> Waktu yang dibutuhkan: ±30–45 menit.
> Istilah teknis dijelaskan seperlunya. Ikuti urutannya, jangan dilompati.

---

## Daftar isi

1. [Yang perlu disiapkan](#1-yang-perlu-disiapkan)
2. [Rangkaian kabel](#2-rangkaian-kabel)
3. [Masuk ke router dengan Winbox](#3-masuk-ke-router-dengan-winbox)
4. [Siapkan router (5 menit)](#4-siapkan-router-5-menit)
5. [Pasang & jalankan Wifinate di laptop](#5-pasang--jalankan-wifinate-di-laptop)
6. [Hubungkan router ke Wifinate](#6-hubungkan-router-ke-wifinate)
7. [Nyalakan hotspot lewat wizard](#7-nyalakan-hotspot-lewat-wizard)
8. [Pasang halaman login yang cantik](#8-pasang-halaman-login-yang-cantik)
9. [Buat paket harga](#9-buat-paket-harga)
10. [Buat & cetak voucher](#10-buat--cetak-voucher)
11. [Tes dengan HP](#11-tes-dengan-hp)
12. [Pekerjaan harian](#12-pekerjaan-harian)
13. [Jika ada masalah](#13-jika-ada-masalah)

---

## 1. Yang perlu disiapkan

| Barang | Keterangan |
|---|---|
| Router MikroTik 5 port | Masih setelan pabrik lebih mudah |
| Modem / ONT dari ISP | Sumber internet (IndiHome, Biznet, dll.) |
| 1–3 access point WiFi | Mis. TP-Link / Tenda / Ruijie, diset **mode Access Point** |
| Laptop/PC Windows | Untuk Winbox & Wifinate. Sebaiknya menyala terus |
| Kabel LAN | Secukupnya |
| Printer | Untuk mencetak voucher (A4) |

Unduh dulu di laptop:
- **Winbox**: https://mikrotik.com/download (bagian *Winbox*)
- **Node.js versi LTS** (22.16 atau lebih baru): https://nodejs.org
- **Wifinate**: https://github.com/BundaCode/wifinate → tombol hijau **Code → Download ZIP**

---

## 2. Rangkaian kabel

```
                ┌──────────────── MikroTik ────────────────┐
  Modem ISP ───►│ ether1   = INTERNET                      │
  Laptop    ───►│ ether2   = ADMIN (Winbox & Wifinate)      │
  AP WiFi 1 ───►│ ether3 ┐                                 │
  AP WiFi 2 ───►│ ether4 ├ HOTSPOT (pelanggan voucher)     │
  AP WiFi 3 ───►│ ether5 ┘                                 │
                └──────────────────────────────────────────┘
```

| Port | Fungsi | Kena login hotspot? |
|---|---|---|
| **ether1** | Internet dari modem ISP | – |
| **ether2** | Laptop admin | **Tidak** (aman untuk admin) |
| **ether3, ether4, ether5** | Access point untuk pelanggan | **Ya**, wajib login voucher |

> Access point: matikan DHCP di access point / set ke **mode Access Point**, supaya IP pelanggan dibagi oleh MikroTik.

---

## 3. Masuk ke router dengan Winbox

1. Colok laptop ke **ether2**.
2. Buka **Winbox** → tab **Neighbors** → klik router yang muncul (alamat MAC).
3. Login: user **admin**, password **kosong** (router baru) atau sesuai yang tertera di stiker router.
4. Jika muncul jendela *Default Configuration*, klik **OK** (biarkan setelan pabrik).
5. Jika diminta membuat password baru, buat dan **catat**.

---

## 4. Siapkan router (5 menit)

Kita membuat **bridge khusus hotspot** berisi ether3–ether5, supaya ether2 (laptop admin) tidak ikut kena login hotspot.

### 4a. Buat bridge hotspot

1. Menu **Bridge** → tab **Bridge** → klik **+**
2. **Name**: `bridge-hotspot` → **OK**

### 4b. Pindahkan ether3, ether4, ether5 ke bridge hotspot

1. Masih di menu **Bridge** → tab **Ports**.
2. Dobel-klik baris **ether3** → ubah **Bridge** dari `bridge` menjadi `bridge-hotspot` → **OK**.
3. Ulangi untuk **ether4** dan **ether5**.

> Router punya WiFi bawaan (`wlan1` / `wifi1`) dan ingin dipakai untuk voucher juga? Pindahkan juga ke `bridge-hotspot`.
> ⚠️ **Jangan** memindahkan **ether2** — itu jalur laptop Anda. Kalau terlanjur dan Winbox terputus: pindahkan kabel laptop ke port lain, lalu sambung lagi lewat MAC address di tab *Neighbors*.

Hasil akhir di tab **Ports**:

| Interface | Bridge |
|---|---|
| ether2 | bridge |
| ether3 | bridge-hotspot |
| ether4 | bridge-hotspot |
| ether5 | bridge-hotspot |

### 4c. Aktifkan API (supaya Wifinate bisa mengatur router)

1. Menu **IP → Services**.
2. Dobel-klik **api** → pastikan **tidak disabled** (tidak abu-abu), port **8728** → **OK**.

### 4d. Buat user khusus Wifinate (disarankan)

1. Menu **System → Users** → **+**
2. **Name**: `wifinate`, **Group**: `full`, **Password**: buat yang kuat → **OK**.
3. Catat username & password ini.

### 4e. Pastikan internet jalan

Buka website apa saja di laptop. Jika bisa, lanjut. Jika tidak, lihat [bagian 13](#13-jika-ada-masalah).

---

## 5. Pasang & jalankan Wifinate di laptop

1. Pasang **Node.js** (klik Next sampai selesai).
2. Ekstrak ZIP Wifinate, mis. ke `Documents\Project\wifinate-main`.
3. Buka folder itu → **klik dua kali `Jalankan-Wifinate.bat`**.
   - Pertama kali akan memasang & membangun aplikasi (±2–3 menit). Tunggu saja.
   - Browser terbuka otomatis ke **http://localhost:8080**.
   - Jika Windows menampilkan *"Windows protected your PC"*, klik **More info → Run anyway**.
   - Jika Windows Firewall bertanya, pilih **Allow / Izinkan** (jaringan Private).
4. Isi **nama usaha, nama Anda, username, password** → **Buat akun & mulai**.
5. Supaya Wifinate **otomatis jalan setiap komputer dinyalakan**: klik dua kali **`Pasang-Otomatis-Startup.bat`** (cukup sekali).
   Untuk membatalkan: **`Hapus-Otomatis-Startup.bat`**.

> Jendela hitam **Wifinate** jangan ditutup — boleh diperkecil. Masa aktif voucher diurus oleh Wifinate, jadi **laptop/PC sebaiknya menyala terus**.

## 6. Hubungkan router ke Wifinate

1. Menu **Router** → **Tambah router**.
2. Isi:
   - **Nama router**: bebas, mis. `Router Warung`
   - **Alamat IP router**: `192.168.88.1`
   - **Username / Password**: user `wifinate` dari langkah 4d
   - **Port API**: `8728`
3. Klik **Tes koneksi** → harus muncul **Koneksi berhasil!** beserta tipe router.
4. Klik **Simpan router**.

---

## 7. Nyalakan hotspot lewat wizard

1. Di kartu router, klik **Siapkan hotspot**.
2. **Langkah 1 — port internet**: pilih **ether1** → **Lanjut**.
3. **Langkah 2 — port pelanggan**: pilih **bridge-hotspot** → **Lihat rencana**.
   > Pengaturan lanjutan boleh dilewati. Bawaannya: jaringan pelanggan `10.5.50.x`, alamat login `login.wifi`.
4. **Langkah 3**: baca daftar langkah → **Terapkan sekarang**.
   Wifinate otomatis membuat **backup router** dulu.
5. Muncul **Hotspot siap dipakai!**

---

## 8. Pasang halaman login yang cantik

1. Menu **Pengaturan** → bagian **Halaman login hotspot**: atur judul, sapaan, warna. Lihat preview di bingkai HP → **Simpan perubahan**.
2. Menu **Router** → kartu router → **Pasang halaman login**.
3. **Alamat Wifinate dari sisi router**: isi IP laptop Anda + `:8080`.
   Cara melihat IP laptop: di PowerShell ketik `ipconfig` → lihat **IPv4 Address** (biasanya `192.168.88.2xx`).
   Contoh: `http://192.168.88.254:8080`
4. Klik **Pasang sekarang**.

> Gagal? Pakai cara manual: **Pengaturan → Unduh login.html** → di Winbox buka **Files** → seret file ke folder **hotspot** (timpa yang lama).
> Windows Firewall mungkin bertanya saat pertama kali menjalankan Wifinate — pilih **Allow / Izinkan** (jaringan Private).

---

## 9. Buat paket harga

Menu **Paket Voucher** → **Paket baru**. Contoh:

| Nama | Harga | Masa aktif | Batas pemakaian | Kecepatan | Perangkat |
|---|---|---|---|---|---|
| Hemat 3 Jam | 2000 | 1 hari | 3 jam | 5 Mbps | 1 |
| Harian | 5000 | 1 hari | Tanpa batas | 10 Mbps | 1 |
| Mingguan | 25000 | 7 hari | Tanpa batas | 10 Mbps | 2 |

- **Masa aktif** = dihitung sejak pertama login; lewat dari itu voucher hangus.
- **Batas pemakaian** = total waktu online (berhenti dihitung saat logout).

---

## 10. Buat & cetak voucher

1. Menu **Voucher** → **Buat voucher**.
2. Pilih paket, jumlah (mis. **40** = ±1 lembar A4) → **Buat 40 voucher**.
3. Klik **Cetak PDF** → print → gunting sesuai garis.

Atur format kode (angka/huruf, panjang, awalan) & jumlah kolom per lembar di **Pengaturan → Format voucher**.

---

## 11. Tes dengan HP

1. Sambungkan HP ke WiFi access point (yang tercolok di ether3/4/5).
2. Halaman login muncul otomatis. Jika tidak, buka browser dan ketik **login.wifi**.
3. Masukkan satu kode voucher → **Masuk** → internet jalan.
   Atau **scan QR code** di kartu voucher untuk login otomatis.
4. Di Wifinate buka **Monitor** → HP Anda muncul sebagai online.
5. Dalam ±30 detik voucher berubah status **Aktif** dan tercatat di **Laporan**.

🎉 **Usaha voucher Anda siap jualan!**

---

## 12. Pekerjaan harian

| Kapan | Apa | Di mana |
|---|---|---|
| Pagi | Cek router online & stok voucher | **Beranda** |
| Stok menipis | Buat & cetak voucher baru | **Voucher** |
| Kapan saja | Lihat siapa yang online | **Monitor** |
| Akhir hari/bulan | Lihat pendapatan, unduh Excel | **Laporan** |
| Sesekali | Unduh backup, simpan di HP/Google Drive | **Pengaturan → Backup** |

Tips: aktifkan **Pengaturan → Notifikasi WhatsApp** supaya dapat kabar saat router mati, stok menipis, dan ringkasan penjualan harian.

---

## 13. Jika ada masalah

| Masalah | Solusi |
|---|---|
| **Tes koneksi**: "Router menolak koneksi" | Aktifkan **api** di Winbox → **IP → Services** (langkah 4c). |
| **Tes koneksi**: "Router tidak bisa dihubungi" | Pastikan laptop di **ether2** dan IP router `192.168.88.1`. Coba `ping 192.168.88.1` di PowerShell. |
| **Tes koneksi**: "Username atau password salah" | Cek user di **System → Users** (langkah 4d). |
| Wizard berhenti di tengah | Baca pesannya. Router sudah dibackup otomatis (**Files** → `wifinate-sebelum-setup-…`). Pastikan memilih **bridge-hotspot**, bukan `bridge`. |
| HP konek WiFi tapi **tidak dapat IP** | Pastikan access point **mode Access Point** (DHCP di AP mati) dan tercolok di ether3/4/5. |
| Halaman login tidak muncul | Buka **login.wifi** atau **http://10.5.50.1** di browser HP. |
| Sudah login tapi **tidak bisa internet** | Cek internet dari laptop (ether2). Jika laptop juga tidak bisa, masalah di modem/ISP. |
| Voucher tidak berubah **Aktif** | Wifinate harus terus berjalan (jendela PowerShell jangan ditutup). Status router di **Beranda** harus **Online**. |
| Laptop mati/restart | Klik dua kali `Jalankan-Wifinate.bat`. Agar otomatis, jalankan sekali `Pasang-Otomatis-Startup.bat`. |
| Lupa password Wifinate | Belum ada reset otomatis. Jika masih uji coba: tutup jendela Wifinate, hapus folder `server\data`, jalankan lagi (**semua data terhapus**). |

Masih bingung? Catat **pesan error** yang muncul (atau screenshot), lalu tanyakan.
