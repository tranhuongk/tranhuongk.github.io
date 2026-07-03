// Supabase Client variables
const supabaseUrl = "https://lnazpyhoojqotnanrvqf.supabase.co";
const supabaseAnonKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxuYXpweWhvb2pxb3RuYW5ydnFmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI1NzAyNjcsImV4cCI6MjA5ODE0NjI2N30.uc4WAXKm_UDKoLEm260mu0RHyHaL4HGtPI3sG-TbJSg";
let supabaseClient = null;
let session = null;
let chartMini = null;
let chartModal = null;
const SYNC_REQUEST_TIMEOUT_MS = 30 * 60 * 1000;
const SYNC_PROGRESS_STORAGE_KEY = "galax_admin_sync_progress_durations_v1";
const CUSTOM_RANGE_VALUE = "__custom__";
const SOURCE_FILTER_ALL_VALUE = "all";
const SOURCE_FILTER_ADMIN_EMAIL = "admin@admin.com";
const ORDER_SYNC_BATCH_LIMIT = 500;
const ORDER_SYNC_SCAN_LIMIT = 5000;
const ORDER_SYNC_MAX_RUNS = 20;
const ORDER_SYNC_RETRY_COOLDOWN_MINUTES = 60;
const SYNC_PROGRESS_PHASES = [
  { key: "sync-earnings", label: "Đồng bộ finalized earnings", defaultDurationMs: 3000 },
  { key: "sync-estimates", label: "Đồng bộ Estimated sales reports", defaultDurationMs: 25000 },
  { key: "sync-orders", label: "Enrich Orders API", defaultDurationMs: 45000 },
];
let syncProgressCurrent = 0;
let syncProgressTimer = null;
let syncProgressPlan = null;
let syncProgressPhase = null;

function cleanAppTitle(pkg, fallback) {
  const cleanPkg = String(pkg).trim().toLowerCase();
  if (cleanPkg === "__adjustments__" || cleanPkg === "adjustments") return "Khác";
  if (fallback) {
    const cleanFallback = String(fallback).trim().toLowerCase();
    if (cleanFallback === "__adjustments__" || cleanFallback === "adjustments") return "Khác";
    return fallback;
  }
  if (pkg && pkg.includes(".")) {
    const parts = pkg.split(".");
    const name = parts[parts.length - 1];
    return name.charAt(0).toUpperCase() + name.slice(1);
  }
  return pkg || "Unknown";
}

function isAdjustmentApp(id, title) {
  const cleanId = String(id || "").trim().toLowerCase();
  const cleanTitle = String(title || "").trim().toLowerCase();
  return cleanId === "__adjustments__" ||
    cleanId === "adjustments" ||
    cleanTitle === "khác" ||
    cleanTitle === "adjustments";
}

function appRecordById(id) {
  const cleanId = String(id || "").trim().toLowerCase();
  return appsList.find(app => String(app.id || "").trim().toLowerCase() === cleanId) || null;
}

function isPublishedApp(id, title) {
  const app = appRecordById(id) || {};
  const boolFields = ["published", "is_published", "isPublished", "active", "is_active"];
  for (const field of boolFields) {
    if (typeof app[field] === "boolean") return app[field];
  }

  const statusText = String(
    app.publish_status ||
    app.play_status ||
    app.status ||
    app.state ||
    ""
  ).trim().toLowerCase();
  if (statusText) {
    if (/unpublish|not[_\s-]*publish|removed|deleted|suspend|inactive|archived|draft/.test(statusText)) return false;
    if (/publish|production|active|live/.test(statusText)) return true;
  }

  return Boolean(appRecordById(id));
}

function shouldHideTopApp(app) {
  return Math.abs(numberValue(app.total)) < 0.005 && !isPublishedApp(app.id, app.title);
}

// Local caching of data
let appsList = [];
let earningsData = [];
let currentUsdToVndRate = 25000;
// KPI summary computed by the `dashboard-summary` edge function — the single
// source of truth shared with the Telegram bot. When present (and no filter is
// applied) the headline KPI cards render these values verbatim so the web and
// the bot can never disagree.
let serverSummary = null;
let topAppsSelectedMonth = null;
let topPlayersSelectedMonth = null;
let topAppsFilterMode = "month";
let topPlayersFilterMode = "month";
let topAppsRangePopupOpen = false;
let topPlayersRangePopupOpen = false;
let topAppsRangeRequestId = 0;
let topPlayersRangeRequestId = 0;

// Fetch exchange rate dynamically
async function fetchExchangeRate() {
  try {
    const res = await fetch("https://portal.vietcombank.com.vn/Usercontrols/TVPortal.TyGia/pXML.aspx");
    const text = await res.text();
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(text, "text/xml");
    const exrates = xmlDoc.getElementsByTagName("Exrate");
    for (let i = 0; i < exrates.length; i++) {
      if (exrates[i].getAttribute("CurrencyCode") === "USD") {
        currentUsdToVndRate = parseFloat(exrates[i].getAttribute("Transfer") || exrates[i].getAttribute("Sell"));
        return;
      }
    }
  } catch (err) {
    console.log("Failed to fetch VCB exchange rate, using fallback", err);
  }
  
  try {
    const res = await fetch("https://open.er-api.com/v6/latest/USD");
    const data = await res.json();
    if (data && data.rates && data.rates.VND) {
      currentUsdToVndRate = data.rates.VND;
    }
  } catch (err) {
    console.log("Failed to fetch open exchange rate", err);
  }
}

// DOM Elements
const authScreen = document.getElementById("auth-screen");
const dashboardScreen = document.getElementById("dashboard-screen");
const loginForm = document.getElementById("login-form");
const loginEmail = document.getElementById("login-email");
const loginPassword = document.getElementById("login-password");
const configToggle = document.getElementById("config-toggle");
const configFields = document.getElementById("config-fields");
const sbUrlInput = document.getElementById("supabase-url");
const sbAnonKeyInput = document.getElementById("supabase-anon-key");
const authError = document.getElementById("auth-error");

const btnLogout = document.getElementById("btn-logout");
const btnSync = document.getElementById("btn-sync");
const navExchangeRate = document.getElementById("nav-exchange-rate");
const btnCloseSyncOverlay = document.getElementById("btn-close-sync-overlay");

const kpiPrev2Month = document.getElementById("kpi-prev2-month");
const kpiPrev2MonthVnd = document.getElementById("kpi-prev2-month-vnd");
const kpiPrev2MonthLabel = document.getElementById("kpi-prev2-month-label");
const kpiPrevMonth = document.getElementById("kpi-prev-month");
const kpiPrevMonthVnd = document.getElementById("kpi-prev-month-vnd");
const kpiPrevMonthLabel = document.getElementById("kpi-prev-month-label");
const kpiCurrentEstimate = document.getElementById("kpi-current-estimate");
const kpiCurrentEstimateVnd = document.getElementById("kpi-current-estimate-vnd");
const kpiCurrentEstimateLabel = document.getElementById("kpi-current-estimate-label");

const topAppsList = document.getElementById("top-apps-list");
const topAppsSyncInfo = document.getElementById("top-apps-sync-info");
const topAppsMonthSelect = document.getElementById("top-apps-month");
const topAppsCustomRangeBtn = document.getElementById("top-apps-custom-range-btn");
const topAppsRangeControls = document.getElementById("top-apps-range");
const topAppsRangeStart = document.getElementById("top-apps-range-start");
const topAppsRangeEnd = document.getElementById("top-apps-range-end");
const topPlayersList = document.getElementById("top-players-list");
const topPlayersMonthSelect = document.getElementById("top-players-month");
const topPlayersCustomRangeBtn = document.getElementById("top-players-custom-range-btn");
const topPlayersRangeControls = document.getElementById("top-players-range");
const topPlayersRangeStart = document.getElementById("top-players-range-start");
const topPlayersRangeEnd = document.getElementById("top-players-range-end");
const monthlyChartCard = document.getElementById("monthly-chart-card");
const chartKpiSubtitle = document.getElementById("chart-kpi-subtitle");
const chartModalEl = document.getElementById("chart-modal");
const btnCloseChartModal = document.querySelector(".btn-close-chart-modal");
const filterSource = document.getElementById("filter-source");
const tableSearch = document.getElementById("table-search");
const earningsTable = document.getElementById("earnings-table");
const tableHeaderRow = document.getElementById("table-header-row");
const tableBody = document.getElementById("table-body");

const incomeModal = document.getElementById("income-modal");
const incomeForm = document.getElementById("income-form");
const incomeAppSelect = document.getElementById("income-app");
const incomeMonth = document.getElementById("income-month");
const incomeSource = document.getElementById("income-source");
const incomeAmount = document.getElementById("income-amount");
const incomeCurrency = document.getElementById("income-currency");
const incomeNote = document.getElementById("income-note");
const modalTitle = document.getElementById("modal-title");
const editEarningId = document.getElementById("edit-earning-id");

const newAppForm = document.getElementById("new-app-form");
const btnNewApp = document.getElementById("btn-new-app");
const btnCancelNewApp = document.getElementById("btn-cancel-new-app");
const btnSaveNewApp = document.getElementById("btn-save-new-app");
const newAppId = document.getElementById("new-app-id");
const newAppTitle = document.getElementById("new-app-title");

const syncOverlay = document.getElementById("sync-overlay");
const syncLogs = document.getElementById("sync-logs");
const syncLoader = document.getElementById("sync-loader");
const syncTitle = document.getElementById("sync-title");
const syncSubtitle = document.getElementById("sync-subtitle");
const syncProgressValue = document.getElementById("sync-progress-value");
const syncProgressFill = document.getElementById("sync-progress-fill");

// --- Initialization ---
document.addEventListener("DOMContentLoaded", async () => {
  // Fetch exchange rate
  await fetchExchangeRate();

  // Load connection settings
  if (sbUrlInput) sbUrlInput.value = supabaseUrl;
  if (sbAnonKeyInput) sbAnonKeyInput.value = supabaseAnonKey;

  // Event Listeners
  if (configToggle) {
    configToggle.addEventListener("click", () => {
      configFields.classList.toggle("hidden");
      const icon = configToggle.querySelector(".fa-chevron-down");
      if (icon) {
        icon.classList.toggle("fa-chevron-up");
        icon.classList.toggle("fa-chevron-down");
      }
    });
  }

  loginForm.addEventListener("submit", handleLogin);
  btnLogout.addEventListener("click", handleLogout);
  btnSync.addEventListener("click", triggerSync);
  if (monthlyChartCard) {
    monthlyChartCard.addEventListener("click", openChartModal);
    monthlyChartCard.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        openChartModal();
      }
    });
  }
  if (btnCloseChartModal) btnCloseChartModal.addEventListener("click", closeChartModal);
  if (chartModalEl) {
    chartModalEl.addEventListener("click", (e) => {
      if (e.target === chartModalEl) closeChartModal();
    });
  }
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && chartModalEl && !chartModalEl.classList.contains("hidden")) {
      closeChartModal();
    }
    if (e.key === "Escape") {
      closeRangePopups();
    }
  });
  
  document.querySelectorAll(".btn-close-modal").forEach(btn => {
    btn.addEventListener("click", closeIncomeModal);
  });

  // RTDN order detail modal: close button + click-outside.
  document.querySelectorAll(".btn-close-rtdn-detail").forEach(btn => {
    btn.addEventListener("click", () => window.closeRtdnDetail && window.closeRtdnDetail());
  });
  const rtdnModalEl = document.getElementById("rtdn-detail-modal");
  if (rtdnModalEl) {
    rtdnModalEl.addEventListener("click", (e) => {
      if (e.target === rtdnModalEl) window.closeRtdnDetail();
    });
  }

  incomeForm.addEventListener("submit", handleIncomeSubmit);
  
  // App Creation Subform
  btnNewApp.addEventListener("click", () => newAppForm.classList.remove("hidden"));
  btnCancelNewApp.addEventListener("click", () => {
    newAppForm.classList.add("hidden");
    newAppId.value = "";
    newAppTitle.value = "";
  });
  btnSaveNewApp.addEventListener("click", handleSaveNewApp);

  // Filters
  filterSource.addEventListener("change", renderDashboard);
  tableSearch.addEventListener("input", renderDashboard);
  if (topAppsMonthSelect) {
    topAppsMonthSelect.addEventListener("change", () => {
      topAppsFilterMode = "month";
      topAppsSelectedMonth = topAppsMonthSelect.value || null;
      topAppsRangePopupOpen = false;
      updateRangeControlVisibility();
      renderDashboard();
    });
  }
  if (topAppsCustomRangeBtn) {
    topAppsCustomRangeBtn.addEventListener("click", (event) => {
      event.stopPropagation();
      const shouldOpen = !topAppsRangePopupOpen;
      topAppsFilterMode = "custom";
      topAppsRangePopupOpen = shouldOpen;
      topPlayersRangePopupOpen = false;
      ensureRangeInputs("top-apps");
      updateRangeControlVisibility();
      renderDashboard();
    });
  }
  [topAppsRangeStart, topAppsRangeEnd].forEach(input => {
    if (!input) return;
    input.addEventListener("change", () => {
      topAppsFilterMode = "custom";
      topAppsRangePopupOpen = true;
      if (topAppsMonthSelect) topAppsMonthSelect.value = CUSTOM_RANGE_VALUE;
      updateRangeControlVisibility();
      renderDashboard();
    });
  });
  if (topPlayersMonthSelect) {
    topPlayersMonthSelect.addEventListener("change", () => {
      topPlayersFilterMode = "month";
      topPlayersSelectedMonth = topPlayersMonthSelect.value || null;
      topPlayersRangePopupOpen = false;
      updateRangeControlVisibility();
      renderTopPlayers();
    });
  }
  if (topPlayersCustomRangeBtn) {
    topPlayersCustomRangeBtn.addEventListener("click", (event) => {
      event.stopPropagation();
      const shouldOpen = !topPlayersRangePopupOpen;
      topPlayersFilterMode = "custom";
      topPlayersRangePopupOpen = shouldOpen;
      topAppsRangePopupOpen = false;
      ensureRangeInputs("top-players");
      updateRangeControlVisibility();
      renderTopPlayers();
    });
  }
  [topPlayersRangeStart, topPlayersRangeEnd].forEach(input => {
    if (!input) return;
    input.addEventListener("change", () => {
      topPlayersFilterMode = "custom";
      topPlayersRangePopupOpen = true;
      if (topPlayersMonthSelect) topPlayersMonthSelect.value = CUSTOM_RANGE_VALUE;
      updateRangeControlVisibility();
      renderTopPlayers();
    });
  });
  [topAppsRangeControls, topPlayersRangeControls].forEach(control => {
    if (!control) return;
    control.addEventListener("click", (event) => event.stopPropagation());
  });
  document.querySelectorAll("[data-range-close]").forEach(button => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      const target = button.getAttribute("data-range-close");
      if (target === "top-apps") topAppsRangePopupOpen = false;
      if (target === "top-players") topPlayersRangePopupOpen = false;
      updateRangeControlVisibility();
    });
  });
  document.addEventListener("click", (event) => {
    if (isRangePopupEventTarget(event.target)) return;
    closeRangePopups();
  });
  
  btnCloseSyncOverlay.addEventListener("click", () => {
    syncOverlay.classList.add("hidden");
    loadDataAndRender();
  });

  // Try to initialize Supabase
  initSupabase();
  const { data } = await supabaseClient.auth.getSession();
  if (data && data.session) {
    session = data.session;
    updateSourceFilterAccess();
    showScreen("dashboard");
    loadDataAndRender();
  } else {
    updateSourceFilterAccess();
    showScreen("auth");
  }
});

