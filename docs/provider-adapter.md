# Membuat adapter provider

RapiQR Gateway memanggil adapter dari sisi server. Adapter menangani komunikasi dengan penyedia pembayaran dan menormalkan notifikasi ke status internal. Jangan menaruh server key, access token, atau rahasia provider di file `public/`.

## 1. Buat modul

Tambahkan file, misalnya `src/providers/acme.js`:

```js
export default {
  name: "acme",

  async createPayment(payment, { publicOrigin, config }) {
    // Kirim order_id, amount, currency, dan expiry ke API resmi provider.
    // Gunakan payment.merchantReference sebagai idempotency key bila didukung.
    // Ambil kredensial dari process.env atau config rahasia server.
    return {
      reference: "provider-transaction-id",
      checkoutUrl: "https://checkout.provider.example/payment/transaction-id",
    };
  },

  async normalizeWebhook({ rawBody, headers, config }) {
    // Verifikasi signature provider atas rawBody sebelum mempercayai event.
    // Kembalikan reference transaksi provider dan status provider.
    return {
      reference: "provider-transaction-id",
      status: "settlement", // paid, settlement, expired, cancelled, denied
    };
  },
};
```

Implementasikan verifikasi signature menggunakan aturan resmi provider, constant-time comparison, dan raw body yang belum diubah. Jangan memakai nominal dari browser sebagai bukti pembayaran. Notifikasi provider yang sudah diverifikasi menjadi sumber perubahan status.

## 2. Aktifkan adapter

Atur `.env`:

```env
PAYMENT_PROVIDER=acme
NODE_ENV=production
```

Kredensial yang diperlukan provider dibaca dari environment variable server. Tambahkan validasi konfigurasi provider di adapter sebelum server dibuka. Rute webhook provider akan tersedia di `POST /api/v1/providers/acme/webhook`.

## 3. Pemetaan status

RapiQR menerima status akhir berikut:

| Status provider | Status RapiQR |
| --- | --- |
| `paid`, `success`, `settlement` | `paid` |
| `expired`, `expire` | `expired` |
| `cancelled`, `canceled`, `cancel` | `cancelled` |
| `failed`, `deny`, `denied` | `failed` |

Transisi akhir bersifat idempotent: event yang dikirim ulang tidak mengganti transaksi yang sudah final.

## Catatan operasional

- Pasang TLS melalui reverse proxy saat server dapat diakses dari internet.
- Batasi dashboard dan endpoint API dengan firewall atau lapisan autentikasi tambahan.
- Simpan backup database dan rahasia provider di luar Git.
- Uji notifikasi, callback, expiry, dan idempotensi di lingkungan uji provider sebelum memakai kredensial produksi.
- Adapter sandbox bawaan hanya menyelesaikan pembayaran simulasi. Adapter provider nyata harus dibuat dan diuji oleh pemilik integrasi.
