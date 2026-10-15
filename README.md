# RapiQR Gateway

RapiQR Gateway menyediakan API dan dashboard untuk mengelola order pembayaran. Kode inti menangani referensi order, nominal, masa berlaku, status, penyimpanan transaksi, dan webhook ke aplikasi merchant. Integrasi pembayaran dijalankan melalui adapter server-side yang kamu pilih dan buat sendiri.

Tidak ada provider pembayaran bawaan. Setelah dijalankan, dashboard dan API status dapat digunakan untuk memeriksa layanan. Pembuatan pembayaran baru aktif setelah adapter ditambahkan dan `PAYMENT_PROVIDER` diatur.

Repository ini tidak langsung menerima uang. Transaksi nyata membutuhkan adapter yang sesuai, akun merchant, dan kredensial dari penyedia pilihanmu.

Source code berlisensi MIT dan dapat digunakan tanpa biaya lisensi. Biaya server dan ketentuan penyedia pembayaran mengikuti layanan yang dipilih operator.

## Fitur

- API untuk membuat, melihat, dan membatalkan order.
- Idempotensi berdasarkan `merchant_reference` untuk mencegah order ganda.
- Status pembayaran `creating`, `pending`, `paid`, `expired`, `cancelled`, dan `failed`.
- SQLite untuk order, riwayat status, dan antrean webhook merchant.
- Webhook merchant bertanda tangan HMAC-SHA256 dengan retry persisten.
- Kontrak adapter untuk menghubungkan penyedia pembayaran pilihanmu.
- Dashboard responsif untuk melihat transaksi dan aktivitas.
- API key untuk endpoint pengelolaan order.

## Persyaratan

- Node.js 22.13 atau lebih baru.
- Adapter untuk penyedia pembayaran yang akan digunakan.
- Penyimpanan persisten untuk direktori `data/`.

Project ini memakai modul `node:sqlite` bawaan Node.js, sehingga Node.js 18.x dan 20.x belum memenuhi persyaratan runtime.

API `node:sqlite` masih berstatus experimental pada Node.js 22.x. Gunakan versi Node.js yang memenuhi minimum project dan tinjau perubahan runtime saat memperbarui versi.

## Menjalankan

```bash
npm run setup
npm start
```

Setup membuat file `.env` dan menampilkan API key dashboard. Simpan key tersebut, buka `http://127.0.0.1:3000`, lalu masukkan API key. Secara default belum ada adapter yang aktif.

Database dibuat di `data/rapiqr.sqlite`. File `.env` dan database lokal tidak masuk Git.

## Integrasi provider

Tambahkan adapter di `src/providers/<nama>.js`, lalu tetapkan nama yang sama di `.env`:

```env
PAYMENT_PROVIDER=nama-adapter
```

Adapter perlu menyediakan `createPayment()` untuk membuat transaksi melalui API provider. Untuk memperbarui status, adapter dapat memakai webhook melalui `normalizeWebhook()`, proses rekonsiliasi melalui `start()`, atau keduanya. Kredensial provider hanya disimpan di environment server. Lihat [panduan adapter](docs/provider-adapter.md).

Setelah perubahan `.env`, mulai ulang aplikasi. Health endpoint menunjukkan `ready: true` jika adapter berhasil dimuat. Tanpa adapter, pembuatan pembayaran mengembalikan `503 provider_not_configured`.

## API

Endpoint pengelolaan transaksi menggunakan header:

```http
Authorization: Bearer <RAPIQR_API_KEY>
Content-Type: application/json
```

### Membuat pembayaran

```http
POST /api/v1/payments
```

```json
{
  "merchant_reference": "ORD-2026-001",
  "amount": 50000,
  "currency": "IDR",
  "description": "Pesanan #001",
  "expires_in_seconds": 900
}
```

`merchant_reference` harus unik. Referensi dan nominal yang sama mengembalikan order yang sudah dibuat; referensi sama dengan nominal berbeda menghasilkan `409 Conflict`.

### Membaca transaksi

```http
GET /api/v1/payments/<payment_id>
GET /api/v1/payments?limit=25
```

### Membatalkan transaksi

```http
POST /api/v1/payments/<payment_id>/cancel
```

### Status layanan