function initSupabase() {
  supabaseClient = supabase.createClient(supabaseUrl, supabaseAnonKey);
}

function showScreen(screen) {
  if (screen === "auth") {
    authScreen.classList.remove("hidden");
    dashboardScreen.classList.add("hidden");
  } else {
    authScreen.classList.add("hidden");
    dashboardScreen.classList.remove("hidden");
  }
}

function currentSessionEmail() {
  return String(session && session.user && session.user.email || "").trim().toLowerCase();
}

function canViewAllSourceFilter() {
  return currentSessionEmail() === SOURCE_FILTER_ADMIN_EMAIL;
}

function updateSourceFilterAccess() {
  if (!filterSource) return;

  const canViewFilter = canViewAllSourceFilter();
  filterSource.classList.toggle("hidden", !canViewFilter);

  if (!canViewFilter || !filterSource.value) {
    filterSource.value = SOURCE_FILTER_ALL_VALUE;
  }
}

// --- Authentication Handler ---
async function handleLogin(e) {
  e.preventDefault();
  authError.classList.add("hidden");

  let email = loginEmail.value.trim();
  const password = loginPassword.value;

  if (email === "admin") {
    email = "huongtv.uet@gmail.com";
  }

  const btn = loginForm.querySelector("button[type='submit']");
  btn.disabled = true;
  btn.querySelector("span").textContent = "Đang kết nối...";

  try {
    const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
    if (error) throw error;
    
    session = data.session;
    updateSourceFilterAccess();
    showScreen("dashboard");
    loadDataAndRender();
  } catch (err) {
    showError(err.message || "Đăng nhập thất bại. Kiểm tra lại thông tin đăng nhập.");
  } finally {
    btn.disabled = false;
    btn.querySelector("span").textContent = "Đăng nhập";
  }
}

async function handleLogout() {
  if (supabaseClient) {
    await supabaseClient.auth.signOut();
  }
  session = null;
  updateSourceFilterAccess();
  showScreen("auth");
}

function showError(msg) {
  authError.textContent = msg;
  authError.classList.remove("hidden");
}

// --- Data Fetching ---
async function loadDataAndRender() {
  if (!supabaseClient) return;

  // Preferred path: pull everything from the shared `dashboard-summary` edge
  // function so the KPI numbers, exchange rate, and app titles match the
  // Telegram bot exactly (same computation, same rate snapshot).
  try {
    const res = await fetch(`${supabaseUrl}/functions/v1/dashboard-summary`, {
      headers: {
        apikey: supabaseAnonKey,
        Authorization: `Bearer ${session ? session.access_token : supabaseAnonKey}`,
      },
    });
    if (res.ok) {
      const s = await res.json();
      if (!s.error) {
        serverSummary = s;
        currentUsdToVndRate = s.rate || currentUsdToVndRate;
        appsList = (s.apps || []).map(a => ({ ...a, title: cleanAppTitle(a.id, a.title) }));
        earningsData = s.earnings || [];
        populateAppDropdown();
        renderDashboard();
        await populateTopPlayersMonthOptions();
        renderTopPlayers();
        return;
      }
    }
    console.warn("dashboard-summary unavailable, falling back to direct table reads.");
  } catch (err) {
    console.warn("dashboard-summary fetch failed, falling back:", err);
  }

  // Fallback: read the tables directly (KPIs then computed client-side).
  serverSummary = null;
  try {
    const { data: apps, error: appsErr } = await supabaseClient
      .from("apps")
      .select("*")
      .order("title");
    if (appsErr) throw appsErr;
    appsList = (apps || []).map(a => ({
      ...a,
      title: cleanAppTitle(a.id, a.title)
    }));

    const { data: earnings, error: earnErr } = await supabaseClient
      .from("earnings")
      .select("*")
      .order("month", { ascending: false });
    if (earnErr) throw earnErr;
    earningsData = earnings || [];

    populateAppDropdown();
    renderDashboard();
    await populateTopPlayersMonthOptions();
    renderTopPlayers();
  } catch (err) {
    console.error("Lỗi khi tải dữ liệu:", err);
    alert("Không thể tải dữ liệu từ Supabase: " + err.message);
  }
}

function populateAppDropdown() {
  incomeAppSelect.innerHTML = appsList.map(a => `<option value="${a.id}">${a.title} (${a.id})</option>`).join("");
}

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (value == null || value === "") return [];
  return [value];
}

function hasOwnValue(obj, key) {
  return obj && Object.prototype.hasOwnProperty.call(obj, key) && obj[key] != null;
}

function looksLikeGcsConfigError(message) {
  return /PLAY_BUCKET|SA_JSON_B64|Google Cloud Storage|GCS|bucket|service account|credentials|private_key/i
    .test(String(message || ""));
}

async function readJsonResponse(response) {
  const bodyText = await response.text();
  if (!bodyText) return {};
  try {
    return JSON.parse(bodyText);
  } catch {
    return { error: bodyText };
  }
}

function formatGcsApiLine(gcs) {
  if (!gcs || typeof gcs !== "object") return "";
  const status = [gcs.status, gcs.statusText].filter(Boolean).join(" ");
  const operation = gcs.operation || "request";
  const target = gcs.target ? ` (${gcs.target})` : "";
  return `GCS ${operation}: ${status || "unknown status"}${target}`;
}

function numberValue(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function getOrderSyncDetails(details) {
  if (!details || typeof details !== "object") return {};
  if (details.orderSync && typeof details.orderSync === "object") return details.orderSync;
  const step = details.steps && details.steps["sync-orders"];
  if (step && step.details && typeof step.details === "object") return step.details;
  return {};
}

function openChartModal() {
  if (!chartModalEl) return;
  chartModalEl.classList.remove("hidden");
  if (monthlyChartCard) monthlyChartCard.setAttribute("aria-expanded", "true");
  window.requestAnimationFrame(() => {
    if (chartModal) chartModal.resize();
  });
}

function closeChartModal() {
  if (!chartModalEl) return;
  chartModalEl.classList.add("hidden");
  if (monthlyChartCard) monthlyChartCard.setAttribute("aria-expanded", "false");
}

function clampProgress(value) {
  return Math.max(0, Math.min(100, Math.round(numberValue(value))));
}

function setSyncProgress(value, state = "") {
  const rawPercent = clampProgress(value);
  const percent = rawPercent <= 0 || state === "error"
    ? rawPercent
    : Math.max(syncProgressCurrent, rawPercent);
  syncProgressCurrent = percent;
  if (syncProgressValue) syncProgressValue.textContent = `${percent}%`;
  if (syncProgressFill) {
    syncProgressFill.style.width = `${percent}%`;
    syncProgressFill.classList.toggle("is-complete", state === "complete");
    syncProgressFill.classList.toggle("is-error", state === "error");
  }
}

async function fetchWithTimeout(url, options = {}, timeoutMs = SYNC_REQUEST_TIMEOUT_MS) {
  if (typeof AbortController === "undefined") {
    return fetch(url, options);
  }

  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
    });
  } finally {
    window.clearTimeout(timeoutId);
  }
}

function elapsedMsSince(startedAt) {
  return Math.round((performance.now() - startedAt) * 100) / 100;
}

function formatElapsed(ms) {
  const n = Number(ms);
  if (!Number.isFinite(n)) return "";
  return n >= 1000 ? `${(n / 1000).toFixed(1)}s` : `${Math.round(n)}ms`;
}

function formatCount(value) {
  return new Intl.NumberFormat("vi-VN").format(numberValue(value));
}

function readSyncProgressDurations() {
  const durations = Object.fromEntries(
    SYNC_PROGRESS_PHASES.map(phase => [phase.key, phase.defaultDurationMs])
  );
  try {
    const parsed = JSON.parse(localStorage.getItem(SYNC_PROGRESS_STORAGE_KEY) || "{}");
    SYNC_PROGRESS_PHASES.forEach(phase => {
      const stored = numberValue(parsed[phase.key], phase.defaultDurationMs);
      if (stored > 500 && stored < SYNC_REQUEST_TIMEOUT_MS) {
        durations[phase.key] = stored;
      }
    });
  } catch {
    // Ignore corrupt local progress history and fall back to defaults.
  }
  return durations;
}

function saveSyncProgressDuration(phaseKey, elapsedMs) {
  const elapsed = numberValue(elapsedMs);
  if (!elapsed || elapsed <= 0) return;

  const durations = readSyncProgressDurations();
  const previous = numberValue(durations[phaseKey], elapsed);
  const smoothed = previous
    ? Math.round(previous * 0.35 + elapsed * 0.65)
    : Math.round(elapsed);
  durations[phaseKey] = Math.max(800, Math.min(SYNC_REQUEST_TIMEOUT_MS, smoothed));

  try {
    localStorage.setItem(SYNC_PROGRESS_STORAGE_KEY, JSON.stringify(durations));
  } catch {
    // Storage is optional; progress still works for the current run.
  }
}

function buildSyncProgressPlan() {
  const durations = readSyncProgressDurations();
  const totalDuration = SYNC_PROGRESS_PHASES.reduce(
    (sum, phase) => sum + Math.max(1, numberValue(durations[phase.key], phase.defaultDurationMs)),
    0,
  );
  const phases = {};
  let cursor = 0;

  SYNC_PROGRESS_PHASES.forEach((phase, index) => {
    const durationMs = Math.max(1, numberValue(durations[phase.key], phase.defaultDurationMs));
    const span = index === SYNC_PROGRESS_PHASES.length - 1
      ? 100 - cursor
      : Math.max(2, (durationMs / totalDuration) * 100);
    const end = index === SYNC_PROGRESS_PHASES.length - 1
      ? 100
      : Math.min(98, cursor + span);
    const reserved = Math.max(1, Math.min(4, (end - cursor) * 0.12));

    phases[phase.key] = {
      ...phase,
      durationMs,
      start: cursor,
      end,
      softEnd: Math.max(cursor, end - reserved),
    };
    cursor = end;
  });

  return { phases, durations };
}

