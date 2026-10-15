# RapiQR Gateway

RapiQR Gateway adalah project open-source untuk membantu website toko mengatur pembayaran. Aplikasi ini punya halaman pengelolaan dan API untuk mencatat transaksi, melihat statusnya, lalu mengirim kabar ke website toko.

**Project ini belum terhubung ke layanan pembayaran mana pun.** Setelah dijalankan, halaman pengelolaan sudah bisa dibuka, tetapi pembayaran sungguhan belum bisa dibuat. Agar pembayaran bisa berjalan, developer perlu menyambungkan RapiQR ke layanan pembayaran yang dipilih. RapiQR sendiri tidak menerbitkan QRIS dan tidak menerima uang.

Project ini berlisensi MIT. Kamu bebas memakai dan mengubah source code-nya. Biaya server atau layanan pembayaran mengikuti pilihan masing-masing pengguna.

## Fitur

- Membuat, melihat, dan membatalkan transaksi lewat API.
- Mencegah transaksi ganda jika nomor referensi yang sama dikirim ulang.
- Menyimpan transaksi dan riwayat status di database SQLite.
- Mengirim kabar otomatis (webhook) ke website toko saat status pembayaran berubah.
- Menampilkan transaksi dan aktivitas terbaru di dashboard.
- Menyediakan tempat untuk menambahkan integrasi layanan pembayaran pilihanmu.

## Yang perlu disiapkan

- Node.js versi 22.13 atau lebih baru.
- Server dengan folder penyimpanan yang tidak terhapus saat aplikasi dimulai ulang.

Project ini memakai SQLite bawaan Node.js. Karena itu Node.js 18 dan 20 tidak bisa menjalankannya. Modul SQLite bawaan tersebut masih berstatus eksperimen di Node.js 22.

## Menjalankan di komputer

Pastikan Node.js sudah terpasang, lalu jalankan perintah ini dari folder project:

```bash
npm run setup
npm start
```

