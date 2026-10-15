const paymentId = decodeURIComponent(window.location.pathname.split("/").filter(Boolean).at(-1) || "");
const loader = document.querySelector("#checkout-loader");
const content = document.querySelector("#checkout-content");
const errorPanel = document.querySelector("#checkout-error");
const settleButton = document.querySelector("#settle-button");
const message = document.querySelector("#checkout-message");
const statusNames = { creating: "Membuat", pending: "Menunggu", paid: "Berhasil", expired: "Kedaluwarsa", cancelled: "Dibatalkan", failed: "Gagal" };

function rupiah(amount) {
  return new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(amount || 0);
}

function dateText(value) {
  return value ? new Intl.DateTimeFormat("id-ID", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) : "—";
}

function setStatus(status) {
  const statusElement = document.querySelector("#checkout-status");
  statusElement.textContent = statusNames[status] || status;
  statusElement.className = `status-pill ${status}`;
  settleButton.hidden = status !== "pending";
  if (status === "paid") message.textContent = "Pembayaran simulasi berhasil diselesaikan.";
  if (status === "expired") message.textContent = "Batas waktu order sudah lewat.";
  if (status === "cancelled") message.textContent = "Order ini sudah dibatalkan.";
  if (status === "failed") message.textContent = "Order ini gagal diproses.";
}

async function loadPayment() {
  const response = await fetch(`/api/public/payments/${encodeURIComponent(paymentId)}`, { cache: "no-store" });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error?.message || "Detail pembayaran tidak tersedia.");
  const payment = result.data;
  document.querySelector("#checkout-amount").textContent = rupiah(payment.amount);
  document.querySelector("#checkout-description").textContent = payment.description || "Pembayaran QRIS";
  document.querySelector("#checkout-reference").textContent = payment.merchant_reference;
  document.querySelector("#checkout-expiry").textContent = dateText(payment.expires_at);
  setStatus(payment.status);
  loader.hidden = true;
  content.hidden = false;
}

settleButton.addEventListener("click", async () => {
  settleButton.disabled = true;
  message.classList.remove("is-error");
  message.textContent = "Memperbarui status…";
  try {
    const response = await fetch(`/api/sandbox/payments/${encodeURIComponent(paymentId)}/settle`, { method: "POST" });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error?.message || "Status tidak dapat diperbarui.");
    await loadPayment();
  } catch (error) {
    message.textContent = error.message;
    message.classList.add("is-error");
  } finally {
    settleButton.disabled = false;
  }
});

loadPayment().catch((error) => {
  loader.hidden = true;
  errorPanel.hidden = false;
  document.querySelector("#checkout-error-message").textContent = error.message;
});