function stopSyncProgressTimer() {
  if (syncProgressTimer) {
    window.clearInterval(syncProgressTimer);
    syncProgressTimer = null;
  }
  syncProgressPhase = null;
}

function phaseSubtitle(phase, elapsedMs) {
  const estimated = formatElapsed(phase.durationMs);
  const elapsed = formatElapsed(elapsedMs);
  if (elapsedMs > phase.durationMs * 1.1) {
    return `${phase.label}: đang chạy ${elapsed}, lâu hơn dự kiến ${estimated}...`;
  }
  return `${phase.label}: ${elapsed} / dự kiến ${estimated}...`;
}

function tickSyncProgressPhase() {
  if (!syncProgressPhase) return;

  const elapsedMs = performance.now() - syncProgressPhase.startedAt;
  const rawRatio = Math.min(1.4, elapsedMs / Math.max(1, syncProgressPhase.durationMs));
  const ratio = Math.min(0.985, rawRatio);
  const eased = 1 - Math.pow(1 - ratio, 2);
  const nextPercent = syncProgressPhase.start +
    (syncProgressPhase.softEnd - syncProgressPhase.start) * eased;

  setSyncProgress(nextPercent);
  if (syncSubtitle) {
    syncSubtitle.textContent = phaseSubtitle(syncProgressPhase, elapsedMs);
  }
}

function startSyncProgressPhase(phaseKey) {
  if (!syncProgressPlan) syncProgressPlan = buildSyncProgressPlan();
  const phase = syncProgressPlan.phases[phaseKey];
  if (!phase) return;

  stopSyncProgressTimer();
  syncProgressPhase = {
    ...phase,
    startedAt: performance.now(),
  };
  setSyncProgress(phase.start);
  tickSyncProgressPhase();
  syncProgressTimer = window.setInterval(tickSyncProgressPhase, 250);
}

function completeSyncProgressPhase(phaseKey, elapsedMs) {
  stopSyncProgressTimer();
  saveSyncProgressDuration(phaseKey, elapsedMs);
  const phase = syncProgressPlan && syncProgressPlan.phases[phaseKey];
  if (phase) setSyncProgress(phase.end);
}

function stepDetails(result) {
  return result && result.details && typeof result.details === "object"
    ? result.details
    : {};
}

function estimateMonthsFromDetails(details) {
  return asArray(details.estimatedReportMonths)
    .map(m => String(m))
    .filter(m => /^\d{6}$/.test(m));
}

function logFinalizedProgress(details, elapsedMs) {
  const processed = asArray(details.finalizedMonthsProcessed);
  const available = asArray(details.finalizedMonthsAvailable);
  const skipped = asArray(details.finalizedMonthsSkipped);
  const rows = numberValue(details.earningsSyncedCount);
  const totalMonths = Math.max(processed.length + skipped.length, available.length);
  const monthPart = totalMonths
    ? `${formatCount(processed.length)}/${formatCount(totalMonths)} tháng cần xử lý`
    : `${formatCount(processed.length)} tháng`;
  addLog(`Finalized earnings: ${formatCount(rows)} rows, ${monthPart}, ${formatElapsed(elapsedMs)}`, "green");
}

function logEstimateProgress(details, elapsedMs) {
  const saved = numberValue(details.estimatesSavedCount);
  const submitted = numberValue(details.estimatesSubmittedCount);
  const available = numberValue(details.estimatesAvailableCount);
  const months = estimateMonthsFromDetails(details);
  const denominator = submitted || available;
  const rowPart = denominator
    ? `${formatCount(saved)}/${formatCount(denominator)} rows mới đã insert`
    : `${formatCount(saved)} rows mới đã insert`;
  const reportPart = available && available !== denominator
    ? `, ${formatCount(available)} rows trong report`
    : "";
  const monthPart = months.length ? `, tháng ${months.join(", ")}` : "";
  addLog(`Estimated sales: ${rowPart}${reportPart}${monthPart}, ${formatElapsed(elapsedMs)}`, "green");
}

const ORDER_SYNC_SUM_FIELDS = [
  "rtdnScanned",
  "estimatesScanned",
  "scanned",
  "candidates",
  "rtdnCandidates",
  "estimateCandidates",
  "ordersFetched",
  "updatedTransactions",
  "updatedRtdnTransactions",
  "updatedEstimates",
  "updatedOrders",
  "delayedStill",
  "delayedStillRtdn",
  "delayedStillEstimates",
  "noOrderReturned",
  "skippedNoOrderId",
  "skippedRecentEstimateRetries",
  "batchRequests",
  "batchRetries",
  "batchFailures",
  "batchSplits",
  "individualRequests",
  "candidateBatches",
  "estimateBatches",
  "rtdnBatches",
  "errorsCount",
];

function mergeOrderSyncAggregate(target, source) {
  for (const field of ORDER_SYNC_SUM_FIELDS) {
    target[field] = numberValue(target[field]) + numberValue(source[field]);
  }
  target.days = source.days || target.days;
  target.dbBatchSize = source.dbBatchSize || target.dbBatchSize;
  target.googleBatchSize = source.googleBatchSize || target.googleBatchSize;
  target.parallelBatches = source.parallelBatches || target.parallelBatches;
  target.maxCandidates = source.maxCandidates || target.maxCandidates;
  target.estimateRetryCooldownMinutes = source.estimateRetryCooldownMinutes || target.estimateRetryCooldownMinutes;
  target.estimateScope = source.estimateScope || target.estimateScope;
  target.hasMore = Boolean(source.hasMore);
  target.hasMoreEstimates = Boolean(source.hasMoreEstimates);
  target.hasMoreRtdn = Boolean(source.hasMoreRtdn);
  target.dryRun = Boolean(source.dryRun);
  target.estimateEarningsRefresh = source.estimateEarningsRefresh || target.estimateEarningsRefresh || null;
  target.errors = [
    ...asArray(target.errors),
    ...asArray(source.errors),
  ].slice(0, 10);
}

function createOrderSyncAggregate(source) {
  return {
    success: true,
    source,
    processingOrder: ["estimates", "rtdn", "refresh_estimate_earnings"],
    runs: [],
    runsCount: 0,
    errors: [],
    hasMore: false,
    stoppedByMaxRuns: false,
  };
}

function logOrderProgress(details, elapsedMs) {
  const candidates = numberValue(details.candidates);
  const updated = hasOwnValue(details, "updatedOrders")
    ? numberValue(details.updatedOrders)
    : numberValue(details.updatedTransactions) + numberValue(details.updatedEstimates);
  const delayedStill = numberValue(details.delayedStill);
  const fetched = numberValue(details.ordersFetched);
  const batches = numberValue(details.candidateBatches);
  const batchSize = numberValue(details.dbBatchSize);
  const parallel = numberValue(details.parallelBatches, 1);
  const runs = numberValue(details.runsCount || (Array.isArray(details.runs) ? details.runs.length : 0));
  const candidatePart = candidates
    ? `${formatCount(candidates)}/${formatCount(candidates)} transactions`
    : "0 transaction cần enrich";
  const batchPart = batches
    ? `, ${formatCount(batches)} batch x ${formatCount(batchSize)} rows, song song ${formatCount(parallel)}`
    : "";
  const runPart = runs ? `, ${formatCount(runs)} lượt` : "";
  const morePart = details.hasMore ? ", còn backlog cho lượt sau" : "";
  addLog(`Orders API: ${candidatePart}${batchPart}${runPart}, fetched ${formatCount(fetched)}, updated ${formatCount(updated)}, còn delay ${formatCount(delayedStill)}${morePart}, ${formatElapsed(elapsedMs)}`, "green");
}

