const sessionKey = "rapiqr-dashboard-api-key";
const connectCard = document.querySelector("#connect-card");
const dashboardContent = document.querySelector("#dashboard-content");
const connectForm = document.querySelector("#connect-form");
const connectInput = document.querySelector("#api-key");
const connectMessage = document.querySelector("#connect-message");
const disconnectButton = document.querySelector("#disconnect-button");
const modeLabel = document.querySelector("#mode-label");
const paymentForm = document.querySelector("#payment-form");
const paymentMessage = document.querySelector("#payment-message");
const paymentRows = document.querySelector("#payment-rows");
const eventList = document.querySelector("#event-list");
const toast = document.querySelector("#toast");
let apiKey = sessionStorage.getItem(sessionKey) || "";
let refreshTimer;

const statusNames = {
  creating: "Membuat",
  pending: "Menunggu",
  paid: "Berhasil",
  expired: "Kedaluwarsa",
  cancelled: "Dibatalkan",
  failed: "Gagal",
};

function rupiah(amount) {
  return new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(amount || 0);
}

function dateText(value) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("id-ID", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function showToast(message) {
  toast.textContent = message;
  toast.hidden = false;
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => (toast.hidden = true), 3000);
}

async function request(path, options = {}) {
  const headers = new Headers(options.headers || {});
  headers.set("authorization", `Bearer ${apiKey}`);
  if (options.body) headers.set("content-type", "application/json");
  const response = await fetch(path, { ...options, headers });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error?.message || `Request gagal (${response.status}).`);
  return result;
}

function setConnected(value) {
  connectCard.hidden = value;
  dashboardContent.hidden = !value;
  disconnectButton.hidden = !value;
}

function statusClass(status) {
  return ["creating", "pending", "paid", "expired", "cancelled", "failed"].includes(status) ? status : "pending";
}

function renderPayments(payments) {
  paymentRows.replaceChildren();
  if (!payments.length) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = 4;
    cell.className = "empty-row";
    cell.textContent = "Belum ada transaksi.";
    row.append(cell);
    paymentRows.append(row);
    return;
  }

  for (const payment of payments) {
    const row = document.createElement("tr");
    const reference = document.createElement("td");
    reference.className = "reference-cell";
    const strong = document.createElement("strong");
    strong.textContent = payment.merchant_reference;
    const date = document.createElement("small");
    date.textContent = dateText(payment.created_at);
    reference.append(strong, date);

    const amount = document.createElement("td");
    amount.className = "amount-cell";
    amount.textContent = rupiah(payment.amount);

    const status = document.createElement("td");
    const pill = document.createElement("span");
    pill.className = `status-pill ${statusClass(payment.status)}`;
    pill.textContent = statusNames[payment.status] || payment.status;
    status.append(pill);

    const action = document.createElement("td");
    action.className = "action-cell";
    if (payment.checkout_url && ["pending", "creating"].includes(payment.status)) {
      const link = document.createElement("a");
      link.className = "row-link";
      link.href = payment.checkout_url;
      link.target = "_blank";
      link.rel = "noreferrer";
      link.textContent = "Buka";
      link.setAttribute("aria-label", `Buka checkout ${payment.merchant_reference}`);
      action.append(link);
    }
    row.append(reference, amount, status, action);
    paymentRows.append(row);
  }
}

function renderEvents(events) {
  eventList.replaceChildren();
  if (!events.length) {
    const empty = document.createElement("li");
    empty.className = "event-empty";
    empty.textContent = "Belum ada event.";
    eventList.append(empty);
    return;
  }
  for (const event of events) {
    const item = document.createElement("li");
    const marker = document.createElement("span");
    marker.className = `event-marker ${event.type.endsWith("paid") ? "is-paid" : ""}`;
    const content = document.createElement("div");
    const title = document.createElement("strong");
    title.textContent = `${event.type.replace("payment.", "Pembayaran ")} · ${event.merchant_reference}`;
    const time = document.createElement("small");
    time.textContent = dateText(event.created_at);
    content.append(title, time);
    item.append(marker, content);
    eventList.append(item);
  }
}

async function refreshDashboard() {
  const result = await request("/api/v1/dashboard");
  const { stats, payments, events, provider } = result.data;
  document.querySelector("#stat-total").textContent = stats.total.toLocaleString("id-ID");
  document.querySelector("#stat-pending").textContent = stats.pending.toLocaleString("id-ID");
  document.querySelector("#stat-paid").textContent = stats.paid.toLocaleString("id-ID");
  document.querySelector("#stat-revenue").textContent = rupiah(stats.paid_amount);
  renderPayments(payments);
  renderEvents(events);
  modeLabel.textContent = provider ? `Provider ${provider} aktif` : "Adapter belum dikonfigurasi";
  document.querySelector("#provider-note").hidden = Boolean(provider);
  document.querySelector("#create-button").disabled = !provider;
  document.querySelector("#updated-at").textContent = `Diperbarui ${dateText(new Date().toISOString())} · database tersimpan lokal`;
}

async function connect(candidate) {
  apiKey = candidate;
  try {
    await refreshDashboard();
    sessionStorage.setItem(sessionKey, apiKey);
    connectMessage.textContent = "";
    setConnected(true);
    window.clearInterval(refreshTimer);
    refreshTimer = window.setInterval(() => refreshDashboard().catch(() => {}), 10_000);
  } catch (error) {
    apiKey = "";
    connectMessage.textContent = error.message;
    connectInput.focus();
    throw error;
  }
}

connectForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  connectMessage.textContent = "Menghubungkan…";
  try {
    await connect(connectInput.value.trim());
    connectInput.value = "";
  } catch {
    connectMessage.classList.add("is-error");
  }
});

disconnectButton.addEventListener("click", () => {
  window.clearInterval(refreshTimer);
  sessionStorage.removeItem(sessionKey);
  apiKey = "";
  setConnected(false);
  connectMessage.textContent = "";
});

document.querySelector("#refresh-button").addEventListener("click", async () => {
  try {
    await refreshDashboard();
    showToast("Data transaksi diperbarui.");
  } catch (error) {
    showToast(error.message);
  }
});

paymentForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = document.querySelector("#create-button");
  const formData = new FormData(paymentForm);
  const payload = {
    merchant_reference: String(formData.get("merchant_reference")).trim(),
    amount: Number(formData.get("amount")),
    currency: "IDR",
    description: String(formData.get("description")).trim(),
    expires_in_seconds: Number(formData.get("expires_in_seconds")),
  };
  button.disabled = true;
  paymentMessage.classList.remove("is-error");
  paymentMessage.textContent = "Membuat order…";
  try {
    const result = await request("/api/v1/payments", { method: "POST", body: JSON.stringify(payload) });
    paymentMessage.textContent = result.data.idempotent ? "Order dengan referensi ini sudah tersedia." : "Order berhasil dibuat. Buka checkout dari daftar transaksi.";
    paymentForm.reset();
    document.querySelector("#expiry").value = "900";
    await refreshDashboard();
    showToast("Order pembayaran siap.");
  } catch (error) {
    paymentMessage.textContent = error.message;
    paymentMessage.classList.add("is-error");
  } finally {
    button.disabled = false;
  }
});

if (apiKey) {
  connect(apiKey).catch(() => {
    sessionStorage.removeItem(sessionKey);
    setConnected(false);
  });
}
