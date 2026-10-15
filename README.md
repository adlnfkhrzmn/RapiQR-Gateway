# RapiQR Gateway

RapiQR Gateway adalah fondasi backend dan dashboard untuk mengatur alur pembayaran. Project ini menangani data transaksi, status pembayaran, dan notifikasi ke aplikasi merchant. Untuk terhubung ke layanan pembayaran, kamu bisa menambahkan adapter sendiri sesuai provider yang digunakan.

Belum ada provider yang langsung terpasang. Jadi, setelah project dijalankan dashboard-nya bisa dibuka, tetapi transaksi baru belum bisa dibuat sampai adapter diatur. Project ini juga tidak menyediakan akun merchant atau QRIS dan tidak langsung menerima uang.

Source code ini berlisensi MIT. Kamu bebas memakai dan mengubahnya. Biaya hosting dan biaya dari provider mengikuti layanan yang kamu pilih.

## Yang tersedia

- API untuk membuat, melihat, dan membatalkan transaksi.
- Pencegahan transaksi ganda saat `merchant_reference` yang sama dikirim ulang.
- Status transaksi: `creating`, `pending`, `paid`, `expired`, `cancelled`, dan `failed`.
- Database SQLite untuk menyimpan transaksi, riwayat status, dan antrean webhook.
- Webhook merchant dengan tanda tangan HMAC-SHA256 dan pengiriman ulang otomatis.
- Dashboard untuk melihat transaksi dan aktivitas terbaru.
- Adapter yang bisa dikembangkan untuk provider pembayaran pilihanmu.

## Yang dibutuhkan

- Node.js 22.13 atau lebih baru.
- Adapter untuk provider yang ingin kamu hubungkan.
- Penyimpanan permanen untuk folder `data/`.

Project ini memakai modul `node:sqlite` bawaan Node.js, jadi Node.js 18.x dan 20.x belum bisa menjalankannya. Modul SQLite tersebut masih berstatus experimental pada Node.js 22.x, jadi periksa kembali kompatibilitas saat memperbarui versi Node.

## Menjalankan di komputer sendiri

```bash
npm run setup
npm start
```

Perintah setup membuat file `.env` dan menampilkan API key untuk membuka dashboard. Simpan key itu, buka [http://127.0.0.1:3000](http://127.0.0.1:3000), lalu tempel key pada halaman.

Database tersimpan di `data/rapiqr.sqlite`. File `.env` dan database lokal tidak ikut diunggah ke GitHub.

## Menghubungkan provider

Buat adapter di `src/providers/`, lalu isi nama file adapter di `.env`. Contohnya, untuk file `src/providers/nama-adapter.js`:

```env
PAYMENT_PROVIDER=nama-adapter
```

Adapter harus membuat transaksi melalui API provider. Untuk menerima perubahan status, adapter bisa memverifikasi webhook, menjalankan rekonsiliasi berkala, atau memakai keduanya. Kredensial provider hanya disimpan di server. Langkah dan bentuk adapter dijelaskan di [panduan adapter](docs/provider-adapter.md).

Setelah `.env` diubah, mulai ulang aplikasi. Status `ready: true` pada health endpoint berarti adapter berhasil dimuat. Kalau belum ada adapter, endpoint pembuatan transaksi akan menjawab `503 provider_not_configured`.

## API

Endpoint transaksi memerlukan API key berikut:

```http
Authorization: Bearer <RAPIQR_API_KEY>
Content-Type: application/json
```

### Membuat transaksi

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

Gunakan `merchant_reference` yang unik untuk setiap transaksi. Jika referensi dan nominal yang sama dikirim lagi, gateway mengembalikan transaksi yang sudah ada. Jika referensinya sama tetapi nominalnya berbeda, gateway menjawab `409 Conflict`.

### Melihat transaksi

```http
GET /api/v1/payments/<payment_id>
GET /api/v1/payments?limit=25
```

### Membatalkan transaksi

```http
POST /api/v1/payments/<payment_id>/cancel
```

### Memeriksa layanan

```http
GET /api/v1/health
```

`ok` berarti server merespons. `ready` berarti adapter provider sudah aktif.

## Mengirim webhook ke aplikasi merchant

Isi `WEBHOOK_URL` dan `WEBHOOK_SECRET` di `.env`:

```env
WEBHOOK_URL=https://merchant.example/webhooks/rapiqr
WEBHOOK_SECRET=ganti-dengan-rahasia-acak-minimal-32-karakter
```

Gateway menyimpan event sebelum mengirimnya. Setiap request menyertakan ID event dan tanda tangan HMAC-SHA256. Jika server merchant gagal menerima webhook, gateway akan mencoba mengirim ulang hingga lima kali.

## Menjalankan di server

RapiQR Gateway bisa dijalankan di VPS, cPanel, atau Pterodactyl selama tersedia Node.js 22.13+, proses Node yang terus berjalan, dan folder `data/` yang tetap tersimpan. Untuk Pterodactyl, pilih egg Node.js 22.x atau yang lebih baru.

Di `.env`, atur `NODE_ENV=production`, `PUBLIC_ORIGIN` dengan alamat HTTPS, port yang diberikan hosting, dan `DATABASE_PATH=./data/rapiqr.sqlite`. Jika aplikasi berada di belakang reverse proxy pada server yang sama, `HOST=127.0.0.1` bisa digunakan. Ikuti panduan [deployment](docs/deployment.md) untuk pengaturan VPS, cPanel, Pterodactyl, Docker Compose, dan PM2.

> [!CAUTION]
> **Perhatikan jenis hosting dan penyimpanan**
>
> Aplikasi ini perlu tetap berjalan dan menyimpan database di `data/rapiqr.sqlite`. Hindari memasang versi ini apa adanya pada hosting serverless gratis seperti Render Free, Vercel Functions, atau Netlify Functions. Proses bisa dihentikan atau file lokalnya tidak bertahan setelah restart, sehingga transaksi dan webhook yang belum terkirim dapat hilang.
>
> Kalau adapter yang kamu pasang menyimpan file sesi—misalnya `.GOPAY_SESI_JANGAN_DIHAPUS.json`—pastikan file itu juga berada di penyimpanan permanen. RapiQR sendiri tidak membuat sesi GoPay atau meminta OTP.

> [!WARNING]
> **Soal QRIS, provider, dan tanggung jawab penggunaan**
>
> RapiQR Gateway adalah project independen dan tidak berafiliasi dengan PT GoTo Gojek Tokopedia Tbk, GoPay, atau provider pembayaran lainnya. Gateway ini hanya menyediakan perangkat lunak; keputusan untuk menerima, membatasi, atau memblokir QRIS dan akun tetap ada pada merchant atau penyedia terkait.
>
> Jika merchant atau penyedia pembayaran memblokir QRIS atau akun yang kamu gunakan, saya sebagai pembuat project ini tidak bertanggung jawab atas keputusan tersebut maupun dampaknya. Gunakan API resmi dan ikuti ketentuan provider. Jika adapter melakukan polling, patuhi batas request agar akunmu tidak terkena pembatasan.
>
> Database disimpan di server tempat gateway dijalankan. Data yang diperlukan untuk transaksi juga akan diteruskan ke provider dan URL webhook merchant yang kamu atur.

## Pemeriksaan

```bash
npm run check
npm test
```

## Lisensi dan pembuat

Lisensi MIT. Project ini dibuat oleh [adlnfkhrzmn](https://github.com/adlnfkhrzmn).
