const tg = window.Telegram && window.Telegram.WebApp ? window.Telegram.WebApp : null;
if (tg) {
  tg.ready();
  tg.expand();
}

// Change host if your n8n is on another domain.
const API_BASE = "https://flow.gojet.com.tr/webhook/fuelcards/miniapp";

const courierMetaEl = document.getElementById("courierMeta");
const balanceEl = document.getElementById("balance");
const activeListEl = document.getElementById("activeList");
const historyListEl = document.getElementById("historyList");
const errorBoxEl = document.getElementById("errorBox");
const refreshBtnEl = document.getElementById("refreshBtn");

const state = {
  loading: false,
  payload: null,
};

function safeText(v) {
  return String(v ?? "").trim();
}

function showError(err) {
  const msg = typeof err === "string" ? err : (err && err.message) ? err.message : "Bilinmeyen hata";
  errorBoxEl.textContent = msg;
  errorBoxEl.classList.remove("hidden");
  if (tg && tg.showAlert) tg.showAlert(msg);
}

function clearError() {
  errorBoxEl.textContent = "";
  errorBoxEl.classList.add("hidden");
}

function fmtDate(v) {
  const s = safeText(v);
  if (!s) return "-";
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s;
  return d.toLocaleString();
}

function metric(label, value) {
  return `
    <div class="metric">
      <span class="label">${label}</span>
      <span class="value">${value}</span>
    </div>
  `;
}

async function api(path, body = {}) {
  if (!tg || !safeText(tg.initData)) {
    throw new Error("Bu uygulamayi Telegram Mini App icinden acin.");
  }

  const res = await fetch(`${API_BASE}/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ...body,
      initData: tg.initData,
    }),
  });

  let data = null;
  const text = await res.text();
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { ok: false, error: text || "invalid_json_response" };
  }

  if (!res.ok || !data.ok) {
    const err = data.error || `HTTP_${res.status}`;
    throw new Error(err);
  }

  return data;
}

function renderBalance(stats) {
  balanceEl.innerHTML = [
    metric("Tamamlanan", Number(stats.completed || 0)),
    metric("Hakedis", `${Number(stats.accruedTry || 0)} TRY`),
    metric("Odenen", `${Number(stats.paidTry || 0)} TRY`),
    metric("Odeme bekleyen", `${Number(stats.pendingTry || 0)} TRY`),
    metric("Bekleyen basvuru", Number(stats.pendingCount || 0)),
    metric("Aktif teslimat", Number(stats.activeCount || 0)),
  ].join("");
}

function row(label, value) {
  return `<div class="row"><b>${label}:</b> ${safeText(value) || "-"}</div>`;
}

function renderActive(active) {
  if (!Array.isArray(active) || active.length === 0) {
    activeListEl.innerHTML = `<div class="muted">Su an aktif teslimat yok.</div>`;
    return;
  }

  activeListEl.innerHTML = active.map((d) => {
    const dealId = Number(d.dealId || 0);
    const accepted = !!safeText(d.acceptedAt);
    const acceptDisabled = accepted ? "disabled" : "";
    return `
      <div class="item">
        <div class="title">#${dealId || "-"}</div>
        ${row("Sehir", d.city)}
        ${row("Adres", d.address)}
        ${row("Teslimat tipi", d.pickupPlace)}
        ${row("Surucu", d.driverName)}
        ${row("Telefon", d.driverPhone)}
        ${row("Durum", d.stageName || d.stageCode)}
        ${row("Atandi", fmtDate(d.assignedAt))}
        ${accepted ? row("Kabul", fmtDate(d.acceptedAt)) : ""}
        <div class="actions">
          <button class="btn secondary" data-action="accept" data-deal-id="${dealId}" ${acceptDisabled}>Kabul et</button>
          <button class="btn primary" data-action="done" data-deal-id="${dealId}">Tamamla</button>
        </div>
      </div>
    `;
  }).join("");
}

function renderHistory(history) {
  if (!Array.isArray(history) || history.length === 0) {
    historyListEl.innerHTML = `<div class="muted">Gecmis bos.</div>`;
    return;
  }

  historyListEl.innerHTML = history.slice(0, 20).map((d) => `
    <div class="item">
      <div class="title">#${safeText(d.dealId) || "-"}</div>
      ${row("Sehir", d.city)}
      ${row("Adres", d.address)}
      ${row("Teslim", fmtDate(d.deliveredAt))}
      ${row("Odeme", d.payoutStatus)}
      ${row("Tutar", `${Number(d.rateTry || 0)} TRY`)}
    </div>
  `).join("");
}

function render(payload) {
  state.payload = payload;
  const user = payload.user || {};
  const courier = payload.courier || {};
  const userLine = [safeText(user.firstName), safeText(user.lastName)].filter(Boolean).join(" ") || safeText(user.username) || "Kurye";
  const phone = safeText(courier.phone);
  courierMetaEl.textContent = phone ? `${userLine} • ${phone}` : userLine;

  renderBalance(payload.stats || {});
  renderActive(payload.active || []);
  renderHistory(payload.history || []);
}

async function loadSession() {
  if (state.loading) return;
  state.loading = true;
  refreshBtnEl.disabled = true;
  clearError();
  try {
    const data = await api("session");
    render(data);
  } catch (err) {
    showError(err);
  } finally {
    state.loading = false;
    refreshBtnEl.disabled = false;
  }
}

async function onAction(action, dealId) {
  if (!dealId || !["accept", "done"].includes(action)) return;
  try {
    clearError();
    await api("action", { action, dealId: String(dealId) });
    await loadSession();
  } catch (err) {
    showError(err);
  }
}

activeListEl.addEventListener("click", async (e) => {
  const btn = e.target.closest("button[data-action]");
  if (!btn) return;
  const action = btn.getAttribute("data-action");
  const dealId = Number(btn.getAttribute("data-deal-id"));
  btn.disabled = true;
  try {
    await onAction(action, dealId);
  } finally {
    btn.disabled = false;
  }
});

refreshBtnEl.addEventListener("click", loadSession);

loadSession();
