# RapiQR Gateway

RapiQR Gateway adalah source code gateway pembayaran yang bisa dikembangkan dengan provider pilihanmu. Order, status pembayaran, masa berlaku, dan notifikasi webhook dikelola melalui satu API.

Adapter sandbox tersedia agar alur order sampai pembayaran berhasil bisa dicoba dari dashboard. Adapter ini hanya simulasi lokal dan tidak memindahkan uang. Untuk transaksi nyata, tambahkan adapter server-side yang menggunakan API resmi provider dan kredensial merchant milikmu.

## Fitur

- API untuk membuat, melihat, dan membatalkan order.
- Idempotensi berdasarkan `merchant_reference` untuk mencegah order ganda.
- Status pembayaran `creating`, `pending`, `paid`, `expired`, `cancelled`, dan `failed`.
- Database SQLite lokal untuk menyimpan order dan riwayat event.
- Halaman checkout sandbox untuk menyimulasikan pembayaran.
- Callback webhook bertanda tangan HMAC-SHA256, antrean persisten, dan retry otomatis.
- Adapter provider yang dapat ditambahkan tanpa mengubah alur API inti.
- API key melalui header Authorization; tidak menerima kunci melalui URL.
- Dashboard responsif untuk membuat order dan memantau transaksi.

## Menjalankan secara lokal

Gunakan Node.js 22.13 atau lebih baru.

```bash
npm run setup
npm run dev
```

Perintah setup membuat `.env` dengan API key dan webhook secret acak. Simpan API key yang tampil di terminal, buka [http://127.0.0.1:3000](http://127.0.0.1:3000), lalu tempel API key untuk menghubungkan dashboard.

Buat order dari dashboard dan buka tautan checkout di daftar transaksi. Di halaman checkout, pilih **Simulasikan pembayaran berhasil**. Status order berubah menjadi `paid` dan event tersimpan di database lokal.

Untuk menjalankan tanpa mode pantau perubahan file:

```bash
npm start
```

Database tersimpan di `data/rapiqr.sqlite`. File `.env` dan database lokal diabaikan oleh Git.

## API

Semua endpoint pengelolaan order memerlukan header:

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

`merchant_reference` harus unik. Mengirim referensi dan nominal yang sama akan mengembalikan order yang sudah dibuat. Menggunakan referensi sama dengan nominal berbeda menghasilkan `409 Conflict`.

### Melihat pembayaran

```http
GET /api/v1/payments/<payment_id>
GET /api/v1/payments?limit=25
```

### Membatalkan pembayaran

```http
POST /api/v1/payments/<payment_id>/cancel
```

### Status layanan

```http
GET /api/v1/health
```

Checkout membaca informasi minimum dari `GET /api/public/payments/<payment_id>`. Endpoint ini tidak mengembalikan API key atau data merchant sensitif.

## Webhook merchant

Atur URL callback di `.env`:

```env
WEBHOOK_URL=https://merchant.example/webhooks/rapiqr
WEBHOOK_SECRET=ganti-dengan-rahasia-acak-minimal-32-karakter
```

Setiap perubahan status membuat event yang disimpan sebelum dikirim. Callback dikirim sebagai JSON dengan header `X-RapiQR-Event-Id` dan `X-RapiQR-Signature` berformat `t=<unix-time>,v1=<hmac>`. Signature dihitung dari `timestamp + "." + raw_body` menggunakan HMAC-SHA256. Endpoint yang gagal menerima callback akan dicoba ulang dengan jeda bertahap sampai lima percobaan.

## Menambahkan provider

1. Tambahkan adapter di `src/providers/<nama>.js`.
2. Implementasikan `createPayment(payment, context)` untuk membuat transaksi melalui API provider.
3. Implementasikan `normalizeWebhook({ rawBody, headers, config })` untuk memverifikasi signature provider dan mengembalikan reference serta status transaksi.
4. Simpan kredensial provider di environment variable server, jangan di frontend atau Git.
5. Atur `PAYMENT_PROVIDER=<nama>` dan uji adapter menggunakan lingkungan uji resmi provider.

Kontrak adapter dan contoh implementasi ada di [docs/provider-adapter.md](docs/provider-adapter.md). RapiQR Gateway tidak menyertakan kredensial atau endpoint privat milik penyedia pembayaran.

## Pemeriksaan lokal

```bash
npm run check
npm test
```

## Batas penggunaan

Provider sandbox bawaan hanya untuk menguji alur perangkat lunak. Status `paid` dari sandbox tidak menunjukkan dana diterima. Jangan gunakan checkout sandbox untuk menagih pelanggan. Penerimaan pembayaran nyata memerlukan adapter yang sesuai, akun merchant, kredensial produksi, serta pengujian dan konfigurasi dari penyedia pembayaran.

## Lisensi

MIT. Source code boleh digunakan, diubah, dan dibagikan kembali dengan menyertakan pemberitahuan lisensi.

## Tentang

Dibuat oleh [adlnfkhrzmn](https://github.com/adlnfkhrzmn).