```http
GET /api/v1/health
```

`ok` menunjukkan proses HTTP berjalan. `ready` menunjukkan adapter provider berhasil dimuat dan pembuatan pembayaran dapat diproses.

## Webhook merchant

Isi `WEBHOOK_URL` dan `WEBHOOK_SECRET` di `.env` untuk mengirim perubahan status ke aplikasi merchant:

```env
WEBHOOK_URL=https://merchant.example/webhooks/rapiqr
WEBHOOK_SECRET=ganti-dengan-rahasia-acak-minimal-32-karakter
```

Event disimpan sebelum dikirim. Request membawa `X-RapiQR-Event-Id` dan `X-RapiQR-Signature` berformat `t=<unix-time>,v1=<hmac>`. Signature dihitung dari `timestamp + "." + raw_body` menggunakan HMAC-SHA256. Pengiriman gagal dicoba ulang hingga lima kali dengan jeda bertahap.

## Deployment

Gateway dapat dijalankan pada VPS, cPanel, atau Pterodactyl jika tersedia Node.js 22.13+, proses Node.js yang berjalan terus, dan direktori `data/` yang dapat ditulis serta disimpan permanen. Pada Pterodactyl, pilih runtime Node.js 22.x atau lebih baru. Di cPanel, pastikan versi Node.js aplikasi memenuhi persyaratan tersebut.

Untuk deployment langsung, atur `.env` dengan `NODE_ENV=production`, `HOST=0.0.0.0` jika panel mengharuskannya, port yang disediakan host, `PUBLIC_ORIGIN` HTTPS, dan `DATABASE_PATH=./data/rapiqr.sqlite`. Batasi akses dashboard/API dengan TLS, firewall, dan pengelolaan API key yang benar. Di belakang reverse proxy pada host yang sama, `HOST=127.0.0.1` dapat digunakan.

Contoh konfigurasi tersedia untuk [Docker Compose](docs/deployment.md#docker-compose) dan [PM2](docs/deployment.md#pm2). Keduanya menggunakan satu proses aplikasi dan menyimpan database di lokasi persisten.

> [!CAUTION]
> 🚨 **PERSYARATAN DEPLOYMENT (VPS / cPanel / Pterodactyl Panel)**
> Gateway ini ditujukan untuk host Node.js yang berjalan terus dan memiliki penyimpanan persisten. **DILARANG MENGGUNAKAN HOSTING SERVERLESS GRATISAN UNTUK VERSI INI**, termasuk Render Free, Vercel Functions, atau Netlify Functions, kecuali arsitekturnya diubah dan storage persisten disiapkan. Gateway menyimpan order dan antrean webhook di `data/rapiqr.sqlite`; jika file tersebut hilang, data transaksi lokal dan webhook tertunda juga hilang. Core RapiQR tidak membuat sesi GoPay atau meminta OTP GoPay. Jika adapter GoPay pilihan operator membuat file sesi seperti `.GOPAY_SESI_JANGAN_DIHAPUS.json`, file itu juga perlu disimpan pada storage persisten.

> [!WARNING]
> ⚠️ **DISCLAIMER PROYEK TIDAK RESMI**
> RapiQR Gateway tidak berafiliasi dengan PT GoTo Gojek Tokopedia Tbk, GoPay, atau penyedia pembayaran lain. Project ini tidak menyertakan API privat, kredensial, maupun adapter provider. Gunakan API resmi dan patuhi ketentuan penyedia yang kamu integrasikan. Adapter yang melakukan polling harus memakai interval dan batas request yang diizinkan provider; polling terlalu agresif dapat memicu pembatasan akun. Data inti disimpan pada server tempat gateway dijalankan. Data yang diperlukan tetap dikirim ke provider dan URL webhook merchant yang kamu atur. Keamanan server, integrasi, dan konfigurasi menjadi tanggung jawab operator; risiko penggunaan ditanggung operator.

## Pemeriksaan

```bash
npm run check
npm test
```

## Lisensi

MIT. Source code dapat digunakan, diubah, dan dibagikan kembali dengan menyertakan pemberitahuan lisensi.

## Tentang

Dibuat oleh [adlnfkhrzmn](https://github.com/adlnfkhrzmn).
