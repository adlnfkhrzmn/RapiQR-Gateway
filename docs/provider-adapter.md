# Membuat adapter provider

Adapter berjalan di sisi server. Adapter menghubungkan alur pembayaran RapiQR ke API resmi penyedia yang kamu pilih. Jangan menaruh server key, access token, atau secret provider di folder `public/` atau di repository.

## Kontrak adapter

Buat file `src/providers/<nama>.js`:

```js
export default {
  name: "nama",

  async createPayment(payment, { publicOrigin, config }) {
    // Buat transaksi melalui API resmi provider.
    // Kirim merchantReference, amount, currency, description, dan expiresAt.
    // Gunakan merchantReference sebagai idempotency key jika didukung.
    return {
      reference: "provider-transaction-id",
      checkoutUrl: "https://checkout.provider.example/payment/transaction-id",
    };
  },

  async normalizeWebhook({ rawBody, headers, config }) {
    // Verifikasi signature sesuai dokumentasi resmi provider.
    // Parsing dan validasi event hanya setelah signature benar.
    return {
      reference: "provider-transaction-id",
      status: "settlement",
      reason: null,
    };
  },

  async start({ store, config, logger }) {
    // Opsional: mulai worker rekonsiliasi/polling yang mematuhi rate limit provider.
    // Baca order tertunda dengan store.listPendingPayments("nama").
    // Untuk status final yang sudah diverifikasi, panggil store.transitionPayment(id, status).
    // Hindari menjalankan polling bertumpuk dan simpan jeda yang sesuai kebijakan provider.
    return () => {
      // Hentikan timer/worker saat proses menerima SIGINT atau SIGTERM.
    };
  },
};
```

`createPayment()` harus mengembalikan `reference` yang stabil dari provider dan `checkoutUrl` HTTPS. Gateway menyimpan reference tersebut untuk mencocokkan notifikasi provider.

`normalizeWebhook()` bersifat opsional jika adapter memakai proses rekonsiliasi. Jika digunakan, fungsi ini harus mengembalikan reference yang sama dengan nilai yang diberikan saat transaksi dibuat dan status provider. Gateway memetakan status umum seperti `paid`, `settlement`, `expired`, `cancelled`, `failed`, dan `denied` ke status internal. Event dengan signature tidak valid harus ditolak oleh adapter.

`start()` bersifat opsional dan dijalankan sekali saat proses gateway mulai. Fungsi ini harus memulai worker tanpa menunggu loop polling selesai, lalu segera mengembalikan fungsi cleanup untuk menghentikan timer/worker saat proses dimatikan. `store.listPendingPayments(namaProvider, limit)` hanya mengembalikan order `pending` milik adapter tersebut; `store.transitionPayment(id, status, details)` menerima status akhir `paid`, `expired`, `cancelled`, atau `failed`. Adapter wajib menyediakan paling sedikit satu cara pembaruan status: `normalizeWebhook()` atau `start()`.

## Aktifkan adapter

Atur nama file dan `.env` agar sama. Misalnya `src/providers/acme-pay.js`:

```env
PAYMENT_PROVIDER=acme-pay
ACME_PAY_SERVER_KEY=isi-di-server-saja
```

Adapter dapat membaca konfigurasi rahasia dari `process.env`. Tambahkan validasi konfigurasi agar aplikasi gagal start dengan pesan jelas jika kredensial yang diperlukan tidak tersedia. Mulai ulang aplikasi setelah konfigurasi berubah. Webhook provider akan diterima pada:

```text
POST /api/v1/providers/acme-pay/webhook
```

URL tersebut harus dapat dijangkau oleh provider melalui HTTPS dan harus didaftarkan sesuai dokumentasi provider.

## Keamanan dan operasi

- Verifikasi signature provider atas raw body yang belum diubah; gunakan constant-time comparison.
- Jangan mengubah order menjadi `paid` hanya berdasarkan redirect browser atau nominal yang dikirim browser.
- Gunakan notifikasi server-to-server yang terverifikasi sebagai dasar perubahan status.
- Simpan kredensial di environment server dan jangan commit `.env`.
- Gunakan idempotency key untuk menghindari transaksi ganda jika provider mendukungnya.
- Terapkan batas request dan interval polling sesuai dokumentasi serta kebijakan provider.
- Jalankan satu proses gateway untuk satu file SQLite. Worker rekonsiliasi tambahan harus mencegah eksekusi bertumpuk.
- Uji adapter dengan kredensial dan lingkungan uji resmi provider sebelum memproses pembayaran produksi.
- Backup direktori database `data/` dan rahasia provider secara terpisah.