async function invokeAdminSyncStep(name, payload) {
  const startedAt = performance.now();
  const response = await fetchWithTimeout(`${supabaseUrl}/functions/v1/${name}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "apikey": supabaseAnonKey,
      "Authorization": `Bearer ${session.access_token}`,
    },
    body: JSON.stringify(payload),
  }, SYNC_REQUEST_TIMEOUT_MS);

  const result = await readJsonResponse(response);
  const elapsedMs = elapsedMsSince(startedAt);
  if (!response.ok) {
    const error = new Error(result.error || `Step ${name} failed with HTTP ${response.status}`);
    error.errorType = result.errorType || "admin_sync_step_failed";
    error.details = result.details || { response: result };
    error.failedStep = name;
    error.status = response.status;
    error.elapsedMs = elapsedMs;
    throw error;
  }

  return {
    status: response.status,
    elapsedMs,
    body: result,
  };
}

function buildAdminSyncResult(earningsStep, estimatesStep, ordersStep, totalElapsedMs) {
  const earningsDetails = stepDetails(earningsStep.body);
  const estimateDetails = stepDetails(estimatesStep.body);
  const orderDetails = ordersStep.body || {};
  const estimateMonths = estimateMonthsFromDetails(estimateDetails);
  const monthsSynced = Array.from(new Set([
    ...asArray(earningsDetails.monthsSynced).map(String),
    ...estimateMonths,
  ]));

  return {
    success: true,
    message: "Successfully synced Google Play finalized earnings, estimates, and delayed order revenue.",
    details: {
      syncScope: "google_play_full",
      processingOrder: ["sync-earnings", "sync-estimates", "sync-orders"],
      monthsSynced,
      finalizedMonthsAvailable: earningsDetails.finalizedMonthsAvailable || [],
      finalizedMonthsProcessed: earningsDetails.finalizedMonthsProcessed || [],
      finalizedMonthsSkipped: earningsDetails.finalizedMonthsSkipped || [],
      finalizedMonthsRebuild: earningsDetails.finalizedMonthsRebuild || false,
      latestFinalizedMonth: earningsDetails.latestFinalizedMonth || estimateDetails.latestFinalizedMonth || null,
      appsSyncedCount: Number(earningsDetails.appsSyncedCount || 0) + Number(estimateDetails.appsSyncedCount || 0),
      finalizedAppsSyncedCount: Number(earningsDetails.appsSyncedCount || 0),
      estimateAppsSyncedCount: Number(estimateDetails.appsSyncedCount || 0),
      earningsSyncedCount: Number(earningsDetails.earningsSyncedCount || 0),
      estimatesSavedCount: estimateDetails.estimatesSavedCount || 0,
      estimatesAvailableCount: estimateDetails.estimatesAvailableCount || 0,
      estimatedReportMonth: estimateDetails.estimatedReportMonth || null,
      estimatedReportMonths: estimateMonths,
      estimatesSubmittedCount: estimateDetails.estimatesSubmittedCount || 0,
      estimatesRebuilt: estimateDetails.estimatesRebuilt || false,
      estimatesRebuildSkipped: estimateDetails.estimatesRebuildSkipped || false,
      estimatesRebuildSkipReason: estimateDetails.estimatesRebuildSkipReason || null,
      orderSync: orderDetails,
      orderSyncEstimateLimit: ORDER_SYNC_BATCH_LIMIT,
      orderSyncMaxRuns: ORDER_SYNC_MAX_RUNS,
      estimateEarningsRefresh: orderDetails.estimateEarningsRefresh || null,
      adminIconSync: {
        finalized: earningsDetails.adminIconSync || null,
        estimates: estimateDetails.adminIconSync || null,
      },
      gcsPrimaryServiceAccount: estimateDetails.gcsPrimaryServiceAccount || earningsDetails.gcsPrimaryServiceAccount || null,
      gcsBackupConfigured: Boolean(estimateDetails.gcsBackupConfigured || earningsDetails.gcsBackupConfigured),
      gcsBackupUsed: Boolean(estimateDetails.gcsBackupUsed || earningsDetails.gcsBackupUsed),
      gcsBackupFallbackCount: Number(estimateDetails.gcsBackupFallbackCount || 0) + Number(earningsDetails.gcsBackupFallbackCount || 0),
      gcsBackupServiceAccount: estimateDetails.gcsBackupServiceAccount || earningsDetails.gcsBackupServiceAccount || null,
      gcsBackupReason: estimateDetails.gcsBackupReason || earningsDetails.gcsBackupReason || null,
      steps: {
        "sync-earnings": {
          status: earningsStep.status,
          elapsedMs: earningsStep.elapsedMs,
          details: earningsDetails,
        },
        "sync-estimates": {
          status: estimatesStep.status,
          elapsedMs: estimatesStep.elapsedMs,
          details: estimateDetails,
        },
        "sync-orders": {
          status: ordersStep.status,
          elapsedMs: ordersStep.elapsedMs,
          details: orderDetails,
        },
      },
      timingsMs: [
        { name: "edge.sync-earnings.invoke", ms: earningsStep.elapsedMs },
        { name: "edge.sync-estimates.invoke", ms: estimatesStep.elapsedMs },
        { name: "edge.sync-orders.invoke", ms: ordersStep.elapsedMs },
        { name: "total", ms: totalElapsedMs },
      ],
    },
  };
}

async function runAdminOrdersSyncLoop({ source, estimateMonths }) {
  const startedAt = performance.now();
  const aggregate = createOrderSyncAggregate(`${source}:sync-orders`);
  let lastStatus = 200;

  for (let run = 1; run <= ORDER_SYNC_MAX_RUNS; run++) {
    addLog(`Orders API enrichment: lượt ${run}/${ORDER_SYNC_MAX_RUNS}, tối đa ${formatCount(ORDER_SYNC_BATCH_LIMIT)} transactions`, "blue");
    const step = await invokeAdminSyncStep("sync-orders", {
      days: 3,
      rtdnLimit: ORDER_SYNC_BATCH_LIMIT,
      estimateLimit: ORDER_SYNC_BATCH_LIMIT,
      maxCandidates: ORDER_SYNC_BATCH_LIMIT,
      estimateScanLimit: ORDER_SYNC_SCAN_LIMIT,
      estimateBatchSize: 250,
      googleBatchSize: 200,
      parallelBatches: 1,
      estimateRetryCooldownMinutes: ORDER_SYNC_RETRY_COOLDOWN_MINUTES,
      estimateMonths,
      estimateScope: "all",
      source: `${source}:sync-orders:batch-${run}`,
    });
    const body = step.body || {};
    lastStatus = step.status;
    mergeOrderSyncAggregate(aggregate, body);
    aggregate.runs.push({
      run,
      elapsedMs: step.elapsedMs,
      candidates: numberValue(body.candidates),
      updatedOrders: numberValue(body.updatedOrders),
      delayedStill: numberValue(body.delayedStill),
      hasMore: Boolean(body.hasMore),
    });
    aggregate.runsCount = aggregate.runs.length;
    logOrderProgress({ ...body, runsCount: run }, step.elapsedMs);

    if (!body.hasMore || numberValue(body.candidates) === 0) {
      aggregate.hasMore = Boolean(body.hasMore);
      break;
    }

    if (run === ORDER_SYNC_MAX_RUNS) {
      aggregate.stoppedByMaxRuns = true;
      aggregate.hasMore = true;
      addLog(`Orders API còn backlog sau ${ORDER_SYNC_MAX_RUNS} lượt; cron sẽ xử lý tiếp để tránh timeout Edge.`, "muted");
    }
  }

  return {
    status: lastStatus,
    elapsedMs: elapsedMsSince(startedAt),
    body: aggregate,
  };
}

async function runAdminSyncWithActualProgress() {
  const startedAt = performance.now();
  const source = "admin-dashboard";
  const forceIconSync = false;

  syncProgressPlan = buildSyncProgressPlan();

  addLog(`Finalized earnings: dự kiến ${formatElapsed(syncProgressPlan.phases["sync-earnings"].durationMs)}`, "blue");
  startSyncProgressPhase("sync-earnings");
  const earningsStep = await invokeAdminSyncStep("sync-earnings", {
    source: `${source}:sync-earnings`,
    syncIcons: forceIconSync,
  });
  completeSyncProgressPhase("sync-earnings", earningsStep.elapsedMs);
  logFinalizedProgress(stepDetails(earningsStep.body), earningsStep.elapsedMs);

  addLog(`Estimated sales reports: dự kiến ${formatElapsed(syncProgressPlan.phases["sync-estimates"].durationMs)}`, "blue");
  startSyncProgressPhase("sync-estimates");
  const estimatesStep = await invokeAdminSyncStep("sync-estimates", {
    source: `${source}:sync-estimates`,
    syncIcons: forceIconSync,
  });
  completeSyncProgressPhase("sync-estimates", estimatesStep.elapsedMs);
  logEstimateProgress(stepDetails(estimatesStep.body), estimatesStep.elapsedMs);

  const estimateDetails = stepDetails(estimatesStep.body);
  const estimateMonths = estimateMonthsFromDetails(estimateDetails);
  addLog(`Orders API enrichment: dự kiến ${formatElapsed(syncProgressPlan.phases["sync-orders"].durationMs)}`, "blue");
  startSyncProgressPhase("sync-orders");
  const ordersStep = await runAdminOrdersSyncLoop({ source, estimateMonths });
  completeSyncProgressPhase("sync-orders", ordersStep.elapsedMs);
  logOrderProgress(ordersStep.body || {}, ordersStep.elapsedMs);
  setSyncProgress(100, "complete");

  return buildAdminSyncResult(earningsStep, estimatesStep, ordersStep, elapsedMsSince(startedAt));
}

// --- Sync Handler ---
async function triggerSync() {
  if (!supabaseClient || !session) return;
  
  syncOverlay.classList.remove("hidden");
  btnCloseSyncOverlay.classList.add("hidden");
  syncLogs.innerHTML = "";
  stopSyncProgressTimer();
  syncProgressPlan = null;

  // Reset to the in-progress state (the overlay may have been left showing a
  // finished/failed state from a previous run).
  if (syncLoader) syncLoader.classList.remove("hidden");
  setSyncProgress(0);
  if (syncTitle) {
    syncTitle.textContent = "Đang đồng bộ Google Play...";
    syncTitle.style.color = "";
  }
  if (syncSubtitle) syncSubtitle.textContent = "Đang tải tệp báo cáo từ Google Cloud Storage và tổng hợp dữ liệu doanh thu...";

  addLog("Bắt đầu gọi API đồng bộ...", "blue");
  addLog("Timeout chờ phản hồi mỗi bước: 30 phút.", "muted");
  addLog("Tiến độ % tính theo thời gian thực tế/dự kiến từng task; row count sẽ cập nhật khi API trả metadata.", "muted");
  
  try {
    const result = await runAdminSyncWithActualProgress();

    addLog("Đồng bộ hoàn tất thành công!", "green");
    addLog(`Đã đồng bộ: ${result.message}`, "green");
    const details = result.details || {};
    if (Object.keys(details).length) {
      if (details.gcsBackupUsed) {
        addLog("- GCS dang dung backup service account tam thoi. Khi all-payments doc duoc GCS thi go fallback nay.", "yellow");
      }
      if (hasOwnValue(details, "appsSyncedCount")) {
        addLog(`- Số app đã quét: ${details.appsSyncedCount}`, "blue");
      }
      if (hasOwnValue(details, "earningsSyncedCount")) {
        addLog(`- Số bản ghi doanh thu: ${details.earningsSyncedCount}`, "blue");
      }

      const monthsSynced = asArray(details.monthsSynced);
      const finalizedProcessed = asArray(details.finalizedMonthsProcessed);
      const finalizedSkipped = asArray(details.finalizedMonthsSkipped);
      if (monthsSynced.length) {
        addLog(`- Các tháng được cập nhật: ${monthsSynced.join(", ")}`, "yellow");
      } else {
        if (finalizedProcessed.length) addLog(`- Tháng finalized đã xử lý: ${finalizedProcessed.join(", ")}`, "yellow");
        if (!finalizedProcessed.length && !finalizedSkipped.length) addLog("- Không có tháng mới cần cập nhật", "yellow");
      }
      if (finalizedSkipped.length) {
        addLog(`- Các tháng đã sync trước đó: ${finalizedSkipped.join(", ")}`, "muted");
      }

      if (hasOwnValue(details, "estimatesSavedCount")) {
        addLog(`- Estimated sales rows đã lưu: ${details.estimatesSavedCount}`, "blue");
      }
      if (details.estimatesRebuildSkipped && details.estimatesRebuildSkipReason) {
        const reason = details.estimatesRebuildSkipReason === "estimate report unchanged"
          ? "report chưa thay đổi"
          : details.estimatesRebuildSkipReason;
        addLog(`- Bỏ qua rebuild Estimated sales: ${reason}`, "muted");
      }

      const orderSync = getOrderSyncDetails(details);
      if (Object.keys(orderSync).length) {
        if (hasOwnValue(orderSync, "candidateBatches")) {
          addLog(
            `- Sync Orders: ${numberValue(orderSync.candidateBatches)} batch DB, ${numberValue(orderSync.dbBatchSize, 1000)} rows/batch, chạy song song ${numberValue(orderSync.parallelBatches, 1)} batch`,
            "blue",
          );
        }
        const syncedDelayedRtdn = numberValue(
          hasOwnValue(orderSync, "updatedRtdnTransactions")
            ? orderSync.updatedRtdnTransactions
            : orderSync.updatedTransactions,
        );
        const syncedDelayedEstimates = numberValue(orderSync.updatedEstimates);
        const syncedDelayedTotal = hasOwnValue(orderSync, "updatedOrders")
          ? numberValue(orderSync.updatedOrders)
          : syncedDelayedRtdn + syncedDelayedEstimates;
        addLog(`- Số lượng transaction delay được đồng bộ lại: ${syncedDelayedTotal}`, "blue");
        addLog(`  RTDN: ${syncedDelayedRtdn}, Estimated sales: ${syncedDelayedEstimates}`, "muted");

        if (hasOwnValue(orderSync, "delayedStill") || hasOwnValue(orderSync, "delayedStillRtdn") || hasOwnValue(orderSync, "delayedStillEstimates")) {
          const delayedStillRtdn = numberValue(orderSync.delayedStillRtdn);
          const delayedStillEstimates = numberValue(orderSync.delayedStillEstimates);
          const delayedStillTotal = hasOwnValue(orderSync, "delayedStill")
            ? numberValue(orderSync.delayedStill)
            : delayedStillRtdn + delayedStillEstimates;
          addLog(`- Transaction delay còn chờ retry: ${delayedStillTotal}`, "muted");
          addLog(`  RTDN: ${delayedStillRtdn}, Estimated sales: ${delayedStillEstimates}`, "muted");
        }
      }

    }
    setSyncProgress(100, "complete");
    setSyncStatus(true, "Đã cập nhật xong. Bấm \"Đóng\" để xem dữ liệu mới.");
  } catch (err) {
    stopSyncProgressTimer();
    setSyncProgress(syncProgressCurrent, "error");
    const isTimeout = err && err.name === "AbortError";
    const failedStep = err && err.failedStep ? String(err.failedStep) : "";
    const stepPrefix = failedStep ? ` ở bước ${failedStep}` : "";
    const message = isTimeout
      ? "Quá thời gian chờ 30 phút"
      : (err && err.message ? err.message : String(err || "Unknown error"));
    addLog(`Lỗi đồng bộ${stepPrefix}: ${message}`, "red");
    const gcs = err && err.details && err.details.gcs ? err.details.gcs : null;
    if ((err && err.errorType === "gcs_api") || gcs || looksLikeGcsConfigError(message)) {
      const gcsLine = formatGcsApiLine(gcs);
      if (gcsLine) addLog(gcsLine, "red");
      if (gcs && gcs.message) addLog(`Chi tiết GCS: ${gcs.message}`, "red");
      addLog("Không coi sync là hoàn tất khi GCS trả lỗi. Kiểm tra quyền report trong Play Console/GCS và cấu hình PLAY_BUCKET, SA_JSON_B64.", "red");
    } else {
      addLog("Nếu lỗi vẫn lặp lại, mở console/network để xem response chi tiết từ Edge Function.", "muted");
    }
    setSyncStatus(false, "Có lỗi xảy ra trong quá trình đồng bộ.");
  } finally {
    stopSyncProgressTimer();
    btnCloseSyncOverlay.classList.remove("hidden");
  }
}

// Switch the sync overlay out of its spinning "in-progress" look once the
// request settles, so it no longer looks like it's loading forever.
function setSyncStatus(ok, subtitle) {
  if (syncLoader) syncLoader.classList.add("hidden");
  if (syncTitle) {
    syncTitle.textContent = ok ? "✓ Đồng bộ hoàn tất" : "✗ Đồng bộ thất bại";
    syncTitle.style.color = ok ? "#34d399" : "#f87171";
  }
  if (syncSubtitle) syncSubtitle.textContent = subtitle;
}

function addLog(text, colorClass = "muted") {
  const line = document.createElement("div");
  line.className = `log-line text-${colorClass}`;
  line.textContent = `> ${text}`;
  syncLogs.appendChild(line);
  syncLogs.scrollTop = syncLogs.scrollHeight;
}

// --- Modal Handlers ---
function openIncomeModal(earning = null) {
  newAppForm.classList.add("hidden");
  
  if (earning) {
    modalTitle.textContent = "Sửa khoản thu nhập";
    editEarningId.value = earning.id;
    incomeAppSelect.value = earning.app_id;
    incomeAppSelect.disabled = true; // Cannot change app during edit
    incomeMonth.value = earning.month;
    incomeMonth.disabled = true; // Cannot change month during edit
    incomeSource.value = earning.source;
    incomeSource.disabled = true; // Cannot change source during edit
    incomeAmount.value = earning.amount;
    incomeCurrency.value = earning.currency;
    incomeNote.value = earning.note || "";
  } else {
    modalTitle.textContent = "Thêm khoản thu nhập";
    editEarningId.value = "";
    incomeAppSelect.disabled = false;
    incomeMonth.disabled = false;
    incomeSource.disabled = false;
    incomeMonth.value = "";
    incomeAmount.value = "";
    incomeSource.value = "admob";
    incomeCurrency.value = "USD";
    incomeNote.value = "";
  }
  
  incomeModal.classList.remove("hidden");
}

function closeIncomeModal() {
  incomeModal.classList.add("hidden");
  newAppForm.classList.add("hidden");
}

async function handleSaveNewApp() {
  const id = newAppId.value.trim().toLowerCase();
  const title = newAppTitle.value.trim();
  
  if (!id || !title) {
    alert("Vui lòng điền đầy đủ thông tin App.");
    return;
  }
  
  try {
    const { error } = await supabaseClient
      .from("apps")
      .insert([{ id, title }]);
      
    if (error) throw error;
    
    // Refresh apps list
    const { data: apps } = await supabaseClient.from("apps").select("*").order("title");
    appsList = apps || [];
    populateAppDropdown();
    
    // Select newly created app
    incomeAppSelect.value = id;
    
    // Hide subform
    newAppForm.classList.add("hidden");
    newAppId.value = "";
    newAppTitle.value = "";
  } catch (err) {
    alert("Lỗi khi lưu App: " + err.message);
  }
}

async function handleIncomeSubmit(e) {
  e.preventDefault();
  
  const id = editEarningId.value;
  const payload = {
    app_id: incomeAppSelect.value,
    month: incomeMonth.value.trim(),
    amount: parseFloat(incomeAmount.value),
    currency: incomeCurrency.value,
    source: incomeSource.value,
    note: incomeNote.value.trim(),
    updated_at: new Date().toISOString()
  };

  try {
    let error;
    if (id) {
      // Edit
      const { error: err } = await supabaseClient
        .from("earnings")
        .update(payload)
        .eq("id", id);
      error = err;
    } else {
      // Create/Upsert (source + app + month must be unique)
      const { error: err } = await supabaseClient
        .from("earnings")
        .upsert([payload], { onConflict: "app_id,month,source" });
      error = err;
    }

    if (error) throw error;
    
    closeIncomeModal();
    loadDataAndRender();
  } catch (err) {
    alert("Lỗi khi lưu thu nhập: " + err.message);
  }
}

async function deleteEarning(id) {
  if (!confirm("Bạn có chắc chắn muốn xóa bản ghi thu nhập này?")) return;
  
  try {
    const { error } = await supabaseClient
      .from("earnings")
      .delete()
      .eq("id", id);
      
    if (error) throw error;
    loadDataAndRender();
  } catch (err) {
    alert("Lỗi khi xóa: " + err.message);
  }
}

// --- Dashboard Rendering ---
function renderDashboard() {
  updateSourceFilterAccess();
  const sourceFilter = filterSource.value;
  const searchQuery = tableSearch.value.trim().toLowerCase();

  // 1. Filter raw earnings data
  let filtered = earningsData;
  if (sourceFilter !== "all") {
    filtered = filtered.filter(e => e.source === sourceFilter);
  }
  
  // Create quick lookup for app titles
  const appMap = {};
  appsList.forEach(a => appMap[a.id] = a.title);

  // App filter by search query
  if (searchQuery) {
    filtered = filtered.filter(e => {
      const appTitle = appMap[e.app_id] || "";
      return e.app_id.toLowerCase().includes(searchQuery) || appTitle.toLowerCase().includes(searchQuery);
    });
  }

  // 2. Compute KPI Metrics
  //  - "Tổng thực nhận": money actually received (estimate rows excluded).
  //  - "Ước lượng tháng hiện tại": the current-month projection, i.e. the
  //    sum of estimate rows (source "google_play_estimate").
  const rate = currentUsdToVndRate;
  const toUSD = e => (e.currency === "VND" ? parseFloat(e.amount) / rate : parseFloat(e.amount));
  const isEstimate = e => e.source === "google_play_estimate";

  const officialRows = filtered.filter(e => !isEstimate(e));
  const currentEstimateUSD = filtered.filter(isEstimate).reduce((sum, e) => sum + toUSD(e), 0);

  // "Tháng N-1": official revenue of the most recent finalized month.
  const officialMonths = Array.from(new Set(officialRows.map(e => e.month))).sort();
  const prevMonth = officialMonths.length ? officialMonths[officialMonths.length - 1] : null;
  const prevMonthUSD = prevMonth
    ? officialRows.filter(e => e.month === prevMonth).reduce((sum, e) => sum + toUSD(e), 0)
    : 0;
    
  // "Tháng N-2": official revenue of the second most recent finalized month.
  const prev2Month = officialMonths.length > 1 ? officialMonths[officialMonths.length - 2] : null;
  const prev2MonthUSD = prev2Month
    ? officialRows.filter(e => e.month === prev2Month).reduce((sum, e) => sum + toUSD(e), 0)
    : 0;

  // For the full, unfiltered view, render the edge function's precomputed KPIs
  // verbatim so these cards match the Telegram bot exactly. Client-side
  // recomputation still drives the cards whenever a filter/search is active.
  const unfiltered = sourceFilter === "all" && !searchQuery;
  let dPrevMonth = prevMonth, dPrevMonthUSD = prevMonthUSD;
  let dPrev2Month = prev2Month, dPrev2MonthUSD = prev2MonthUSD;
  if (unfiltered && serverSummary && serverSummary.kpis) {
    dPrevMonth = serverSummary.kpis.prevMonth;
    dPrevMonthUSD = serverSummary.kpis.prevMonthUSD;
    if (serverSummary.kpis.prev2Month) {
      dPrev2Month = serverSummary.kpis.prev2Month;
      dPrev2MonthUSD = serverSummary.kpis.prev2MonthUSD;
    }
  }

  // Guard against null: a browser may have an older cached index.html whose
  // KPI elements differ from this script during a deploy transition.
  if (kpiPrev2Month) kpiPrev2Month.textContent = fmtUSD(dPrev2MonthUSD);
  if (kpiPrev2MonthVnd) {
    kpiPrev2MonthVnd.textContent = `≈ ${fmtVND(dPrev2MonthUSD * rate)}`;
  }
  if (kpiPrev2MonthLabel) kpiPrev2MonthLabel.textContent = dPrev2Month
    ? `Tháng ${monthLabel(dPrev2Month)}`
    : "Tháng N-2";

  if (kpiPrevMonth) kpiPrevMonth.textContent = fmtUSD(dPrevMonthUSD);
  if (kpiPrevMonthVnd) {
    kpiPrevMonthVnd.textContent = `≈ ${fmtVND(dPrevMonthUSD * rate)}`;
  }
  if (kpiPrevMonthLabel) kpiPrevMonthLabel.textContent = dPrevMonth
    ? `Tháng ${monthLabel(dPrevMonth)}`
    : "Tháng N-1";

  // Fix maxTime for Card 3 label to only use google_play_estimate rows
  if (kpiCurrentEstimateLabel) {
    let toDateStr = "";
    const csvEstRows = filtered.filter(e => e.source === "google_play_estimate" && e.updated_at);
    if (csvEstRows.length > 0) {
      const maxTime = Math.max(...csvEstRows.map(r => new Date(r.updated_at).getTime()));
      if (!isNaN(maxTime)) {
        const d = new Date(maxTime);
        const dd = String(d.getDate()).padStart(2, '0');
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        toDateStr = ` (tới ngày ${dd}/${mm})`;
      }
    }
    kpiCurrentEstimateLabel.textContent = `Ước tính tháng hiện tại${toDateStr}`;
  }

  // Card 3: ONLY the pure CSV estimate
  const csvEstimateUSD = filtered.filter(e => e.source === "google_play_estimate").reduce((sum, e) => sum + toUSD(e), 0);
  if (kpiCurrentEstimate) kpiCurrentEstimate.textContent = fmtUSD(csvEstimateUSD);
  if (kpiCurrentEstimateVnd) {
    kpiCurrentEstimateVnd.textContent = `≈ ${fmtVND(csvEstimateUSD * rate)}`;
  }

  let yourEarningsUSD = 0;
  if (unfiltered && serverSummary && serverSummary.kpis) {
    yourEarningsUSD = serverSummary.kpis.yourEarningsUSD != null
      ? serverSummary.kpis.yourEarningsUSD
      : 0;
  }
  const kpiCurrentRtdn = document.getElementById("kpi-current-rtdn");
  const kpiCurrentRtdnVnd = document.getElementById("kpi-current-rtdn-vnd");
  if (kpiCurrentRtdn) kpiCurrentRtdn.textContent = fmtUSD(yourEarningsUSD);
  if (kpiCurrentRtdnVnd) kpiCurrentRtdnVnd.textContent = `≈ ${fmtVND(yourEarningsUSD * rate)}`;
  
  if (navExchangeRate) {
    navExchangeRate.textContent = `Tỷ giá: ${fmtVND(rate)} / USD`;
  }

  // uniqueApps + uniqueMonths drive the chart + pivot table below.
  const uniqueApps = Array.from(new Set(filtered.map(e => e.app_id)));
  const uniqueMonths = Array.from(new Set(filtered.map(e => e.month))).sort();
  populateTopAppsMonthOptions();

  // 3. Render Top Apps List
  renderTopApps(filtered, appMap, rate);

  // 4. Render Chart
  renderChart(filtered, uniqueMonths, rate);

  // 5. Render Pivot Table
  renderPivotTable(filtered, uniqueApps, uniqueMonths, appMap);

  // 6. Render RTDN realtime transactions (from the shared summary)
  renderRtdnTransactions();
}

// Render the individual RTDN-reported transactions. Source: the durable
// rtdn_transactions records returned by the dashboard-summary edge function.
// order_id -> transaction, for the detail modal. Plus paging state.
let rtdnByOrder = {};
let rtdnOffset = 0;   // how many transactions are currently loaded
let rtdnTotal = 0;    // total rows in rtdn_transactions (from the summary)

// "USD 0.30" — currency code prefix, like the Play Console order table.
function fmtMoneyCode(val, cur) {
  return `${cur || "USD"} ${(Number(val) || 0).toFixed(2)}`;
}

// Split an ISO timestamp into VN-timezone date + time strings.
function vnDateParts(iso) {
  if (!iso) return { date: "—", time: "" };
  try {
    const d = new Date(iso);
    return {
      date: d.toLocaleDateString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" }),
      time: d.toLocaleTimeString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", hour: "2-digit", minute: "2-digit" }) + " (GMT+7)",
    };
  } catch (e) { return { date: String(iso), time: "" }; }
}

function statusLabel(raw) {
  const s = (raw || "").toString();
  if (!s) return "—";
  return s.toUpperCase() === "PROCESSED" ? "Processed" : s.charAt(0) + s.slice(1).toLowerCase();
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[ch]));
}

function appIconUrl(pkg) {
  const app = appsList.find(a => a.id === pkg);
  return app && app.icon_url ? app.icon_url : "";
}

function appIconHtml(pkg, title, imgClass, fallbackClass, iconUrl = appIconUrl(pkg)) {
  const safePkg = escapeHtml(pkg);
  const safeTitle = escapeHtml(title || pkg);
  const initial = escapeHtml((title || pkg || "?").charAt(0).toUpperCase());
  const localSrc = `app-icons/${safePkg}.png`;
  const src = escapeHtml(iconUrl || localSrc);
  const fallback = `<div class=&quot;${fallbackClass}&quot;>${initial}</div>`;
  const onerror = iconUrl
    ? `this.onerror=function(){this.outerHTML='${fallback}'};this.src='${localSrc}';`
    : `this.outerHTML='${fallback}'`;
  return `<img class="${imgClass}" src="${src}" alt="${safeTitle}" onerror="${onerror}">`;
}

function tableAppIconHtml(pkg, title) {
  return appIconHtml(pkg, title, "table-app-logo", "table-app-fallback");
}

function topAppIconHtml(pkg, title) {
  return appIconHtml(pkg, title, "top-app-logo", "top-app-fallback");
}

function rtdnPriceValue(t) {
  const d = t.details || {};
  if (d.listPrice != null) return d.listPrice;
  if (d.total != null) return d.total;
  if (t.price != null) return t.price;
  return t.amount;
}

function rtdnPlayerName(t) {
  return String(t.player_name || "").trim();
}

async function attachPlayerNamesToRtdnRows(rows) {
  if (!supabaseClient || !rows.length) return rows;
  const missingOrderIds = Array.from(new Set(
    rows
      .filter(row => !rtdnPlayerName(row))
      .map(row => row.order_id)
      .filter(Boolean)
  ));
  if (!missingOrderIds.length) return rows;

  try {
    const { data, error } = await supabaseClient
      .from("client_purchase_logs")
      .select("order_id,player_name,created_at")
      .in("order_id", missingOrderIds)
      .order("created_at", { ascending: false });
    if (error) throw error;
    const playerByOrder = new Map();
    for (const row of data || []) {
      const player = String(row.player_name || "").trim();
      if (row.order_id && player && !playerByOrder.has(row.order_id)) {
        playerByOrder.set(row.order_id, player);
      }
    }
    return rows.map(row => ({
      ...row,
      player_name: rtdnPlayerName(row) || playerByOrder.get(row.order_id) || null,
    }));
  } catch (err) {
    console.warn("Không tải được tên người chơi cho RTDN:", err);
    return rows;
  }
}

// One table row (Play Console "Order management" style).
function rtdnRowHtml(t) {
  const d = t.details || {};
  const { date, time } = vnDateParts(t.event_time);
  const pkg = t.package_name || "";
  const logo = appIconHtml(pkg, t.title || pkg, "rtdn-app-logo", "rtdn-app-fallback");
  const price = rtdnPriceValue(t);
  const player = rtdnPlayerName(t);
  return `<tr>
      <td class="rtdn-date-col"><div class="rtdn-date-main">${date}</div><div class="rtdn-sub">${time}</div></td>
      <td class="rtdn-app-col">${logo}</td>
      <td>
        <div class="rtdn-product-title">${d.productTitle || t.title || pkg}</div>
        <div class="rtdn-sub">${t.sku || ""}</div>
        <div class="rtdn-sub">${d.purchaseType || "Buy"}</div>
      </td>
      <td><span class="rtdn-player-name">${player ? escapeHtml(player) : "—"}</span></td>
      <td>${t.order_id}</td>
      <td><span class="rtdn-status"><i class="fa-solid fa-circle-check"></i> ${statusLabel(d.status)}</span></td>
      <td>${fmtMoneyCode(price, t.currency)}</td>
      <td><button class="rtdn-arrow" onclick="openRtdnDetail('${t.order_id}')" title="Xem chi tiết"><i class="fa-solid fa-arrow-right"></i></button></td>
    </tr>`;
}

function updateRtdnLoadMore() {
  const wrap = document.getElementById("rtdn-load-more-wrap");
  const btn = document.getElementById("rtdn-load-more");
  if (!wrap) return;
  if (rtdnOffset < rtdnTotal) {
    wrap.style.display = "";
    if (btn) { btn.disabled = false; btn.textContent = `Tải thêm (${rtdnOffset}/${rtdnTotal})`; }
  } else {
    wrap.style.display = "none";
  }
}

// Clone of the Play Console "Order management" table (first page from the
// summary; the rest is paged in via loadMoreRtdn).
function renderRtdnTransactions() {
  const body = document.getElementById("rtdn-body");
  const subtitle = document.getElementById("rtdn-subtitle");
  if (!body) return;

  const txns = (serverSummary && serverSummary.rtdnTransactions) || [];
  rtdnTotal = (serverSummary && serverSummary.rtdnTotalCount != null)
    ? serverSummary.rtdnTotalCount : txns.length;
  rtdnByOrder = {};
  txns.forEach(t => { rtdnByOrder[t.order_id] = t; });
  rtdnOffset = txns.length;

  if (subtitle) {
    subtitle.textContent = rtdnTotal
      ? `${rtdnTotal} giao dịch ghi nhận tức thời từ Google Play`
      : "Chưa có giao dịch nào được ghi nhận";
  }
  if (!txns.length) {
    body.innerHTML = `<tr><td colspan="8" style="text-align:center;padding:30px;color:var(--text-muted)">Chưa có giao dịch RTDN nào. Mỗi giao dịch IAP sẽ xuất hiện ngay khi Google gửi thông báo realtime.</td></tr>`;
    updateRtdnLoadMore();
    return;
  }

  body.innerHTML = txns.map(rtdnRowHtml).join("");
  updateRtdnLoadMore();
}

// "Load more" — fetch the next page straight from the table (authenticated
// client + range), so it scales without re-running the whole summary.
window.loadMoreRtdn = async () => {
  if (!supabaseClient) return;
  const btn = document.getElementById("rtdn-load-more");
  if (btn) { btn.disabled = true; btn.textContent = "Đang tải..."; }
  try {
    const { data, error } = await supabaseClient
      .from("rtdn_transactions")
      .select("*")
      .order("event_time", { ascending: false })
      .range(rtdnOffset, rtdnOffset + 29);
    if (error) throw error;
    const rows = await attachPlayerNamesToRtdnRows((data || []).map(t => ({
      ...t,
      title: cleanAppTitle(t.package_name, appRecordById(t.package_name)?.title)
    })));
    rows.forEach(t => { rtdnByOrder[t.order_id] = t; });
    const body = document.getElementById("rtdn-body");
    if (body) body.insertAdjacentHTML("beforeend", rows.map(rtdnRowHtml).join(""));
    rtdnOffset += rows.length;
  } catch (e) {
    console.error("loadMoreRtdn failed:", e);
  } finally {
    updateRtdnLoadMore();
  }
};

// Detail view (clones the Play Console order detail page).
window.openRtdnDetail = (orderId) => {
  const t = rtdnByOrder[orderId];
  if (!t) return;
  const d = t.details || {};
  const { date, time } = vnDateParts(t.event_time);
  const heading = document.getElementById("rtdn-detail-heading");
  const content = document.getElementById("rtdn-detail-content");
  if (heading) heading.textContent = `Order ${t.order_id}`;
  const row = (label, value) => `<div class="rtdn-detail-row"><span class="label">${label}</span><span class="value">${value}</span></div>`;
  const hasEstimatedRevenue = d.estimatedRevenue !== null && d.estimatedRevenue !== undefined && d.estimatedRevenue !== "";
  content.innerHTML =
    row("Order status", `<span class="rtdn-status"><i class="fa-solid fa-circle-check"></i> ${statusLabel(d.status)}</span>`) +
    row("Order ID", t.order_id) +
    row("Tên người chơi", escapeHtml(rtdnPlayerName(t) || "—")) +
    row("Date", `${date} ${time}`) +
    row("Billing address", d.buyerCountry || "—") +
    row("List price", fmtMoneyCode(d.listPrice != null ? d.listPrice : t.amount, t.currency)) +
    row("Tax", fmtMoneyCode(d.tax || 0, t.currency)) +
    row("Total", fmtMoneyCode(d.total != null ? d.total : t.amount, t.currency)) +
    row("Estimated revenue", hasEstimatedRevenue ? fmtMoneyCode(d.estimatedRevenue, t.currency) : "—") +
    `<div class="rtdn-detail-title">Products in this order</div>` +
    `<div class="rtdn-product-title">${d.productTitle || t.title}</div>` +
    `<div class="rtdn-sub">${t.sku || ""} · ${d.purchaseType || "Buy"}</div>`;
  document.getElementById("rtdn-detail-modal").classList.remove("hidden");
};
window.closeRtdnDetail = () => {
  document.getElementById("rtdn-detail-modal").classList.add("hidden");
};

function fmtUSD(val) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(val);
}

function fmtVND(val) {
  return new Intl.NumberFormat("vi-VN", { style: "currency", currency: "VND" }).format(val);
}

function monthLabel(p) {
  if (p && p.length === 6) {
    return p.slice(4, 6) + "/" + p.slice(0, 4);
  }
  return p;
}

function syncTransactionDateLabel(info) {
  if (!info) return "";
  if (info.transactionAt) {
    const parts = vnDateParts(info.transactionAt);
    return [parts.date, parts.time.replace(" (GMT+7)", "")].filter(Boolean).join(" ");
  }
  if (info.transactionDate) {
    const ms = Date.parse(`${info.transactionDate}T00:00:00`);
    if (!isNaN(ms)) {
      return new Date(ms).toLocaleDateString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" });
    }
    return info.transactionDate;
  }
  return "";
}

function currentMonthSyncText(summary) {
  const info = summary && summary.currentMonthSync;
  if (!info) return "";
  const subject = info.orderId || info.productTitle || "giao dịch cuối";
  const details = [
    subject,
    info.orderId ? (info.productTitle || info.appTitle) : "",
    syncTransactionDateLabel(info),
  ].filter(Boolean);
  return details.length
    ? `Dữ liệu đồng bộ tới giao dịch ${details.join(" · ")}`
    : "";
}

function currentMonthWindowVN(monthKey) {
  let year;
  let month;
  if (typeof monthKey === "string" && /^\d{6}$/.test(monthKey)) {
    year = Number(monthKey.slice(0, 4));
    month = Number(monthKey.slice(4, 6)) - 1;
  } else {
    const vnNow = new Date(Date.now() + 7 * 3600 * 1000);
    year = vnNow.getUTCFullYear();
    month = vnNow.getUTCMonth();
  }
  const start = new Date(Date.UTC(year, month, 1) - 7 * 3600 * 1000).toISOString();
  const end = new Date(Date.UTC(year, month + 1, 1) - 7 * 3600 * 1000).toISOString();
  return {
    start,
    end,
    label: `${String(month + 1).padStart(2, "0")}/${year}`,
  };
}

function dateInputValueFromUtcDate(date) {
  return date.toISOString().slice(0, 10);
}

function dateRangeFromMonthKeyVN(monthKey) {
  let year;
  let month;
  if (typeof monthKey === "string" && /^\d{6}$/.test(monthKey)) {
    year = Number(monthKey.slice(0, 4));
    month = Number(monthKey.slice(4, 6)) - 1;
  } else {
    const vnNow = new Date(Date.now() + 7 * 3600 * 1000);
    year = vnNow.getUTCFullYear();
    month = vnNow.getUTCMonth();
  }
  return {
    startDate: dateInputValueFromUtcDate(new Date(Date.UTC(year, month, 1))),
    endDate: dateInputValueFromUtcDate(new Date(Date.UTC(year, month + 1, 0))),
  };
}

function dateInputToIsoStartVN(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ""))) return null;
  const ms = Date.parse(`${value}T00:00:00+07:00`);
  return isNaN(ms) ? null : new Date(ms).toISOString();
}

function dateInputToIsoEndExclusiveVN(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ""))) return null;
  const ms = Date.parse(`${value}T00:00:00+07:00`);
  return isNaN(ms) ? null : new Date(ms + 24 * 3600 * 1000).toISOString();
}

function dateRangeLabel(startDate, endDate) {
  const fmt = (value) => {
    const ms = Date.parse(`${value}T00:00:00+07:00`);
    return isNaN(ms)
      ? value
      : new Date(ms).toLocaleDateString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" });
  };
  return `${fmt(startDate)} - ${fmt(endDate)}`;
}

function getCustomRangeWindow(startInput, endInput) {
  const startDate = startInput && startInput.value;
  const endDate = endInput && endInput.value;
  const start = dateInputToIsoStartVN(startDate);
  const end = dateInputToIsoEndExclusiveVN(endDate);
  if (!start || !end || Date.parse(start) >= Date.parse(end)) {
    return null;
  }
  return {
    start,
    end,
    startDate,
    endDate,
    label: dateRangeLabel(startDate, endDate),
  };
}

function ensureRangeInputs(target) {
  const isTopApps = target === "top-apps";
  const startInput = isTopApps ? topAppsRangeStart : topPlayersRangeStart;
  const endInput = isTopApps ? topAppsRangeEnd : topPlayersRangeEnd;
  const selectedMonth = isTopApps
    ? (topAppsSelectedMonth || (serverSummary && serverSummary.currentMonth) || currentMonthKeyVN())
    : (topPlayersSelectedMonth || (serverSummary && serverSummary.currentMonth) || currentMonthKeyVN());
  const defaults = dateRangeFromMonthKeyVN(selectedMonth);
  if (startInput && !startInput.value) startInput.value = defaults.startDate;
  if (endInput && !endInput.value) endInput.value = defaults.endDate;
}

function isRangePopupEventTarget(target) {
  if (!(target instanceof Element)) return false;
  return Boolean(
    (topAppsCustomRangeBtn && topAppsCustomRangeBtn.contains(target)) ||
    (topAppsRangeControls && topAppsRangeControls.contains(target)) ||
    (topPlayersCustomRangeBtn && topPlayersCustomRangeBtn.contains(target)) ||
    (topPlayersRangeControls && topPlayersRangeControls.contains(target))
  );
}

function closeRangePopups() {
  if (!topAppsRangePopupOpen && !topPlayersRangePopupOpen) return;
  topAppsRangePopupOpen = false;
  topPlayersRangePopupOpen = false;
  updateRangeControlVisibility();
}

function updateRangeControlVisibility() {
  if (topAppsMonthSelect) {
    if (topAppsFilterMode === "custom") {
      topAppsMonthSelect.value = CUSTOM_RANGE_VALUE;
    } else if (topAppsMonthSelect.value === CUSTOM_RANGE_VALUE && topAppsSelectedMonth) {
      topAppsMonthSelect.value = topAppsSelectedMonth;
    }
  }
  if (topAppsRangeControls) {
    topAppsRangeControls.classList.toggle("hidden", !topAppsRangePopupOpen);
    topAppsRangeControls.setAttribute("aria-hidden", topAppsRangePopupOpen ? "false" : "true");
  }
  if (topAppsCustomRangeBtn) {
    topAppsCustomRangeBtn.classList.toggle("is-active", topAppsFilterMode === "custom");
    topAppsCustomRangeBtn.classList.toggle("is-open", topAppsRangePopupOpen);
    topAppsCustomRangeBtn.setAttribute("aria-pressed", topAppsFilterMode === "custom" ? "true" : "false");
    topAppsCustomRangeBtn.setAttribute("aria-expanded", topAppsRangePopupOpen ? "true" : "false");
  }
  if (topPlayersMonthSelect) {
    if (topPlayersFilterMode === "custom") {
      topPlayersMonthSelect.value = CUSTOM_RANGE_VALUE;
    } else if (topPlayersMonthSelect.value === CUSTOM_RANGE_VALUE && topPlayersSelectedMonth) {
      topPlayersMonthSelect.value = topPlayersSelectedMonth;
    }
  }
  if (topPlayersRangeControls) {
    topPlayersRangeControls.classList.toggle("hidden", !topPlayersRangePopupOpen);
    topPlayersRangeControls.setAttribute("aria-hidden", topPlayersRangePopupOpen ? "false" : "true");
  }
  if (topPlayersCustomRangeBtn) {
    topPlayersCustomRangeBtn.classList.toggle("is-active", topPlayersFilterMode === "custom");
    topPlayersCustomRangeBtn.classList.toggle("is-open", topPlayersRangePopupOpen);
    topPlayersCustomRangeBtn.setAttribute("aria-pressed", topPlayersFilterMode === "custom" ? "true" : "false");
    topPlayersCustomRangeBtn.setAttribute("aria-expanded", topPlayersRangePopupOpen ? "true" : "false");
  }
}

function purchaseAmountUSD(row) {
  const amount = Number(row.amount || 0);
  const currency = String(row.currency || "USD").toUpperCase();
  if (currency === "VND") return amount / currentUsdToVndRate;
  return amount;
}

function currentMonthKeyVN() {
  const vnNow = new Date(Date.now() + 7 * 3600 * 1000);
  return `${vnNow.getUTCFullYear()}${String(vnNow.getUTCMonth() + 1).padStart(2, "0")}`;
}

function monthKeyFromIsoVN(iso) {
  const ms = Date.parse(iso || "");
  if (isNaN(ms)) return null;
  const vnDate = new Date(ms + 7 * 3600 * 1000);
  return `${vnDate.getUTCFullYear()}${String(vnDate.getUTCMonth() + 1).padStart(2, "0")}`;
}

function populateTopAppsMonthOptions() {
  if (!topAppsMonthSelect) return;

  const months = new Set();
  if (serverSummary && serverSummary.currentMonth) months.add(serverSummary.currentMonth);
  if (serverSummary && serverSummary.calendarMonth) months.add(serverSummary.calendarMonth);
  earningsData.forEach(row => {
    if (row && /^\d{6}$/.test(String(row.month || ""))) months.add(String(row.month));
  });

  const sortedMonths = Array.from(months)
    .filter(m => /^\d{6}$/.test(String(m)))
    .sort()
    .reverse();

  if (!topAppsSelectedMonth) {
    topAppsSelectedMonth =
      (serverSummary && serverSummary.currentMonth) ||
      sortedMonths[0] ||
      currentMonthKeyVN();
  }
  if (!sortedMonths.includes(topAppsSelectedMonth)) {
    sortedMonths.unshift(topAppsSelectedMonth);
  }

  topAppsMonthSelect.innerHTML = [
    `<option value="${CUSTOM_RANGE_VALUE}" hidden>Tuỳ chỉnh</option>`,
    ...sortedMonths.map(month => `<option value="${month}">${monthLabel(month)}</option>`),
  ].join("");
  topAppsMonthSelect.value = topAppsFilterMode === "custom" ? CUSTOM_RANGE_VALUE : topAppsSelectedMonth;
  updateRangeControlVisibility();
}

async function populateTopPlayersMonthOptions() {
  if (!topPlayersMonthSelect || !supabaseClient) return;

  const months = new Set();
  if (serverSummary && serverSummary.currentMonth) months.add(serverSummary.currentMonth);
  if (serverSummary && serverSummary.calendarMonth) months.add(serverSummary.calendarMonth);
  months.add(currentMonthKeyVN());

  try {
    const pageSize = 1000;
    const maxRows = 10000;
    for (let from = 0; from < maxRows; from += pageSize) {
      const { data, error } = await supabaseClient
        .from("client_purchase_logs")
        .select("created_at")
        .order("created_at", { ascending: false, nullsFirst: false })
        .range(from, from + pageSize - 1);
      if (error) throw error;
      for (const row of data || []) {
        const monthKey = monthKeyFromIsoVN(row.created_at);
        if (monthKey) months.add(monthKey);
      }
      if (!data || data.length < pageSize) break;
    }
  } catch (err) {
    console.warn("Không tải được danh sách tháng client_purchase_logs:", err);
  }

  const sortedMonths = Array.from(months)
    .filter(m => /^\d{6}$/.test(String(m)))
    .sort()
    .reverse();

  if (!topPlayersSelectedMonth) {
    topPlayersSelectedMonth =
      (serverSummary && serverSummary.currentMonth) ||
      sortedMonths[0] ||
      currentMonthKeyVN();
  }
  if (!sortedMonths.includes(topPlayersSelectedMonth)) {
    sortedMonths.unshift(topPlayersSelectedMonth);
  }

  topPlayersMonthSelect.innerHTML = [
    `<option value="${CUSTOM_RANGE_VALUE}" hidden>Tuỳ chỉnh</option>`,
    ...sortedMonths.map(month => `<option value="${month}">${monthLabel(month)}</option>`),
  ].join("");
  topPlayersMonthSelect.value = topPlayersFilterMode === "custom" ? CUSTOM_RANGE_VALUE : topPlayersSelectedMonth;
  updateRangeControlVisibility();
}

function groupTopPlayersFromRows(rows) {
  const grouped = new Map();
  for (const row of rows) {
    const player = String(row.player_name || "Ẩn danh").trim() || "Ẩn danh";
    const playerKey = player.toLocaleLowerCase("vi-VN");
    const packageName = row.package_name || "";
    const appTitle = appRecordById(packageName)?.title || cleanAppTitle(packageName, row.app_name || packageName || "Unknown");
    const appKey = packageName || appTitle;
    const current = grouped.get(playerKey) || {
      player,
      appTitle,
      packageName,
      appTitles: [],
      appKeys: new Set(),
      appCount: 0,
      totalUSD: 0,
      count: 0,
      lastEventTime: "",
    };
    if (appKey && !current.appKeys.has(appKey)) {
      current.appKeys.add(appKey);
      current.appTitles.push(appTitle);
      current.appCount = current.appKeys.size;
    }
    current.totalUSD += purchaseAmountUSD(row);
    current.count += 1;
    const logTime = row.created_at || row.event_time || "";
    if (logTime && (!current.lastEventTime || String(logTime) > current.lastEventTime)) {
      current.lastEventTime = logTime;
    }
    grouped.set(playerKey, current);
  }

  return Array.from(grouped.values())
    .map(player => ({
      ...player,
      appKeys: undefined,
      appTitle: player.appCount > 1 ? `${player.appCount} ứng dụng` : (player.appTitles[0] || player.appTitle),
    }))
    .sort((a, b) => b.totalUSD - a.totalUSD || b.count - a.count)
    .slice(0, 10);
}

function topPlayerSubtitle(player) {
  const appCount = numberValue(player.appCount);
  const appText = appCount > 1
    ? `${formatCount(appCount)} ứng dụng`
    : (player.appTitle || "Không rõ app");
  return `${appText} · ${formatCount(player.count)} lượt`;
}

function renderTopPlayersList(topPlayers, emptyText) {
  if (!topPlayers.length) {
    topPlayersList.innerHTML = `<div class="loading-placeholder">${escapeHtml(emptyText)}</div>`;
    return;
  }

  topPlayersList.innerHTML = topPlayers.map((p, idx) => `
    <div class="app-item">
      <div class="app-item-left">
        <div class="app-badge">${idx + 1}</div>
        <div>
          <span class="app-name">${escapeHtml(p.player)}</span>
          <span class="app-pkg">${escapeHtml(topPlayerSubtitle(p))}</span>
        </div>
      </div>
      <span class="app-revenue">${fmtUSD(p.totalUSD)}</span>
    </div>
  `).join("");
}

function amountToUSD(amount, currency, rate) {
  const numericAmount = parseFloat(amount);
  const safeAmount = Number.isFinite(numericAmount) ? numericAmount : 0;
  return String(currency || "USD").toUpperCase() === "VND" ? safeAmount / rate : safeAmount;
}

function renderTopAppsList(sortedApps, emptyText) {
  if (sortedApps.length === 0) {
    topAppsList.innerHTML = `<div class="loading-placeholder">${escapeHtml(emptyText)}</div>`;
    return;
  }

  topAppsList.innerHTML = sortedApps.map((a, idx) => {
    const icon = topAppIconHtml(a.id, a.title);
    return `
    <div class="app-item">
      <div class="app-item-left">
        <div class="app-badge">${idx + 1}</div>
        ${icon}
        <div class="app-item-meta">
          <span class="app-name">${escapeHtml(a.title)}</span>
          <span class="app-pkg">${escapeHtml(a.id)}</span>
        </div>
      </div>
      <span class="app-revenue">${fmtUSD(a.total)}</span>
    </div>
  `;
  }).join("");
}

async function renderTopAppsCustomRange(range, appMap, rate) {
  if (!range) {
    topAppsList.innerHTML = `<div class="loading-placeholder">Chọn khoảng ngày hợp lệ</div>`;
    return;
  }

  const sourceFilter = filterSource ? filterSource.value : "all";
  const searchQuery = tableSearch ? tableSearch.value.trim().toLowerCase() : "";
  const requestId = ++topAppsRangeRequestId;
  topAppsList.innerHTML = `<div class="loading-placeholder">Đang tải dữ liệu...</div>`;
  if (topAppsSyncInfo) {
    topAppsSyncInfo.textContent = `Dữ liệu doanh thu từ ${range.label}`;
  }

  if (sourceFilter !== "all" && sourceFilter !== "google_play_estimate") {
    renderTopAppsList([], `Không có dữ liệu doanh thu trong khoảng ${range.label}`);
    return;
  }

  try {
    const rows = [];
    const pageSize = 1000;
    const maxRows = 50000;
    for (let from = 0; from < maxRows; from += pageSize) {
      const { data, error } = await supabaseClient
        .from("estimates")
        .select("app_id,amount,currency,transaction_at")
        .eq("included_in_estimate", true)
        .eq("source", "google_play_estimate")
        .not("amount", "is", null)
        .gte("transaction_at", range.start)
        .lt("transaction_at", range.end)
        .order("transaction_at", { ascending: false, nullsFirst: false })
        .range(from, from + pageSize - 1);
      if (error) throw error;
      rows.push(...(data || []));
      if (!data || data.length < pageSize) break;
    }
    if (requestId !== topAppsRangeRequestId) return;

    const totals = {};
    rows.forEach(row => {
      totals[row.app_id] = (totals[row.app_id] || 0) + amountToUSD(row.amount, row.currency, rate);
    });

    const sortedApps = Object.entries(totals)
      .map(([id, total]) => ({
        id,
        title: appMap[id] || cleanAppTitle(id),
        total: Math.round(numberValue(total) * 100) / 100,
      }))
      .filter(a => !isAdjustmentApp(a.id, a.title))
      .filter(a => !searchQuery || a.id.toLowerCase().includes(searchQuery) || a.title.toLowerCase().includes(searchQuery))
      .filter(a => !shouldHideTopApp(a))
      .sort((a, b) => b.total - a.total);

    renderTopAppsList(sortedApps, `Không có dữ liệu doanh thu trong khoảng ${range.label}`);
  } catch (err) {
    console.error("load custom top apps failed:", err);
    topAppsList.innerHTML = `<div class="loading-placeholder">Không tải được top doanh thu</div>`;
  }
}

async function renderTopPlayers() {
  if (!topPlayersList || !supabaseClient) return;
  const selectedMonth = topPlayersSelectedMonth || (serverSummary && serverSummary.currentMonth) || currentMonthKeyVN();
  const customRange = topPlayersFilterMode === "custom"
    ? getCustomRangeWindow(topPlayersRangeStart, topPlayersRangeEnd)
    : null;
  const { start, end } = customRange || currentMonthWindowVN(selectedMonth);
  topPlayersList.innerHTML = `<div class="loading-placeholder">Đang tải dữ liệu...</div>`;
  const requestId = ++topPlayersRangeRequestId;

  try {
    if (!customRange && serverSummary && selectedMonth === serverSummary.currentMonth && Array.isArray(serverSummary.topPlayersCurrentMonth)) {
      renderTopPlayersList(serverSummary.topPlayersCurrentMonth, "Chưa có log nạp trong tháng này");
      return;
    }

    if (topPlayersFilterMode === "custom" && !customRange) {
      topPlayersList.innerHTML = `<div class="loading-placeholder">Chọn khoảng ngày hợp lệ</div>`;
      return;
    }

    const rows = [];
    const pageSize = 1000;
    const maxRows = 10000;
    for (let from = 0; from < maxRows; from += pageSize) {
      const { data, error } = await supabaseClient
        .from("client_purchase_logs")
        .select("player_name,amount,currency,app_name,package_name,event_time,created_at")
        .gte("created_at", start)
        .lt("created_at", end)
        .order("created_at", { ascending: false })
        .range(from, from + pageSize - 1);
      if (error) throw error;
      rows.push(...(data || []));
      if (!data || data.length < pageSize) break;
    }
    if (requestId !== topPlayersRangeRequestId) return;

    const emptyText = customRange
      ? `Chưa có log nạp trong khoảng ${customRange.label}`
      : "Chưa có log nạp trong tháng này";
    renderTopPlayersList(groupTopPlayersFromRows(rows), emptyText);
  } catch (err) {
    console.error("load top players failed:", err);
    topPlayersList.innerHTML = `<div class="loading-placeholder">Không tải được top người chơi</div>`;
  }
}

// Render revenue by app for the selected month.
function renderTopApps(filtered, appMap, rate) {
  if (!topAppsList) return;
  const selectedMonth = topAppsSelectedMonth || (serverSummary && serverSummary.currentMonth) || currentMonthKeyVN();
  const customRange = topAppsFilterMode === "custom"
    ? getCustomRangeWindow(topAppsRangeStart, topAppsRangeEnd)
    : null;

  if (topAppsFilterMode === "custom") {
    renderTopAppsCustomRange(customRange, appMap, rate);
    return;
  }
  topAppsRangeRequestId += 1;

  if (topAppsSyncInfo) {
    const syncText = currentMonthSyncText(serverSummary);
    topAppsSyncInfo.textContent =
      selectedMonth === (serverSummary && serverSummary.currentMonth) && syncText
        ? syncText
        : `Dữ liệu doanh thu tháng ${monthLabel(selectedMonth)}`;
  }

  let sortedApps;
  const revenueByApp = serverSummary && serverSummary.revenueByApp;
  const sourceFilter = filterSource ? filterSource.value : "all";
  const searchQuery = tableSearch ? tableSearch.value.trim() : "";
  const canUseServerCurrentMonth =
    revenueByApp &&
    selectedMonth === (serverSummary && serverSummary.currentMonth) &&
    sourceFilter === "all" &&
    !searchQuery;

  if (canUseServerCurrentMonth) {
    sortedApps = revenueByApp
      .filter(a => !isAdjustmentApp(a.id, a.title))
      .map(a => ({ id: a.id, title: a.title, total: Number(a.totalUSD || 0) }))
      .filter(a => !shouldHideTopApp(a))
      .sort((a, b) => b.total - a.total);
  } else {
    const totals = {};
    filtered
      .filter(e => e.month === selectedMonth)
      .forEach(e => {
        const amt = parseFloat(e.amount);
        const usd = e.currency === "USD" ? amt : amt / rate;
        totals[e.app_id] = (totals[e.app_id] || 0) + usd;
      });
    const appIds = new Set([
      ...Object.keys(totals).filter(id => !isAdjustmentApp(id, appMap[id])),
    ]);
    sortedApps = Array.from(appIds)
      .map(id => ({ id, title: appMap[id] || id, total: totals[id] || 0 }))
      .filter(a => !shouldHideTopApp(a))
      .sort((a, b) => b.total - a.total);
  }

  renderTopAppsList(sortedApps, `Không có dữ liệu tháng ${monthLabel(selectedMonth)}`);
}

// Render Chart
function renderChart(filtered, uniqueMonths, rate) {
  const miniCanvas = document.getElementById("revenue-chart-mini");
  const modalCanvas = document.getElementById("revenue-chart-modal");
  const miniCtx = miniCanvas ? miniCanvas.getContext("2d") : null;
  const modalCtx = modalCanvas ? modalCanvas.getContext("2d") : null;
  
  if (chartMini) chartMini.destroy();
  if (chartModal) chartModal.destroy();

  if (uniqueMonths.length === 0) {
    if (miniCtx) miniCtx.clearRect(0, 0, miniCanvas.width, miniCanvas.height);
    if (modalCtx) modalCtx.clearRect(0, 0, modalCanvas.width, modalCanvas.height);
    if (chartKpiSubtitle) chartKpiSubtitle.textContent = "Chưa có dữ liệu";
    return;
  }

  // Aggregate by month (chronological order)
  const chronologicalMonths = [...uniqueMonths].sort();
  const dataPoints = chronologicalMonths.map(m => {
    let sum = 0;
    filtered.forEach(e => {
      if (e.month === m) {
        const amt = parseFloat(e.amount);
        sum += e.currency === "USD" ? amt : amt / rate;
      }
    });
    return Math.round(sum * 100) / 100;
  });

  const latestMonth = chronologicalMonths[chronologicalMonths.length - 1];
  if (chartKpiSubtitle) chartKpiSubtitle.textContent = `${monthLabel(latestMonth)} · Biểu đồ tháng`;

  const chartDataset = () => ({
    label: "Doanh thu (USD)",
    data: dataPoints,
    backgroundColor: "rgba(108, 140, 255, 0.45)",
    borderColor: "#6c8cff",
    borderWidth: 2,
    borderRadius: 8,
    hoverBackgroundColor: "rgba(108, 140, 255, 0.85)",
  });

  if (miniCtx) {
    chartMini = new Chart(miniCtx, {
      type: "bar",
      data: {
        labels: chronologicalMonths.map(monthLabel),
        datasets: [chartDataset()],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: { enabled: false },
        },
        scales: {
          x: { display: false },
          y: { display: false },
        },
      },
    });
  }

  if (!modalCtx) return;
  chartModal = new Chart(modalCtx, {
    type: "bar",
    data: {
      labels: chronologicalMonths.map(monthLabel),
      datasets: [chartDataset()]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: "rgba(18, 22, 46, 0.95)",
          titleColor: "#fff",
          bodyColor: "#f1f3f9",
          borderColor: "rgba(255, 255, 255, 0.1)",
          borderWidth: 1,
          padding: 12,
          displayColors: false,
          callbacks: {
            label: c => `Doanh thu: ${fmtUSD(c.parsed.y)}`
          }
        }
      },
      scales: {
        x: {
          ticks: { color: "#8b95c9", font: { family: "Outfit" } },
          grid: { color: "rgba(255, 255, 255, 0.05)" }
        },
        y: {
          ticks: {
            color: "#8b95c9",
            font: { family: "Outfit" },
            callback: v => "$" + v.toLocaleString()
          },
          grid: { color: "rgba(255, 255, 255, 0.05)" }
        }
      }
    }
  });
}

// Render Pivot Table
function renderPivotTable(filtered, uniqueApps, uniqueMonths, appMap) {
  const months = [...uniqueMonths].sort(); // Sorted chronological
  
  // Header Row
  let headerHtml = `<th class="table-app-sticky-head"><span class="table-app-desktop-label">Ứng dụng</span></th>
    <th class="table-app-mobile-meta-col">Ứng dụng</th>`;
  months.forEach(m => {
    headerHtml += `<th>${monthLabel(m)}</th>`;
  });
  headerHtml += "<th>Tổng</th>";
  tableHeaderRow.innerHTML = headerHtml;

  // Build matrix of data: app_id -> month -> { amount, currency, source, id, note }
  const matrix = {};
  
  // Fill matrix
  filtered.forEach(e => {
    if (!matrix[e.app_id]) matrix[e.app_id] = {};
    if (!matrix[e.app_id][e.month]) matrix[e.app_id][e.month] = [];
    matrix[e.app_id][e.month].push(e);
  });

  // Render Body Rows
  let bodyHtml = "";
  let grandTotalUSD = 0;
  const monthTotalsUSD = {};

  // For each app, calculate rows
  const appRows = uniqueApps.map(appId => {
    const title = appMap[appId] || appId;
    const icon = tableAppIconHtml(appId, title);
    let appTotalUSD = 0;
    
    let rowCellsHtml = `<td class="table-app-sticky-cell">
      <div class="table-app-cell">
        ${icon}
        <div class="table-app-meta">
          <div class="table-app-name">${escapeHtml(title)}</div>
          <div class="table-app-pkg">${escapeHtml(appId)}</div>
        </div>
      </div>
    </td>
    <td class="table-app-mobile-meta-col">
      <div class="table-app-name">${escapeHtml(title)}</div>
      <div class="table-app-pkg">${escapeHtml(appId)}</div>
    </td>`;

    months.forEach(m => {
      const entries = matrix[appId]?.[m] || [];
      
      if (entries.length === 0) {
        rowCellsHtml += `<td class="val-zero">-</td>`;
      } else {
        // Sum values (handle multi-source if filtered as all)
        let cellUSD = 0;
        let cellText = "";
        let isEstimate = false;
        let editableEntry = null;

        entries.forEach(e => {
          const amt = parseFloat(e.amount);
          const usd = e.currency === "USD" ? amt : amt / currentUsdToVndRate;
          cellUSD += usd;
          appTotalUSD += usd;
          monthTotalsUSD[m] = (monthTotalsUSD[m] || 0) + usd;
          
          if (e.source === "google_play_estimate") isEstimate = true;
          if (e.source !== "google_play" && e.source !== "google_play_estimate") {
            editableEntry = e; // Store for edit action
          }
        });

        grandTotalUSD += cellUSD;
        
        let displayVal = fmtUSD(cellUSD);
        if (entries[0].currency === "VND" && entries.length === 1) {
          // If only VND exists, show VND
          displayVal = fmtVND(entries[0].amount);
        }

        rowCellsHtml += `<td>
          <div class="${cellUSD < 0 ? 'val-neg' : 'val-pos'}">
            ${displayVal}
            ${isEstimate ? '<span class="estimate-marker">Est</span>' : ''}
          </div>
          ${editableEntry ? `
            <div class="action-cell">
              <button onclick="editManualEarning(${JSON.stringify(editableEntry).replace(/"/g, '&quot;')})" class="btn-icon edit" title="Sửa">
                <i class="fa-solid fa-pen"></i>
              </button>
              <button onclick="deleteEarning(${editableEntry.id})" class="btn-icon delete" title="Xóa">
                <i class="fa-solid fa-trash"></i>
              </button>
            </div>
          ` : ''}
        </td>`;
      }
    });

    rowCellsHtml += `<td class="val-pos" style="font-weight:600">${fmtUSD(appTotalUSD)}</td>`;
    
    return {
      html: `<tr>${rowCellsHtml}</tr>`,
      totalUSD: appTotalUSD
    };
  });

  // Sort apps by total revenue descending
  appRows.sort((a, b) => b.totalUSD - a.totalUSD);
  bodyHtml += appRows.map(r => r.html).join("");

  // Grand Total Row
  if (uniqueApps.length > 0) {
    let totalRowHtml = `<td class="table-app-sticky-cell">
      <strong class="table-app-desktop-label">TỔNG CỘNG</strong>
      <strong class="table-app-mobile-total-label">Σ</strong>
    </td>
    <td class="table-app-mobile-meta-col"><strong>TỔNG CỘNG</strong></td>`;
    months.forEach(m => {
      const monthSum = monthTotalsUSD[m] || 0;
      totalRowHtml += `<td class="val-pos" style="font-weight:700">${fmtUSD(monthSum)}</td>`;
    });
    totalRowHtml += `<td class="val-pos" style="font-weight:800;border-left:1px solid var(--border-light)">${fmtUSD(appRows.reduce((sum, r) => sum + r.totalUSD, 0))}</td>`;
    bodyHtml += `<tr class="total-row">${totalRowHtml}</tr>`;
  } else {
    bodyHtml = `<tr><td colspan="${months.length + 3}" style="text-align:center;padding:40px;color:var(--text-muted)">Không tìm thấy bản ghi thu nhập nào. Bấm 'Đồng bộ Google Play' hoặc 'Thêm thu nhập' để bắt đầu.</td></tr>`;
  }

  tableBody.innerHTML = bodyHtml;
}

// Window-scoped helper functions so they can be triggered from onclick attributes
window.editManualEarning = (earning) => {
  openIncomeModal(earning);
};

window.deleteEarning = async (id) => {
  await deleteEarning(id);
};
