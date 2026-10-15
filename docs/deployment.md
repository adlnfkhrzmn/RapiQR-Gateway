# Deployment

RapiQR Gateway menjalankan satu proses Node.js dan menulis data ke SQLite. Pastikan direktori `data/` tetap tersimpan saat restart, rebuild, atau pemindahan versi aplikasi. Gunakan Node.js 22.13 atau lebih baru.

## VPS, cPanel, atau Pterodactyl

1. Salin source code ke host dan pasang Node.js 22.13+.
2. Jalankan `npm run setup` sekali untuk membuat `.env` dan API key.
3. Tambahkan adapter pembayaran yang akan dipakai.
4. Atur `NODE_ENV=production`, `PAYMENT_PROVIDER`, `PUBLIC_ORIGIN`, `PORT`, dan `DATABASE_PATH`.
5. Pastikan direktori `data/` dapat ditulis oleh akun aplikasi dan tidak dihapus saat deploy.
6. Jalankan proses terus-menerus dengan service manager/panel host. Gunakan reverse proxy TLS untuk domain publik.

Pterodactyl perlu memakai egg Node.js 22.x atau lebih baru. Pada cPanel, aktifkan aplikasi Node.js dengan versi yang sesuai dan ikuti konfigurasi startup yang tersedia di paket hosting.

## Docker Compose

Salin `.env.example` menjadi `.env`, isi API key dan nilai konfigurasi yang diperlukan, lalu tambahkan adapter provider. Compose memasang named volume persisten di `/app/data`.

```bash
docker compose up -d --build
docker compose logs -f rapiqr-gateway
```

Untuk memeriksa status, buka `https://domain-kamu/api/v1/health`. Backup volume `rapiqr-data` secara berkala. Jangan menghapus volume ketika memperbarui image.

## PM2

Instal PM2 pada host, siapkan `.env` dan adapter, lalu jalankan dari direktori project:

```bash
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup
```

Konfigurasi PM2 memakai satu worker karena penyimpanan SQLite bersifat lokal. Sesuaikan `HOST` dan `PORT` dengan reverse proxy atau panel host. Jangan menjalankan beberapa instance yang menulis file SQLite yang sama.

## Hosting serverless atau filesystem sementara

Project ini membuka server HTTP yang berjalan terus dan mengandalkan file SQLite lokal. Lingkungan yang menghentikan proses, membatasi masa hidup request, atau tidak menyediakan penyimpanan persisten tidak sesuai untuk konfigurasi ini. Render Free tidak menyediakan persistent disk untuk web service gratis dan filesystem default Render bersifat ephemeral; Netlify Functions berjalan pada runtime ephemeral. Vercel Functions memerlukan desain function dan storage yang sesuai, sehingga konfigurasi VPS/SQLite dalam project ini tidak dapat langsung dipindahkan ke sana.

- [Render persistent disks](https://render.com/docs/disks) · [Render free services](https://render.com/docs/free)
- [Vercel Functions](https://vercel.com/docs/functions)
- [Netlify Functions](https://docs.netlify.com/build/functions/overview/)
- [Node.js SQLite API](https://nodejs.org/api/sqlite.html)

Jika ingin memakai platform semacam itu, arsitektur perlu diubah agar sesuai dengan runtime platform dan menggunakan datastore persisten yang didukung. Jangan mengandalkan SQLite lokal di filesystem sementara untuk menyimpan order atau antrean webhook.