Setup akan membuat file pengaturan `.env` dan menampilkan **API key RapiQR (kode akses)**. Simpan kode itu, buka [http://127.0.0.1:3000](http://127.0.0.1:3000), lalu masukkan kode tersebut.

Kode akses RapiQR dipakai untuk membuka halaman pengelolaan dan menggunakan API RapiQR. Kode akses dari layanan pembayaran berbeda; simpan di pengaturan server dan jangan unggah ke GitHub.

Data transaksi disimpan di `data/rapiqr.sqlite`. File `.env` dan database lokal tidak ikut diunggah ke GitHub.

## Menghubungkan layanan pembayaran

RapiQR belum menyertakan sambungan ke layanan pembayaran. Agar bisa menerima pembayaran, developer perlu menambahkan kode penghubung di folder `src/providers/`, lalu memilihnya di file pengaturan `.env`. Contoh:

```env
PAYMENT_PROVIDER=nama-integrasi
```

Bagian ini memang perlu dikerjakan developer. Cara menyambungkannya berbeda untuk setiap layanan pembayaran.

Setelah memilih layanan pembayaran, masukkan API key atau token akses yang diberikan layanan tersebut ke pengaturan server. Kode ini rahasia. Jangan masukkan ke halaman website atau unggah ke GitHub.

Kode penghubung itu bertugas membuat transaksi dan memberi tahu RapiQR saat pembayaran berubah status. Layanan pembayaran bisa mengirim kabar otomatis (webhook), atau kode penghubung memeriksa status secara berkala (polling). Penjelasan untuk developer tersedia di [panduan integrasi](docs/provider-adapter.md).

Setelah mengubah `.env`, mulai ulang aplikasi. Buka `http://alamat-server:PORT/api/v1/health` untuk melihat status. `ready: true` berarti kode penghubung berhasil dimuat. Jika belum ada kode penghubung, RapiQR belum bisa membuat pembayaran.

## API

Untuk memakai API transaksi, kirim kode akses RapiQR pada bagian `Authorization` seperti ini:

```http
Authorization: Bearer <RAPIQR_API_KEY>
Content-Type: application/json
```

### Membuat transaksi

```http
POST /api/v1/payments
```

Contoh isi permintaan:

```json
{
  "merchant_reference": "ORD-2026-001",
  "amount": 50000,
  "currency": "IDR",
  "description": "Pesanan #001",
  "expires_in_seconds": 900
}
```

`merchant_reference` adalah nomor pesanan dari website toko. `amount` diisi dengan nominal dalam rupiah, misalnya `50000` untuk Rp50.000.

Gunakan nomor pesanan yang berbeda untuk setiap transaksi. Jika nomor dan nominal yang sama dikirim lagi, RapiQR memakai transaksi yang sudah ada. Jika nomornya sama tetapi nominalnya berbeda, RapiQR akan menolak permintaan tersebut.

### Melihat transaksi

```http
GET /api/v1/payments/<payment_id>
GET /api/v1/payments?limit=25
```

### Membatalkan transaksi

```http
POST /api/v1/payments/<payment_id>/cancel
```

### Memeriksa status aplikasi

```http
GET /api/v1/health
```

`ok: true` berarti aplikasi merespons. `ready: true` berarti integrasi layanan pembayaran sudah aktif.

## Pemberitahuan ke website toko

Jika website toko perlu menerima kabar saat status transaksi berubah, isi `WEBHOOK_URL` dan `WEBHOOK_SECRET` di `.env`:

```env
WEBHOOK_URL=https://merchant.example/webhooks/rapiqr
WEBHOOK_SECRET=ganti-dengan-rahasia-acak-minimal-32-karakter
```

RapiQR akan menambahkan tanda khusus pada setiap pesan agar website toko bisa memastikan kabar itu memang dikirim oleh RapiQR. Jika pesan gagal terkirim, RapiQR akan mencoba lagi hingga lima kali.

## Menjalankan di server

Kamu bisa memasang aplikasi di VPS, cPanel, atau Pterodactyl. Pastikan server menyediakan Node.js 22.13 atau lebih baru, aplikasi bisa terus berjalan, dan folder `data/` tetap tersimpan saat aplikasi dimulai ulang. Jika memakai Pterodactyl, pilih Node.js 22.x atau yang lebih baru.

Di `.env`, atur `NODE_ENV=production`, alamat website HTTPS pada `PUBLIC_ORIGIN`, port yang diberikan layanan hosting, dan lokasi database pada `DATABASE_PATH=./data/rapiqr.sqlite`. Jika server menggunakan reverse proxy, atur `HOST=127.0.0.1`.

Langkah pemasangan untuk [VPS, cPanel, Pterodactyl, Docker Compose, dan PM2](docs/deployment.md) tersedia di panduan pemasangan.

> [!CAUTION]
> **Pilih hosting yang menyimpan data**
>
> Aplikasi ini perlu terus berjalan dan menyimpan data transaksi di `data/rapiqr.sqlite`. Jangan pasang versi ini apa adanya di hosting serverless gratis seperti Render Free, Vercel Functions, atau Netlify Functions. Layanan seperti ini bisa menghentikan aplikasi atau menghapus file saat dimulai ulang. Transaksi dan kabar yang belum terkirim bisa hilang.
>
> Kalau integrasi yang kamu pasang menyimpan file sesi—misalnya `.GOPAY_SESI_JANGAN_DIHAPUS.json`—pastikan file itu juga disimpan secara permanen. RapiQR sendiri tidak membuat sesi GoPay atau meminta OTP.

> [!WARNING]
> **Tentang QRIS dan risiko penggunaan**
>
> RapiQR Gateway tidak berafiliasi dengan PT GoTo Gojek Tokopedia Tbk, GoPay, atau layanan pembayaran lainnya. RapiQR hanya menyediakan source code. Merchant (toko) atau penyedia pembayaran yang menentukan apakah QRIS dan akun bisa digunakan, dibatasi, atau diblokir.
>
> Jika toko atau penyedia pembayaran memblokir QRIS atau akun yang kamu gunakan, saya sebagai pembuat project ini tidak bertanggung jawab atas keputusan atau dampaknya. Gunakan API resmi dan ikuti aturan penyedia pembayaran. Jika kode penghubung memeriksa status transaksi secara berkala, jangan melebihi batas permintaan yang ditetapkan penyedia.
>
> Data transaksi tersimpan di server tempat RapiQR dijalankan. Data yang dibutuhkan untuk memproses pembayaran juga dikirim ke layanan pembayaran dan website toko yang kamu atur.

## Pemeriksaan

```bash
npm run check
npm test
```

## Lisensi dan pembuat

Lisensi MIT. Project ini dibuat oleh [adlnfkhrzmn](https://github.com/adlnfkhrzmn).
