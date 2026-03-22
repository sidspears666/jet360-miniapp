(() => {
  function normalizeUrl(v) {
    return String(v == null ? "" : v).trim().replace(/\s+/g, "");
  }

  const tg = window.Telegram && window.Telegram.WebApp ? window.Telegram.WebApp : null;
  const cfg = window.__JET_CONFIG && typeof window.__JET_CONFIG === "object" ? window.__JET_CONFIG : {};
  const cfgEndpoints = cfg.endpoints && typeof cfg.endpoints === "object" ? cfg.endpoints : {};
  const API_BASE = normalizeUrl(cfg.apiBase || "https://flow.gojet.com.tr/webhook");
  const DATA_TEMPLATE = normalizeUrl(cfgEndpoints.dataTemplate || cfg.dataTemplate || `${API_BASE}/courier/:telegramId/:section`);
  const REGISTER_URL = normalizeUrl(cfgEndpoints.registerUrl || cfg.registerUrl || `${API_BASE}/courier/register`);
  const ACTION_TEMPLATE = normalizeUrl(cfgEndpoints.actionTemplate || cfg.actionTemplate || `${API_BASE}/order/:orderId/status`);
  const WEEK = ["Pzt", "Sal", "Car", "Per", "Cum", "Cmt", "Paz"];
  const FLOW = ["pending", "accepted", "completed"];
  const STATUS = {
    pending: { dot: "🟡", text: "Teslimat talebi alindi", chip: "chip-pending", badge: "status-pending", next: "accepted", nextLabel: "Kabul ettim" },
    accepted: { dot: "🟠", text: "Basvuru kabul edildi", chip: "chip-accepted", badge: "status-accepted", next: "completed", nextLabel: "Teslimat tamamlandi" },
    completed: { dot: "🟢", text: "Teslimat tamamlandi", chip: "chip-completed", badge: "status-completed", next: null, nextLabel: null },
    cancelled: { dot: "🔴", text: "Siparis iptal edildi", chip: "chip-cancelled", badge: "status-cancelled", next: null, nextLabel: null },
  };

  const state = {
    telegramId: "",
    user: null,
    screen: "welcome",
    tab: "orders",
    orders: [],
    history: [],
    balance: { completed: 0, accrued: 0, paid: 0, pending: 0, pendingCount: 0, weekly: WEEK.map((d) => ({ day: d, amount: 0 })) },
    detailId: null,
    detailUiStatus: null,
    cancelId: null,
    busy: false,
  };

  const el = {
    topBackBtn: document.getElementById("topBackBtn"),
    topbarTitle: document.getElementById("topbarTitle"),
    topbarSub: document.getElementById("topbarSub"),
    screenWelcome: document.getElementById("screenWelcome"),
    screenShare: document.getElementById("screenShare"),
    screenApp: document.getElementById("screenApp"),
    bottomNav: document.getElementById("bottomNav"),
    goToShareBtn: document.getElementById("goToShareBtn"),
    shareBackBtn: document.getElementById("shareBackBtn"),
    requestContactBtn: document.getElementById("requestContactBtn"),
    profileName: document.getElementById("profileName"),
    profileHandle: document.getElementById("profileHandle"),
    manualPhoneInput: document.getElementById("manualPhoneInput"),
    manualRegisterBtn: document.getElementById("manualRegisterBtn"),
    panelOrders: document.getElementById("panelOrders"),
    panelDetail: document.getElementById("panelDetail"),
    panelHistory: document.getElementById("panelHistory"),
    panelBalance: document.getElementById("panelBalance"),
    activeCount: document.getElementById("activeCount"),
    ordersList: document.getElementById("ordersList"),
    refreshOrdersBtn: document.getElementById("refreshOrdersBtn"),
    detailNo: document.getElementById("detailNo"),
    detailCity: document.getElementById("detailCity"),
    detailType: document.getElementById("detailType"),
    detailAddress: document.getElementById("detailAddress"),
    detailPhone: document.getElementById("detailPhone"),
    callBtn: document.getElementById("callBtn"),
    statusBadge: document.getElementById("statusBadge"),
    statusDot: document.getElementById("statusDot"),
    statusText: document.getElementById("statusText"),
    detailActions: document.getElementById("detailActions"),
    historyList: document.getElementById("historyList"),
    balanceMain: document.getElementById("balanceMain"),
    balanceDelta: document.getElementById("balanceDelta"),
    metricCompleted: document.getElementById("metricCompleted"),
    metricPaid: document.getElementById("metricPaid"),
    metricAccrued: document.getElementById("metricAccrued"),
    metricPending: document.getElementById("metricPending"),
    weeklyChart: document.getElementById("weeklyChart"),
    sheetOverlay: document.getElementById("sheetOverlay"),
    confirmCancelBtn: document.getElementById("confirmCancelBtn"),
    closeSheetBtn: document.getElementById("closeSheetBtn"),
    toast: document.getElementById("toast"),
  };

  const s = (v) => String(v == null ? "" : v).trim();
  const n = (v, d = 0) => Number.isFinite(Number(v)) ? Number(v) : d;
  const esc = (v) => s(v).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
  const fmtTry = (v) => `${n(v).toLocaleString("tr-TR")} TRY`;
  const fmtDate = (v) => {
    const x = s(v);
    if (!x) return "-";
    const d = new Date(x);
    return Number.isNaN(d.getTime()) ? x : d.toLocaleString("tr-TR");
  };
  const phoneFmt = (raw) => {
    const d = s(raw).replace(/\D/g, "");
    if (!d) return "";
    const p = d.startsWith("90") && d.length >= 12 ? d.slice(2) : d;
    return p.length === 10 ? `+90 ${p.slice(0, 3)} ${p.slice(3, 6)} ${p.slice(6, 8)} ${p.slice(8, 10)}` : (s(raw).startsWith("+") ? s(raw) : `+${d}`);
  };
  const phoneDigits = (raw) => {
    const d = s(raw).replace(/\D/g, "");
    if (!d) return "";
    return d.startsWith("00") ? d.slice(2) : d;
  };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const isHttpError = (e, status) => Number(e && e.status) === Number(status) || s(e && e.message).toUpperCase() === `HTTP_${Number(status)}`;

  function err(msg, status = 0, payload = null) {
    const e = new Error(msg);
    e.status = status;
    e.payload = payload;
    return e;
  }

  function humanError(e) {
    const m = s(e && e.message).toLowerCase();
    if (e && e.status === 404) return "Kayit bulunamadi. Once numaranizi paylasin.";
    if (m.includes("courier_not_linked")) return "Kurye henuz baglanmadi. Numaranizi paylasin veya alttan elle girin.";
    if (m.includes("network") || m.includes("timeout")) return "Ag baglantisi hatasi.";
    if (m.includes("failed to fetch")) return "API baglantisi yok (CORS / URL / SSL).";
    if (m.includes("request_contact")) return "Telefon paylasimi desteklenmiyor.";
    if (m.includes("contact_phone_not_available")) return "Telegram numarayi Mini App'e vermedi. Alttan elle girin.";
    if (m.includes("contact_denied")) return "Telefon paylasimi iptal edildi.";
    if (m.includes("contact_phone")) return "Telefon numarasi alinamadi.";
    return s(e && e.message) || "Bilinmeyen hata";
  }

  function toast(msg, ms = 2600) {
    el.toast.textContent = s(msg);
    el.toast.classList.remove("hidden");
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => el.toast.classList.add("hidden"), ms);
  }

  function setBusy(v) {
    state.busy = !!v;
    el.requestContactBtn.disabled = state.busy;
    el.manualRegisterBtn.disabled = state.busy;
    el.refreshOrdersBtn.disabled = state.busy;
  }

  function applyTemplate(template, params) {
    let out = s(template);
    Object.keys(params || {}).forEach((k) => {
      out = out.replace(new RegExp(`:${k}\\b`, "g"), encodeURIComponent(String(params[k] == null ? "" : params[k])));
    });
    return out;
  }

  async function req(method, targetUrl, body) {
    let url = s(targetUrl);
    const initData = tg ? s(tg.initData) : "";
    let payload;
    const headers = { Accept: "application/json" };

    if (String(method).toUpperCase() === "GET") {
      if (initData) {
        const sep = url.includes("?") ? "&" : "?";
        url = `${url}${sep}initData=${encodeURIComponent(initData)}`;
      }
    } else {
      payload = { ...(body && typeof body === "object" ? body : {}) };
      if (initData && !payload.initData) payload.initData = initData;
      headers["Content-Type"] = "text/plain;charset=UTF-8";
    }

    for (let i = 0; i <= 1; i += 1) {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 12000);
      try {
        const r = await fetch(url, {
          method,
          headers,
          body: payload == null ? undefined : JSON.stringify(payload),
          signal: ctrl.signal
        });
        const txt = await r.text();
        let p = {};
        try { p = txt ? JSON.parse(txt) : {}; } catch { p = { raw: txt }; }
        if (!r.ok) throw err(s(p.error || p.message || `HTTP_${r.status}`), r.status, p);
        if (p && typeof p === "object" && p.ok === false) throw err(s(p.error || p.message || "request_failed"), r.status, p);
        return p;
      } catch (e) {
        const net = e && (e.name === "AbortError" || !Object.prototype.hasOwnProperty.call(e, "status"));
        if (i < 1 && net) { await sleep(250); continue; }
        if (e && e.name === "AbortError") throw err("network_timeout");
        throw e;
      } finally { clearTimeout(t); }
    }
    throw err("network_error");
  }

  const api = {
    getOrders: (id) => req("GET", applyTemplate(DATA_TEMPLATE, { telegramId: id, section: "orders" })),
    getHistory: (id) => req("GET", applyTemplate(DATA_TEMPLATE, { telegramId: id, section: "history" })),
    getBalance: (id) => req("GET", applyTemplate(DATA_TEMPLATE, { telegramId: id, section: "balance" })),
    register: (payload) => req("POST", REGISTER_URL, payload),
    patchStatus: (id, status) => req("POST", applyTemplate(ACTION_TEMPLATE, { orderId: id }), { status }),
  };

  function mapStatus(raw, stage, delivered, cancelled) {
    if (cancelled) return "cancelled";
    if (delivered) return "completed";
    const x = s(raw).toLowerCase();
    const c = s(stage).toUpperCase();
    if (x === "pending" || x === "new" || c === "C11:NEW" || c === "C11:UC_MWR34I") return "pending";
    if (x === "accepted" || c === "C11:PREPAYMENT_INVOIC") return "accepted";
    if (x === "completed" || x === "done" || c === "C11:EXECUTING") return "completed";
    if (x === "cancelled" || x === "canceled") return "cancelled";
    return "pending";
  }

  function order(raw) {
    const id = n(raw.id ?? raw.delivery_deal_id ?? raw.dealId ?? raw.order_id, 0);
    const delivered = raw.delivered_at || raw.deliveredAt || null;
    const cancelled = raw.cancelled_at || raw.canceled_at || raw.cancelledAt || null;
    return {
      id,
      city: s(raw.city),
      type: s(raw.type || raw.pickup_place || raw.pickupPlace),
      address: s(raw.address || raw.delivery_address),
      phone: phoneFmt(raw.phone || raw.driver_phone || raw.driverPhone),
      status: mapStatus(raw.status, raw.stage_code || raw.stageCode, delivered, cancelled),
      amount: n(raw.amount ?? raw.rate_try ?? raw.rateTry, 0),
      deliveredAt: delivered,
      updatedAt: raw.last_event_at || raw.updated_at || raw.updatedAt || null,
    };
  }

  function arrayFrom(payload, key) {
    const x = payload && typeof payload === "object" && !Array.isArray(payload) ? (payload.data ?? payload.result ?? payload) : payload;
    const a = Array.isArray(x) ? x : (Array.isArray(x && x[key]) ? x[key] : (Array.isArray(x && x.orders) ? x.orders : (Array.isArray(x && x.history) ? x.history : [])));
    return a.map(order).filter((o) => o.id > 0);
  }

  function balanceFrom(payload) {
    const x = payload && typeof payload === "object" && !Array.isArray(payload) ? (payload.data ?? payload.result ?? payload) : {};
    const b = x.balance && typeof x.balance === "object" ? x.balance : x;
    const weekly = Array.isArray(b.weekly) ? b.weekly : WEEK.map((d) => ({ day: d, amount: 0 }));
    return {
      completed: n(b.completed ?? b.completedCount, 0),
      accrued: n(b.accrued ?? b.accruedTry ?? b.hakedis, 0),
      paid: n(b.paid ?? b.paidTry ?? b.odenen, 0),
      pending: n(b.pending ?? b.pendingTry ?? b.odemeBekleyen, 0),
      pendingCount: n(b.pendingCount ?? b.waitingCount, 0),
      weekly: weekly.slice(0, 7).map((x, i) => ({ day: s(x.day || x.label || WEEK[i] || ""), amount: n(x.amount ?? x.value ?? x, 0) })),
    };
  }

  function top(title, sub) {
    el.topbarTitle.textContent = s(title);
    el.topbarSub.textContent = s(sub || "online");
  }

  function syncBack() {
    const show = state.screen === "share" || state.detailId != null;
    el.topBackBtn.classList.toggle("hidden", !show);
    if (tg && tg.BackButton) { if (show) tg.BackButton.show(); else tg.BackButton.hide(); }
  }

  function setScreen(screen) {
    state.screen = screen;
    [el.screenWelcome, el.screenShare, el.screenApp].forEach((x) => x.classList.remove("active"));
    if (screen === "welcome") el.screenWelcome.classList.add("active");
    if (screen === "share") el.screenShare.classList.add("active");
    if (screen === "app") el.screenApp.classList.add("active");
    el.bottomNav.classList.toggle("hidden", screen !== "app");
    syncBack();
  }

  function setTab(tab) {
    state.tab = tab;
    state.detailId = null;
    state.detailUiStatus = null;
    [el.panelOrders, el.panelDetail, el.panelHistory, el.panelBalance].forEach((x) => x.classList.remove("active"));
    if (tab === "orders") el.panelOrders.classList.add("active");
    if (tab === "history") el.panelHistory.classList.add("active");
    if (tab === "balance") el.panelBalance.classList.add("active");
    document.querySelectorAll(".nav-btn").forEach((b) => b.classList.toggle("active", b.dataset.tab === tab));
    top("JET Delivery Bot", "online");
    syncBack();
  }

  function openDetail(id) {
    const o = state.orders.find((x) => x.id === id) || state.history.find((x) => x.id === id);
    if (!o) return;
    state.detailId = id;
    state.detailUiStatus = o.status;
    [el.panelOrders, el.panelHistory, el.panelBalance].forEach((x) => x.classList.remove("active"));
    el.panelDetail.classList.add("active");
    top(`# ${id}`, "siparis");
    renderDetail(o);
    syncBack();
  }

  function closeDetail() {
    state.detailId = null;
    state.detailUiStatus = null;
    el.panelDetail.classList.remove("active");
    if (state.tab === "orders") el.panelOrders.classList.add("active");
    if (state.tab === "history") el.panelHistory.classList.add("active");
    if (state.tab === "balance") el.panelBalance.classList.add("active");
    top("JET Delivery Bot", "online");
    syncBack();
  }

  function renderOrders() {
    const items = state.orders.filter((x) => x.status === "pending" || x.status === "accepted").sort((a, b) => b.id - a.id);
    el.activeCount.textContent = `${items.length} aktif`;
    if (!items.length) {
      el.ordersList.innerHTML = '<div class="order-item"><p class="order-meta">Su an aktif siparis yok.</p></div>';
      return;
    }
    el.ordersList.innerHTML = items.map((o) => {
      const c = STATUS[o.status] || STATUS.pending;
      return `<article class="order-item" data-order-id="${o.id}">
        <div class="order-top"><div class="order-id">${c.dot} # ${o.id}</div><span class="status-chip ${c.chip}">${c.text}</span></div>
        <p class="order-meta">📍 ${esc(o.address || "-")}</p>
        <p class="order-meta">🏙 ${esc(o.city || "-")} · 🏷 ${esc(o.type || "-")}</p>
      </article>`;
    }).join("");
  }

  function renderHistory() {
    if (!state.history.length) {
      el.historyList.innerHTML = '<div class="history-item"><p class="history-meta">Gecmis bos.</p></div>';
      return;
    }
    el.historyList.innerHTML = state.history.slice().sort((a, b) => b.id - a.id).map((o) => {
      const c = STATUS[o.status] || STATUS.completed;
      return `<article class="history-item" data-order-id="${o.id}">
        <div class="history-top"><div class="history-id">${c.dot} # ${o.id}</div><span class="status-chip ${c.chip}">${c.text}</span></div>
        <p class="history-meta">📍 ${esc(o.address || "-")}</p>
        <p class="history-meta">🏙 ${esc(o.city || "-")} · 📅 ${esc(fmtDate(o.deliveredAt || o.updatedAt))}</p>
      </article>`;
    }).join("");
  }

  function renderBalance() {
    el.metricCompleted.textContent = String(n(state.balance.completed));
    el.metricPaid.textContent = fmtTry(state.balance.paid);
    el.metricAccrued.textContent = fmtTry(state.balance.accrued);
    el.metricPending.textContent = fmtTry(state.balance.pending);
    const main = Math.max(n(state.balance.accrued), n(state.balance.paid));
    el.balanceMain.textContent = fmtTry(main);
    el.balanceDelta.textContent = `${n(state.balance.pendingCount)} odeme bekleyen siparis`;

    const w = state.balance.weekly.length ? state.balance.weekly : WEEK.map((d) => ({ day: d, amount: 0 }));
    const max = w.reduce((a, x) => Math.max(a, n(x.amount)), 0) || 1;
    const maxIdx = w.reduce((b, x, i, arr) => (n(x.amount) > n(arr[b].amount) ? i : b), 0);
    el.weeklyChart.innerHTML = w.map((x, i) => {
      const h = Math.max(6, Math.round((n(x.amount) / max) * 64));
      return `<div class="bar-wrap"><div class="bar ${i === maxIdx ? "active" : ""}" style="height:${h}px"></div><span class="bar-label">${esc(x.day)}</span></div>`;
    }).join("");
  }

  function renderDetail(o) {
    const status = state.detailUiStatus || o.status;
    const c = STATUS[status] || STATUS.pending;
    el.detailNo.textContent = `Talep No: ${o.id}`;
    el.detailCity.textContent = o.city || "-";
    el.detailType.textContent = o.type || "-";
    el.detailAddress.textContent = o.address || "-";
    el.detailPhone.textContent = o.phone || "-";
    el.statusBadge.className = `status-badge ${c.badge}`;
    el.statusDot.textContent = c.dot;
    el.statusText.textContent = c.text;

    const btns = [];
    if (c.next) btns.push(`<button class="btn primary full" data-detail-action="advance">${esc(c.nextLabel)}</button>`);
    else btns.push('<button class="btn secondary full" disabled>Tamamlandi</button>');
    const idx = FLOW.indexOf(status);
    if (idx > 0 && status !== "cancelled") btns.push('<button class="btn secondary full" data-detail-action="ui-back">← Geri (sadece ekran)</button>');
    if (status !== "completed" && status !== "cancelled") btns.push('<button class="btn danger full" data-detail-action="cancel">Siparisi iptal et</button>');
    el.detailActions.innerHTML = btns.join("");
  }

  function renderAll() {
    renderOrders();
    renderHistory();
    renderBalance();
    if (state.detailId != null) {
      const o = state.orders.find((x) => x.id === state.detailId) || state.history.find((x) => x.id === state.detailId);
      if (!o) closeDetail(); else renderDetail(o);
    }
  }

  function merge(active, history) {
    const m = new Map();
    [...active, ...history].forEach((o) => { if (o.id) m.set(o.id, o); });
    const all = [...m.values()];
    state.orders = all.filter((o) => o.status === "pending" || o.status === "accepted");
    state.history = all.filter((o) => o.status === "completed" || o.status === "cancelled");
  }

  function applyStatus(id, status) {
    const oid = Number(id);
    const inArr = (arr) => {
      const i = arr.findIndex((x) => x.id === oid);
      if (i >= 0) arr[i] = { ...arr[i], status, updatedAt: new Date().toISOString() };
      return i;
    };
    const ai = inArr(state.orders);
    const hi = inArr(state.history);
    const src = ai >= 0 ? state.orders[ai] : (hi >= 0 ? state.history[hi] : null);
    if (!src) return;
    if (status === "completed" || status === "cancelled") {
      state.orders = state.orders.filter((x) => x.id !== oid);
      state.history = [{ ...src, status }, ...state.history.filter((x) => x.id !== oid)];
    } else {
      state.history = state.history.filter((x) => x.id !== oid);
      if (!state.orders.some((x) => x.id === oid)) state.orders.unshift({ ...src, status });
    }
  }

  async function loadData() {
    if (!state.telegramId) throw err("telegram_id_missing");
    setBusy(true);
    try {
      const o = await api.getOrders(state.telegramId);
      const h = await api.getHistory(state.telegramId).catch((e) => isHttpError(e, 404) ? [] : Promise.reject(e));
      const b = await api.getBalance(state.telegramId).catch((e) => isHttpError(e, 404) ? {} : Promise.reject(e));
      merge(arrayFrom(o, "orders"), arrayFrom(h, "history"));
      state.balance = balanceFrom(b);
      renderAll();
    } finally { setBusy(false); }
  }

  async function requestContact() {
    if (!tg || typeof tg.requestContact !== "function") throw err("request_contact_not_supported");
    return new Promise((resolve, reject) => {
      let done = false;
      const onContactRequested = (payload) => {
        const p = payload && typeof payload === "object" ? payload : {};
        end({ ok: s(p.status).toLowerCase() === "sent", status: s(p.status).toLowerCase() || "sent", eventPayload: p }, false);
      };
      const end = (v, bad) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        if (tg && typeof tg.offEvent === "function") {
          try { tg.offEvent("contactRequested", onContactRequested); } catch {}
        }
        bad ? reject(v) : resolve(v);
      };
      const timer = setTimeout(() => end(err("contact_timeout"), true), 15000);
      try {
        if (tg && typeof tg.onEvent === "function") tg.onEvent("contactRequested", onContactRequested);
        const maybe = tg.requestContact((r) => {
          if (typeof r === "boolean") end({ ok: r, status: r ? "sent" : "cancelled" }, false);
          else end(r || {}, false);
        });
        if (maybe && typeof maybe.then === "function") {
          maybe.then((r) => {
            if (typeof r === "boolean") end({ ok: r, status: r ? "sent" : "cancelled" }, false);
            else end(r || {}, false);
          }).catch((e) => end(e, true));
        } else if (maybe && typeof maybe === "object") {
          end(maybe, false);
        } else if (typeof maybe === "boolean") {
          end({ ok: maybe, status: maybe ? "sent" : "cancelled" }, false);
        }
      } catch (e) { end(e, true); }
    });
  }

  function parseMaybeJson(v) {
    const raw = s(v);
    if (!raw || (raw[0] !== "{" && raw[0] !== "[")) return null;
    try { return JSON.parse(raw); } catch { return null; }
  }

  function extractPhoneFromUnknown(input) {
    const visited = new Set();
    const queue = [input];
    const pick = (v) => {
      const raw = s(v);
      if (!raw) return "";
      const digits = raw.replace(/\D/g, "");
      if (digits.length < 8 || digits.length > 15) return "";
      return raw;
    };

    for (let i = 0; i < queue.length && i < 200; i += 1) {
      const cur = queue[i];
      if (cur == null) continue;
      const t = typeof cur;
      if (t === "string") {
        const ph = pick(cur);
        if (ph) return ph;
        const parsed = parseMaybeJson(cur);
        if (parsed && !visited.has(parsed)) {
          visited.add(parsed);
          queue.push(parsed);
        }
        continue;
      }
      if (t !== "object") continue;
      if (visited.has(cur)) continue;
      visited.add(cur);

      const direct = [
        cur.phone_number,
        cur.phone,
        cur.contact_phone,
        cur.msisdn,
        cur.number,
      ];
      for (const candidate of direct) {
        const ph = pick(candidate);
        if (ph) return ph;
      }

      if (Array.isArray(cur)) {
        cur.forEach((v) => queue.push(v));
      } else {
        Object.keys(cur).forEach((k) => queue.push(cur[k]));
      }
    }
    return "";
  }

  function contactData(payload) {
    const p = payload && typeof payload === "object" ? payload : {};
    const x = p.contact || p.responseUnsafe || p.result || p.response || {};
    const status = s(p.status || x.status || p.response_status || (p.ok === true ? "sent" : "")).toLowerCase();
    const ok = payload === true || p.ok === true || status === "sent" || status === "ok" || status === "allowed";
    const phoneCandidate = p.phone_number || p.phone || x.phone_number || x.phone || extractPhoneFromUnknown(p) || extractPhoneFromUnknown(x) || (state.user && state.user.phone_number) || "";
    return {
      phone: phoneFmt(phoneCandidate),
      firstName: s(p.first_name || x.first_name || (state.user && state.user.first_name)),
      lastName: s(p.last_name || x.last_name || (state.user && state.user.last_name)),
      ok,
      status,
    };
  }

  async function getRequestedContactFromTelegram() {
    if (!tg || typeof tg.getRequestedContact !== "function") return null;
    return new Promise((resolve) => {
      let done = false;
      const end = (v) => { if (done) return; done = true; resolve(v || null); };
      try {
        const maybe = tg.getRequestedContact((r) => end(r || null));
        if (maybe && typeof maybe.then === "function") maybe.then((r) => end(r || null)).catch(() => end(null));
        else if (maybe && typeof maybe === "object") end(maybe);
        else setTimeout(() => end(null), 300);
      } catch { end(null); }
    });
  }

  async function enrichPhoneAfterContactRequest(baseContact) {
    const current = { ...(baseContact || {}) };
    if (current.phone) return current;
    for (let i = 0; i < 3; i += 1) {
      const extraRaw = await getRequestedContactFromTelegram();
      const extra = contactData(extraRaw || {});
      if (extra.phone) {
        current.phone = extra.phone;
        if (!current.firstName) current.firstName = extra.firstName;
        if (!current.lastName) current.lastName = extra.lastName;
        break;
      }
      await sleep(350);
    }
    return current;
  }

  function openManualBox() {
    const manualBox = document.querySelector(".manual-box");
    if (manualBox) manualBox.open = true;
    if (el.manualPhoneInput) el.manualPhoneInput.focus();
  }

  async function waitRegistrationLink() {
    for (let i = 0; i < 6; i += 1) {
      try {
        const o = await api.getOrders(state.telegramId);
        const h = await api.getHistory(state.telegramId).catch((e) => isHttpError(e, 404) ? [] : Promise.reject(e));
        const b = await api.getBalance(state.telegramId).catch((e) => isHttpError(e, 404) ? {} : Promise.reject(e));
        merge(arrayFrom(o, "orders"), arrayFrom(h, "history"));
        state.balance = balanceFrom(b);
        return true;
      } catch (e) {
        if (isHttpError(e, 404)) {
          await sleep(1200);
          continue;
        }
        throw e;
      }
    }
    return false;
  }

  async function register(phone, firstName, lastName) {
    const clean = phoneDigits(phone);
    if (!clean) throw err("phone_required");
    const name = [s(firstName), s(lastName)].filter(Boolean).join(" ").trim() || "Kurye";
    await api.register({
      phone: clean,
      name,
      telegramId: state.telegramId,
      username: state.user ? s(state.user.username) : ""
    });
  }

  async function doRegisterWithContact() {
    setBusy(true);
    try {
      const raw = await requestContact();
      let c = contactData(raw);
      if (!c.phone && (c.ok || c.status === "sent")) c = await enrichPhoneAfterContactRequest(c);
      if (!c.phone) {
        openManualBox();
        if (!c.ok && c.status && c.status !== "sent") throw err("contact_denied");
        throw err("contact_phone_not_available");
      }
      await register(c.phone, c.firstName, c.lastName);
      await loadData();
      setScreen("app");
      setTab("orders");
      toast("Kayit tamamlandi.");
    } catch (e) { toast(humanError(e)); } finally { setBusy(false); }
  }

  async function doRegisterManual() {
    const phone = s(el.manualPhoneInput.value);
    if (!phone) { toast("Telefon numarasi girin."); return; }
    setBusy(true);
    try {
      await register(phone, state.user ? s(state.user.first_name) : "", state.user ? s(state.user.last_name) : "");
      await loadData();
      setScreen("app");
      setTab("orders");
      toast("Kayit tamamlandi.");
    } catch (e) { toast(humanError(e)); } finally { setBusy(false); }
  }

  async function commitStatus(id, status) {
    if (!id || !status) return;
    setBusy(true);
    try {
      await api.patchStatus(id, status);
      applyStatus(id, status);
      state.detailUiStatus = status;
      renderAll();
      toast("Durum guncellendi.");
      try { await loadData(); } catch {}
    } catch (e) { toast(humanError(e)); } finally { setBusy(false); }
  }

  function openSheet(id) {
    state.cancelId = Number(id);
    el.sheetOverlay.classList.remove("hidden");
  }
  function closeSheet() {
    state.cancelId = null;
    el.sheetOverlay.classList.add("hidden");
  }

  function attach() {
    el.goToShareBtn.addEventListener("click", () => { setScreen("share"); top("Kayit", "telefon onayi"); });
    el.shareBackBtn.addEventListener("click", () => { setScreen("welcome"); top("JET Delivery Bot", "online"); });
    el.requestContactBtn.addEventListener("click", doRegisterWithContact);
    el.manualRegisterBtn.addEventListener("click", doRegisterManual);
    el.refreshOrdersBtn.addEventListener("click", async () => { try { await loadData(); } catch (e) { toast(humanError(e)); } });

    el.bottomNav.addEventListener("click", (ev) => {
      const b = ev.target.closest(".nav-btn");
      if (!b) return;
      setTab(s(b.dataset.tab));
    });
    el.ordersList.addEventListener("click", (ev) => {
      const c = ev.target.closest("[data-order-id]");
      if (c) openDetail(Number(c.dataset.orderId));
    });
    el.historyList.addEventListener("click", (ev) => {
      const c = ev.target.closest("[data-order-id]");
      if (c) openDetail(Number(c.dataset.orderId));
    });
    el.detailActions.addEventListener("click", async (ev) => {
      const b = ev.target.closest("[data-detail-action]");
      if (!b || state.detailId == null) return;
      const o = state.orders.find((x) => x.id === state.detailId) || state.history.find((x) => x.id === state.detailId);
      if (!o) return;
      const st = state.detailUiStatus || o.status;
      const act = b.dataset.detailAction;
      if (act === "advance") {
        const c = STATUS[st] || STATUS.pending;
        if (c.next) await commitStatus(o.id, c.next);
        return;
      }
      if (act === "ui-back") {
        const i = FLOW.indexOf(st);
        if (i > 0) { state.detailUiStatus = FLOW[i - 1]; renderDetail(o); }
        return;
      }
      if (act === "cancel") openSheet(o.id);
    });

    el.callBtn.addEventListener("click", () => {
      if (state.detailId == null) return;
      const o = state.orders.find((x) => x.id === state.detailId) || state.history.find((x) => x.id === state.detailId);
      if (!o) return;
      const tel = s(o.phone).replace(/\s/g, "");
      if (tel) window.open(`tel:${tel}`);
    });
    el.closeSheetBtn.addEventListener("click", closeSheet);
    el.sheetOverlay.addEventListener("click", (ev) => { if (ev.target === el.sheetOverlay) closeSheet(); });
    el.confirmCancelBtn.addEventListener("click", async () => { if (state.cancelId) { const id = state.cancelId; closeSheet(); await commitStatus(id, "cancelled"); } });

    const back = () => {
      if (state.detailId != null) { closeDetail(); return; }
      if (state.screen === "share") { setScreen("welcome"); top("JET Delivery Bot", "online"); return; }
      if (state.screen === "app" && state.tab !== "orders") { setTab("orders"); return; }
      if (tg && typeof tg.close === "function") tg.close();
    };
    el.topBackBtn.addEventListener("click", back);
    if (tg && tg.BackButton && typeof tg.BackButton.onClick === "function") tg.BackButton.onClick(back);
  }

  async function bootstrap() {
    state.user = tg && tg.initDataUnsafe ? tg.initDataUnsafe.user || null : null;
    state.telegramId = state.user && state.user.id != null ? String(state.user.id) : "";
    if (state.user) {
      const full = [s(state.user.first_name), s(state.user.last_name)].filter(Boolean).join(" ");
      el.profileName.textContent = full || "Kurye";
      el.profileHandle.textContent = s(state.user.username) ? `@${s(state.user.username)}` : "Telegram kullanicisi";
    }
    if (!state.telegramId) { setScreen("welcome"); toast("Bu uygulamayi Telegram icinden acin."); return; }
    try {
      await loadData();
      setScreen("app");
      setTab("orders");
    } catch (e) {
      const msg = s(e && e.message).toLowerCase();
      if (isHttpError(e, 404) || msg.includes("courier_not_linked")) {
        setScreen("share");
        top("Kayit", "telefon onayi");
        return;
      }
      setScreen("welcome");
      toast(humanError(e));
    }
  }

  function init() {
    if (tg) { tg.ready(); tg.expand(); }
    attach();
    bootstrap();
  }

  init();
})();
