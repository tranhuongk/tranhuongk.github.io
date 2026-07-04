// Supabase Client variables
const supabaseUrl = "https://lnazpyhoojqotnanrvqf.supabase.co";
const supabaseAnonKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxuYXpweWhvb2pxb3RuYW5ydnFmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI1NzAyNjcsImV4cCI6MjA5ODE0NjI2N30.uc4WAXKm_UDKoLEm260mu0RHyHaL4HGtPI3sG-TbJSg";
const SUPABASE_AUTH_STORAGE_KEY = "sb-lnazpyhoojqotnanrvqf-auth-token";
let supabaseClient = null;
let session = null;
let chartMain = null;
const SYNC_REQUEST_TIMEOUT_MS = 30 * 60 * 1000;
const SYNC_PROGRESS_STORAGE_KEY = "galax_admin_sync_progress_durations_v1";
const CUSTOM_RANGE_VALUE = "__custom__";
const SOURCE_FILTER_ALL_VALUE = "all";
const SOURCE_FILTER_ADMIN_EMAIL = "admin@admin.com";
const CUSTOMER_ADMIN_EMAIL = "customer@customer.com";
const PLAY_ACCOUNT_STORAGE_KEY = "galax_admin_google_play_account_id_v1";
const DEFAULT_PLAY_ACCOUNT_ID = "default";
const DEFAULT_PLAY_ACCOUNT_LABEL = "Galax VN Team";
const ORDER_SYNC_BATCH_LIMIT = 500;
const ORDER_SYNC_SCAN_LIMIT = 5000;
const ORDER_SYNC_MAX_RUNS = 20;
const ORDER_SYNC_RETRY_COOLDOWN_MINUTES = 60;
const DASHBOARD_SKELETON_MIN_MS = 450;
const REALTIME_REFRESH_DEBOUNCE_MS = 1500;
const REALTIME_RECONCILE_DEBOUNCE_MS = 10000;
const REALTIME_RTDN_PAGE_SIZE = 30;
const KPI_COUNT_ANIMATION_MS = 720;
const ADMIN_ALIVE_INTERVAL_MS = 30 * 1000;
const ADMIN_ALIVE_STALE_MS = ADMIN_ALIVE_INTERVAL_MS * 3;
const SYNC_PROGRESS_PHASES = [
  { key: "sync-earnings", label: "Đồng bộ finalized earnings", defaultDurationMs: 3000 },
  { key: "sync-estimates", label: "Đồng bộ Estimated sales reports", defaultDurationMs: 25000 },
  { key: "sync-orders", label: "Enrich Orders API", defaultDurationMs: 45000 },
];
let syncProgressCurrent = 0;
let syncProgressTimer = null;
let syncProgressPlan = null;
let syncProgressPhase = null;
let realtimeChannel = null;
let realtimeRefreshTimer = null;
let realtimeRefreshInFlight = false;
let realtimeRefreshQueued = false;
let realtimeUiUpdatePending = false;
let realtimeRefreshPendingUntilVisible = false;
let adminAliveTimer = null;
let adminAliveInFlight = false;
let forceLogoutInFlight = false;
let loginLogRefreshTimer = null;
let loginLogRefreshInFlight = false;
let loginLogRefreshQueued = false;
let loginLogRefreshPendingUntilVisible = false;
const realtimeEstimateOrderCache = new Map();

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
  const statusText = String(
    app.publish_status ||
    app.play_status ||
    app.play_store_status ||
    app.status ||
    app.state ||
    ""
  ).trim().toLowerCase();
  if (statusText) {
    if (/unpublish|not[_\s-]*publish|removed|deleted|suspend|inactive|archived|draft/.test(statusText)) return false;
    if (/publish|active|live/.test(statusText)) return true;
  }

  const boolFields = ["published", "is_published", "isPublished"];
  for (const field of boolFields) {
    if (typeof app[field] === "boolean") return app[field];
  }

  return false;
}

function shouldHideTopApp(app) {
  return isAdjustmentApp(app.id, app.title);
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
let googlePlayAccounts = [];
let selectedPlayAccountId = localStorage.getItem(PLAY_ACCOUNT_STORAGE_KEY) || DEFAULT_PLAY_ACCOUNT_ID;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function currentPlayAccountId() {
  return selectedPlayAccountId || DEFAULT_PLAY_ACCOUNT_ID;
}

function googlePlayAccountPayload(accountId = currentPlayAccountId()) {
  return { playAccountId: accountId };
}

function activeAccountAppIds() {
  return appsList
    .filter(app => !isAdjustmentApp(app.id, app.title))
    .map(app => String(app.id || "").trim())
    .filter(Boolean);
}

function updatePlayAccountSelect() {
  if (!playAccountSelect || !playAccountSwitcher) return;
  const accounts = googlePlayAccounts.length
    ? googlePlayAccounts
    : [{ id: DEFAULT_PLAY_ACCOUNT_ID, label: DEFAULT_PLAY_ACCOUNT_LABEL, isDefault: true }];
  if (!accounts.some(account => account.id === selectedPlayAccountId)) {
    const fallback = accounts.find(account => account.isDefault) || accounts[0];
    selectedPlayAccountId = fallback.id || DEFAULT_PLAY_ACCOUNT_ID;
    localStorage.setItem(PLAY_ACCOUNT_STORAGE_KEY, selectedPlayAccountId);
  }
  playAccountSelect.innerHTML = accounts
    .map(account => `<option value="${escapeHtml(account.id)}">${escapeHtml(account.label || account.id)}</option>`)
    .join("") + (accounts.length <= 1 ? `<option value="__no_other_accounts__" disabled>Google chưa trả thêm developer account khác</option>` : "");
  playAccountSelect.value = selectedPlayAccountId;
  playAccountSelect.disabled = false;
  const activeAccount = accounts.find(account => account.id === selectedPlayAccountId) || accounts[0];
  const note = activeAccount?.discoveryNote ? ` ${activeAccount.discoveryNote}` : "";
  playAccountSelect.title = accounts.length <= 1
    ? `Google hiện chỉ trả 1 nhóm account qua API.${note}`
    : "Chọn tài khoản Google Play";
  playAccountSelect.classList.toggle("is-single-option", accounts.length <= 1);
  playAccountSwitcher.classList.toggle("is-hidden", accounts.length === 0);
}

async function loadGooglePlayAccounts() {
  if (!session) {
    googlePlayAccounts = [];
    updatePlayAccountSelect();
    return;
  }

  try {
    const res = await fetch(`${supabaseUrl}/functions/v1/google-play-accounts`, {
      headers: {
        apikey: supabaseAnonKey,
        Authorization: `Bearer ${session.access_token}`,
      },
    });
    const body = await readJsonResponse(res);
    if (!res.ok) throw new Error(body.error || `google-play-accounts ${res.status}`);
    googlePlayAccounts = Array.isArray(body.accounts) ? body.accounts : [];
  } catch (err) {
    console.warn("Không tải được danh sách account Google Play:", err);
    googlePlayAccounts = [{ id: DEFAULT_PLAY_ACCOUNT_ID, label: DEFAULT_PLAY_ACCOUNT_LABEL, isDefault: true }];
  }
  updatePlayAccountSelect();
}

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
const playAccountSwitcher = document.getElementById("play-account-switcher");
const playAccountSelect = document.getElementById("google-play-account-select");
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
const kpiCurrentRtdn = document.getElementById("kpi-current-rtdn");
const kpiCurrentRtdnVnd = document.getElementById("kpi-current-rtdn-vnd");
const kpiCurrentRtdnLabel = document.getElementById("kpi-current-rtdn-label");

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
const chartKpiSubtitle = document.getElementById("chart-kpi-subtitle");
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
const loginLogCard = document.getElementById("login-log-card");
const loginLogSubtitle = document.getElementById("login-log-subtitle");
const loginLogBody = document.getElementById("login-log-body");

// --- Initialization ---
document.addEventListener("DOMContentLoaded", async () => {
  const exchangeRatePromise = fetchExchangeRate();

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
  if (playAccountSelect) {
    playAccountSelect.addEventListener("change", () => {
      selectedPlayAccountId = playAccountSelect.value || DEFAULT_PLAY_ACCOUNT_ID;
      localStorage.setItem(PLAY_ACCOUNT_STORAGE_KEY, selectedPlayAccountId);
      serverSummary = null;
      topAppsSelectedMonth = null;
      topPlayersSelectedMonth = null;
      topAppsFilterMode = "month";
      topPlayersFilterMode = "month";
      closeRangePopups();
      setupRealtimeSubscriptions();
      loadDataAndRender();
    });
  }
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      closeRangePopups();
    }
  });
  document.addEventListener("visibilitychange", () => {
    if (isTabVisible()) {
      flushDeferredRealtimeUi();
      recordAdminAlive();
    }
  });
  
  document.querySelectorAll(".btn-close-modal").forEach(btn => {
    btn.addEventListener("click", closeIncomeModal);
  });

  // Realtime order detail modal: close button + click-outside.
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
    if (!(await validateCurrentSession())) {
      exchangeRatePromise.catch(() => {});
      return;
    }
    updateSourceFilterAccess();
    showScreen("dashboard");
    renderDashboardSkeleton();
    recordAdminLogin("reload");
    startAdminAliveHeartbeat();
    await exchangeRatePromise.catch(() => {});
    await loadGooglePlayAccounts();
    setupRealtimeSubscriptions();
    loadDataAndRender();
  } else {
    exchangeRatePromise.catch(() => {});
    stopAdminAliveHeartbeat();
    clearRealtimeSubscriptions();
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

function sessionExpiresSoon(bufferSeconds = 60) {
  const expiresAt = Number(session && session.expires_at || 0);
  return Boolean(expiresAt && Date.now() / 1000 >= expiresAt - bufferSeconds);
}

async function refreshCurrentSession() {
  if (!supabaseClient) return false;
  try {
    const { data, error } = await supabaseClient.auth.refreshSession();
    if (error || !data || !data.session) return false;
    session = data.session;
    if (supabaseClient.realtime && typeof supabaseClient.realtime.setAuth === "function") {
      supabaseClient.realtime.setAuth(session.access_token);
    }
    return true;
  } catch (err) {
    console.warn("Không refresh được phiên đăng nhập:", err);
    return false;
  }
}

async function fetchCurrentAuthUser() {
  let response;
  try {
    response = await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: {
        apikey: supabaseAnonKey,
        Authorization: `Bearer ${session.access_token}`,
      },
    });
  } catch (err) {
    console.warn("Không kiểm tra được phiên đăng nhập:", err);
    return { ok: true, user: session.user || null, networkError: true };
  }
  const user = await readJsonResponse(response);
  return {
    ok: response.ok && user && user.id,
    user,
    status: response.status,
  };
}

async function validateCurrentSession() {
  if (!supabaseClient || !session || !session.access_token) return false;
  if (sessionExpiresSoon()) {
    await refreshCurrentSession();
  }

  let result = await fetchCurrentAuthUser();
  if (!result.ok && result.status === 401 && await refreshCurrentSession()) {
    result = await fetchCurrentAuthUser();
  }

  if (!result.ok) {
    await forceLogout();
    return false;
  }
  session = {
    ...session,
    user: result.user,
  };
  return true;
}

function clearSupabaseAuthStorage() {
  [localStorage, sessionStorage].forEach(storage => {
    storage.removeItem(SUPABASE_AUTH_STORAGE_KEY);
  });
}

async function forceLogout(message = "Phiên đăng nhập không còn hợp lệ. Vui lòng đăng nhập lại.") {
  if (forceLogoutInFlight) return;
  forceLogoutInFlight = true;
  try {
    stopAdminAliveHeartbeat();
    clearRealtimeSubscriptions();
    session = null;
    googlePlayAccounts = [];
    updatePlayAccountSelect();
    updateSourceFilterAccess();

    if (supabaseClient) {
      try {
        await supabaseClient.auth.signOut({ scope: "local" });
      } catch (_) {
        clearSupabaseAuthStorage();
      }
    }
    clearSupabaseAuthStorage();

    showScreen("auth");
    showError(message);
  } finally {
    forceLogoutInFlight = false;
  }
}

function canViewAllSourceFilter() {
  return currentSessionEmail() === SOURCE_FILTER_ADMIN_EMAIL;
}

function canViewLoginLogs() {
  return currentSessionEmail() === SOURCE_FILTER_ADMIN_EMAIL;
}

function updateSourceFilterAccess() {
  if (filterSource) {
    const canViewFilter = canViewAllSourceFilter();
    filterSource.classList.toggle("hidden", !canViewFilter);

    if (!canViewFilter || !filterSource.value) {
      filterSource.value = SOURCE_FILTER_ALL_VALUE;
    }
  }

  updateLoginLogAccess();
}

function updateLoginLogAccess() {
  if (!loginLogCard) return;
  const canView = canViewLoginLogs();
  loginLogCard.classList.toggle("hidden", !canView);
  if (!canView) {
    if (loginLogSubtitle) loginLogSubtitle.textContent = "";
    if (loginLogBody) loginLogBody.innerHTML = "";
  }
}

// --- Authentication Handler ---
async function handleLogin(e) {
  e.preventDefault();
  authError.classList.add("hidden");

  let email = loginEmail.value.trim();
  const emailAlias = email.toLowerCase();
  const password = loginPassword.value;

  if (emailAlias === "ad") {
    email = SOURCE_FILTER_ADMIN_EMAIL;
  } else if (emailAlias === "admin") {
    email = CUSTOMER_ADMIN_EMAIL;
  }

  const btn = loginForm.querySelector("button[type='submit']");
  btn.disabled = true;
  btn.querySelector("span").textContent = "Đang kết nối...";

  try {
    const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
    if (error) throw error;
    
    session = data.session;
    if (!(await validateCurrentSession())) return;
    updateSourceFilterAccess();
    showScreen("dashboard");
    renderDashboardSkeleton();
    recordAdminLogin("login");
    startAdminAliveHeartbeat();
    await loadGooglePlayAccounts();
    setupRealtimeSubscriptions();
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
  googlePlayAccounts = [];
  stopAdminAliveHeartbeat();
  clearRealtimeSubscriptions();
  updatePlayAccountSelect();
  updateSourceFilterAccess();
  showScreen("auth");
}

function showError(msg) {
  authError.textContent = msg;
  authError.classList.remove("hidden");
}

function startAdminAliveHeartbeat() {
  stopAdminAliveHeartbeat();
  if (!session || !session.access_token) return;
  adminAliveTimer = window.setInterval(recordAdminAlive, ADMIN_ALIVE_INTERVAL_MS);
}

function stopAdminAliveHeartbeat() {
  if (adminAliveTimer) {
    window.clearInterval(adminAliveTimer);
    adminAliveTimer = null;
  }
  adminAliveInFlight = false;
}

async function recordAdminAlive() {
  if (!session || !session.access_token || adminAliveInFlight) return;
  adminAliveInFlight = true;
  try {
    await recordAdminLogin("alive");
  } finally {
    adminAliveInFlight = false;
  }
}

async function postAdminLoginLog(payload) {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), 8000);
  try {
    return await fetch(`${supabaseUrl}/functions/v1/admin-login-log`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: supabaseAnonKey,
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
  } finally {
    window.clearTimeout(timeoutId);
  }
}

function skeletonLine(width = "100%", extraClass = "") {
  return `<span class="skeleton-line ${extraClass}" style="width:${width}"></span>`;
}

function skeletonBlock(extraClass = "") {
  return `<span class="skeleton-block ${extraClass}"></span>`;
}

function renderKpiSkeleton(labelEl, valueEl, vndEl, subtitleEl) {
  if (labelEl) labelEl.innerHTML = skeletonLine("112px", "skeleton-label");
  if (valueEl) {
    valueEl.innerHTML = skeletonLine("156px", "skeleton-value");
    resetKpiNumberState(valueEl);
  }
  if (vndEl) {
    vndEl.innerHTML = skeletonLine("118px", "skeleton-subline");
    resetKpiNumberState(vndEl);
  }
  if (subtitleEl) subtitleEl.innerHTML = skeletonLine("148px", "skeleton-subline");
}

function resetKpiNumberState(el) {
  if (!el) return;
  delete el.dataset.kpiNumber;
  delete el.dataset.kpiAnimationId;
  el.classList.remove("kpi-counting");
}

function renderPlayRevenueSkeleton(count = 3) {
  return Array.from({ length: count }).map(() => `
    <article class="play-revenue-card skeleton-card" aria-hidden="true">
      <div class="play-app-header">
        <div class="play-app-identity">
          ${skeletonBlock("skeleton-logo play-app-logo")}
          <div class="play-app-title-wrap skeleton-copy">
            ${skeletonLine("180px", "skeleton-title")}
            ${skeletonLine("260px", "skeleton-subline")}
          </div>
        </div>
        ${skeletonLine("72px", "skeleton-link")}
      </div>
      <div class="play-metrics-grid">
        ${Array.from({ length: 4 }).map(() => `
          <div class="play-metric">
            ${skeletonLine("74%", "skeleton-subline")}
            ${skeletonLine("58%", "skeleton-metric")}
            ${skeletonLine("68%", "skeleton-subline")}
          </div>
        `).join("")}
      </div>
    </article>
  `).join("");
}

function renderRankingSkeleton(count = 5) {
  return Array.from({ length: count }).map(() => `
    <div class="app-item skeleton-card" aria-hidden="true">
      <div class="app-item-left">
        ${skeletonBlock("skeleton-badge")}
        <div class="app-item-meta skeleton-copy">
          ${skeletonLine("150px", "skeleton-title")}
          ${skeletonLine("210px", "skeleton-subline")}
        </div>
      </div>
      ${skeletonLine("68px", "skeleton-revenue")}
    </div>
  `).join("");
}

function renderTableSkeleton(columns = 7, rows = 7) {
  if (!tableHeaderRow || !tableBody) return;
  tableHeaderRow.innerHTML = `
    <th class="table-app-sticky-head">${skeletonLine("90px")}</th>
    ${Array.from({ length: columns - 1 }).map(() => `<th>${skeletonLine("76px")}</th>`).join("")}
  `;
  tableBody.innerHTML = Array.from({ length: rows }).map(() => `
    <tr class="skeleton-table-row" aria-hidden="true">
      <td class="table-app-sticky-cell">
        <div class="table-app-cell">
          ${skeletonBlock("skeleton-logo table-app-logo")}
          <div class="table-app-meta skeleton-copy">
            ${skeletonLine("138px", "skeleton-title")}
            ${skeletonLine("186px", "skeleton-subline")}
          </div>
        </div>
      </td>
      ${Array.from({ length: columns - 1 }).map(() => `<td>${skeletonLine("72px", "skeleton-cell")}</td>`).join("")}
    </tr>
  `).join("");
}

function renderSimpleTableSkeleton(bodyEl, columns, rows = 6) {
  if (!bodyEl) return;
  bodyEl.innerHTML = Array.from({ length: rows }).map(() => `
    <tr class="skeleton-table-row" aria-hidden="true">
      ${Array.from({ length: columns }).map((_, idx) => `
        <td>${idx === 0 ? skeletonLine("92px") : skeletonLine(idx === 1 ? "150px" : "78px", "skeleton-cell")}</td>
      `).join("")}
    </tr>
  `).join("");
}

function setChartSkeleton(isLoading) {
  const wrapper = document.querySelector(".monthly-chart-wrapper");
  if (!wrapper) return;
  wrapper.classList.toggle("is-loading", isLoading);
  let overlay = wrapper.querySelector(".chart-skeleton");
  if (isLoading && !overlay) {
    overlay = document.createElement("div");
    overlay.className = "chart-skeleton";
    overlay.setAttribute("aria-hidden", "true");
    overlay.innerHTML = `
      <div class="chart-skeleton-bars">
        ${[46, 70, 38, 86, 58, 76, 50].map(height => `<span style="height:${height}%"></span>`).join("")}
      </div>
    `;
    wrapper.appendChild(overlay);
  } else if (!isLoading && overlay) {
    overlay.remove();
  }
}

function renderDashboardSkeleton() {
  renderKpiSkeleton(kpiPrev2MonthLabel, kpiPrev2Month, kpiPrev2MonthVnd);
  renderKpiSkeleton(kpiPrevMonthLabel, kpiPrevMonth, kpiPrevMonthVnd);
  renderKpiSkeleton(kpiCurrentRtdnLabel, kpiCurrentRtdn, kpiCurrentRtdnVnd, chartKpiSubtitle);
  if (kpiCurrentEstimateLabel) {
    renderKpiSkeleton(kpiCurrentEstimateLabel, kpiCurrentEstimate, kpiCurrentEstimateVnd);
  }
  if (navExchangeRate) navExchangeRate.textContent = "Tỷ giá: đang tải...";
  if (topAppsSyncInfo) topAppsSyncInfo.textContent = "Đang tải dữ liệu doanh thu...";
  if (topAppsList) topAppsList.innerHTML = renderPlayRevenueSkeleton();
  if (topPlayersList) topPlayersList.innerHTML = renderRankingSkeleton();
  renderTableSkeleton();
  setChartSkeleton(true);
  renderSimpleTableSkeleton(document.getElementById("rtdn-body"), 8, 6);
  const rtdnSubtitle = document.getElementById("rtdn-subtitle");
  if (rtdnSubtitle) rtdnSubtitle.textContent = "Đang tải giao dịch...";
  updateLoginLogAccess();
  if (canViewLoginLogs()) {
    renderSimpleTableSkeleton(loginLogBody, 5, 4);
    if (loginLogSubtitle) loginLogSubtitle.textContent = "Đang tải lịch sử đăng nhập...";
  }
}

async function recordAdminLogin(eventType = "login") {
  if (!session || !session.access_token) return;
  try {
    const screenSize = window.screen
      ? `${window.screen.width || 0}x${window.screen.height || 0}`
      : "";
    const payload = {
      event: eventType,
      page: window.location.href,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "",
      language: navigator.language || "",
      platform: navigator.platform || "",
      screen: screenSize,
      referrer: document.referrer || "",
    };
    let response = await postAdminLoginLog(payload);
    if (response.status === 401 && await refreshCurrentSession()) {
      response = await postAdminLoginLog(payload);
    }
    if (response.status === 401) {
      await forceLogout();
      return;
    }
    if (!response.ok) {
      console.warn("Không ghi được lịch sử đăng nhập:", await response.text());
    }
  } catch (err) {
    console.warn("Không ghi được lịch sử đăng nhập:", err);
  }
}

async function fetchDashboardSummary(accountId = currentPlayAccountId()) {
  const res = await fetch(`${supabaseUrl}/functions/v1/dashboard-summary`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: supabaseAnonKey,
      Authorization: `Bearer ${session ? session.access_token : supabaseAnonKey}`,
    },
    body: JSON.stringify(googlePlayAccountPayload(accountId)),
  });
  const summary = await readJsonResponse(res);
  if (!res.ok || summary.error) {
    throw new Error(summary.error || `dashboard-summary ${res.status}`);
  }
  return summary;
}

function applyDashboardSummary(summary) {
  serverSummary = summary;
  currentUsdToVndRate = summary.rate || currentUsdToVndRate;
  appsList = (summary.apps || []).map(a => ({ ...a, title: cleanAppTitle(a.id, a.title) }));
  earningsData = mergeRtdnAddonIntoEarnings(summary.earnings || [], summary);
}

function isTabVisible() {
  return !document.hidden && document.visibilityState === "visible";
}

function deferRealtimeUiUpdate({ needsRefresh = false } = {}) {
  realtimeUiUpdatePending = true;
  if (needsRefresh) realtimeRefreshPendingUntilVisible = true;
}

async function flushDeferredRealtimeUi() {
  if (!session || !isTabVisible()) return;
  const hasDashboardUpdate = realtimeUiUpdatePending || realtimeRefreshPendingUntilVisible;
  const hasLoginLogUpdate = loginLogRefreshPendingUntilVisible;
  if (!hasDashboardUpdate && !hasLoginLogUpdate) return;

  const needsRefresh = realtimeRefreshPendingUntilVisible;
  realtimeUiUpdatePending = false;
  realtimeRefreshPendingUntilVisible = false;
  loginLogRefreshPendingUntilVisible = false;

  if (needsRefresh) {
    await refreshRealtimeDashboardParts({ source: "tab-visible-realtime-pending" }, { animateKpi: true });
  } else if (hasDashboardUpdate) {
    renderRealtimeUpdatedSections({ animateKpi: true });
  }

  if (hasLoginLogUpdate) {
    await refreshLoginLogsFromRealtime({ source: "tab-visible-login-log-pending" });
  }
}

function renderRealtimeUpdatedSections({ animateKpi = true } = {}) {
  const recent = serverSummary && serverSummary.kpis && Array.isArray(serverSummary.kpis.recentMonths)
    ? serverSummary.kpis.recentMonths
    : buildRecentMonthlyKpisFromEarnings(earningsData, currentUsdToVndRate);
  const latestKpi = recent[recent.length - 1] || null;

  renderMonthlyKpi(kpiCurrentRtdnLabel, kpiCurrentRtdn, kpiCurrentRtdnVnd, latestKpi, "Ước tính tháng N", {
    animate: animateKpi,
  });
  if (chartKpiSubtitle && latestKpi && latestKpi.month) {
    chartKpiSubtitle.textContent = `${monthLabel(latestKpi.month)} · KPI tháng gần nhất`;
  }
  if (navExchangeRate) {
    navExchangeRate.textContent = `Tỷ giá: ${fmtVND(currentUsdToVndRate)} / USD`;
  }

  if (topAppsSyncInfo) {
    const selectedMonth = (serverSummary && serverSummary.currentMonth) || currentMonthKeyVN();
    const syncText = currentMonthSyncText(serverSummary);
    topAppsSyncInfo.textContent = syncText
      ? `${syncText} · Ước tính ledger tháng ${monthLabel(selectedMonth)}, chỉ gồm app đang publish`
      : `Ước tính ledger tháng ${monthLabel(selectedMonth)}, chỉ gồm app đang publish`;
  }

  renderRtdnTransactions();
}

function clearRealtimeSubscriptions() {
  if (realtimeRefreshTimer) {
    window.clearTimeout(realtimeRefreshTimer);
    realtimeRefreshTimer = null;
  }
  if (loginLogRefreshTimer) {
    window.clearTimeout(loginLogRefreshTimer);
    loginLogRefreshTimer = null;
  }
  realtimeRefreshQueued = false;
  realtimeRefreshInFlight = false;
  realtimeUiUpdatePending = false;
  realtimeRefreshPendingUntilVisible = false;
  loginLogRefreshInFlight = false;
  loginLogRefreshQueued = false;
  loginLogRefreshPendingUntilVisible = false;
  if (realtimeChannel && supabaseClient) {
    supabaseClient.removeChannel(realtimeChannel).catch((err) => {
      console.warn("Không gỡ được realtime channel:", err);
    });
  }
  realtimeChannel = null;
}

function setupRealtimeSubscriptions() {
  clearRealtimeSubscriptions();
  if (!supabaseClient || !session || !session.access_token) return;

  if (supabaseClient.realtime && typeof supabaseClient.realtime.setAuth === "function") {
    supabaseClient.realtime.setAuth(session.access_token);
  }

  const accountId = currentPlayAccountId();
  let channel = supabaseClient
    .channel(`admin-dashboard-${accountId}-${session.user?.id || "user"}`)
    .on("postgres_changes", {
      event: "*",
      schema: "public",
      table: "earnings",
      filter: `play_account_id=eq.${accountId}`,
    }, (payload) => scheduleRealtimeRefresh(payload))
    .on("postgres_changes", {
      event: "*",
      schema: "public",
      table: "rtdn_transactions",
      filter: `play_account_id=eq.${accountId}`,
    }, (payload) => {
      handleRealtimeRtdnPayload(payload).catch((err) => {
        console.warn("Không xử lý được giao dịch realtime từ socket:", err);
        scheduleRealtimeRefresh(payload);
      });
    });

  if (canViewLoginLogs()) {
    channel = channel.on("postgres_changes", {
      event: "*",
      schema: "public",
      table: "admin_login_logs",
    }, (payload) => scheduleLoginLogRefresh(payload));
  }

  realtimeChannel = channel
    .subscribe((status, err) => {
      if (status === "SUBSCRIBED") {
        console.info(`Realtime dashboard active for Google Play account ${accountId}`);
      } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
        console.warn("Realtime dashboard channel status:", status, err || "");
      }
    });
}

function scheduleLoginLogRefresh(payload, delayMs = 500) {
  if (!session || !canViewLoginLogs()) return;
  if (loginLogRefreshTimer) window.clearTimeout(loginLogRefreshTimer);
  if (!isTabVisible()) {
    loginLogRefreshTimer = null;
    loginLogRefreshPendingUntilVisible = true;
    return;
  }
  loginLogRefreshTimer = window.setTimeout(() => {
    loginLogRefreshTimer = null;
    refreshLoginLogsFromRealtime(payload);
  }, delayMs);
}

async function refreshLoginLogsFromRealtime(payload) {
  if (!session || !canViewLoginLogs()) return;
  if (!isTabVisible()) {
    loginLogRefreshPendingUntilVisible = true;
    return;
  }
  if (loginLogRefreshInFlight) {
    loginLogRefreshQueued = true;
    return;
  }

  loginLogRefreshInFlight = true;
  try {
    await loadLoginLogs({ showSkeleton: false });
  } catch (err) {
    console.warn("Không refresh được lịch sử đăng nhập realtime:", err, payload || "");
  } finally {
    loginLogRefreshInFlight = false;
    if (loginLogRefreshQueued) {
      loginLogRefreshQueued = false;
      scheduleLoginLogRefresh({ source: "login-log-queued" });
    }
  }
}

function scheduleRealtimeRefresh(payload, delayMs = REALTIME_REFRESH_DEBOUNCE_MS) {
  if (!session) return;
  if (realtimeRefreshTimer) window.clearTimeout(realtimeRefreshTimer);
  if (!isTabVisible()) {
    realtimeRefreshTimer = null;
    deferRealtimeUiUpdate({ needsRefresh: true });
    return;
  }
  realtimeRefreshTimer = window.setTimeout(() => {
    realtimeRefreshTimer = null;
    refreshRealtimeDashboardParts(payload);
  }, delayMs);
}

async function handleRealtimeRtdnPayload(payload) {
  if (!session || !serverSummary) {
    scheduleRealtimeRefresh(payload);
    return;
  }

  const eventType = payload && payload.eventType;
  const normalizedNew = normalizeRealtimeRtdnRow(payload && payload.new);
  const normalizedOld = normalizeRealtimeRtdnRow(payload && payload.old);
  const relevantNew = normalizedNew && rtdnRowMatchesCurrentAccount(normalizedNew);
  const relevantOld = normalizedOld && rtdnRowMatchesCurrentAccount(normalizedOld);
  if (!relevantNew && !relevantOld) return;

  if (!isTabVisible()) {
    deferRealtimeUiUpdate({ needsRefresh: true });
    return;
  }

  applyRealtimeRtdnListChange(payload, relevantNew ? normalizedNew : null, relevantOld ? normalizedOld : null);
  renderRtdnTransactions();

  if (eventType === "UPDATE" && !relevantOld) {
    scheduleRealtimeRefresh({ source: "reconcile-missing-old-row", payload });
    return;
  }

  const [oldDelta, newDelta] = await Promise.all([
    relevantOld ? realtimeRtdnAddonDelta(normalizedOld) : Promise.resolve(null),
    relevantNew ? realtimeRtdnAddonDelta(normalizedNew) : Promise.resolve(null),
  ]);

  if ((oldDelta && oldDelta.failed) || (newDelta && newDelta.failed)) {
    scheduleRealtimeRefresh({ source: "reconcile-after-estimate-check", payload });
    return;
  }

  if (oldDelta) applyRealtimeKpiDelta(oldDelta, -1);
  if (newDelta) {
    applyRealtimeKpiDelta(newDelta, 1);
    maybeUpdateCurrentMonthSync(newDelta.row, newDelta.month);
  }

  renderRealtimeUpdatedSections();
  if (normalizedNew && normalizedNew.order_id) {
    enrichRealtimeRtdnPlayerName(normalizedNew.order_id);
  }
  scheduleRealtimeRefresh({ source: "reconcile-after-realtime-transaction", payload }, REALTIME_RECONCILE_DEBOUNCE_MS);
}

async function refreshRealtimeDashboardParts(payload, { animateKpi = true } = {}) {
  if (!session) return;
  if (!isTabVisible()) {
    deferRealtimeUiUpdate({ needsRefresh: true });
    return;
  }
  if (realtimeRefreshInFlight) {
    realtimeRefreshQueued = true;
    return;
  }

  realtimeRefreshInFlight = true;
  const accountId = currentPlayAccountId();
  try {
    const summary = await fetchDashboardSummary(accountId);
    if (accountId !== currentPlayAccountId()) return;
    applyDashboardSummary(summary);
    populateAppDropdown();
    if (!isTabVisible()) {
      deferRealtimeUiUpdate();
      return;
    }
    renderRealtimeUpdatedSections({ animateKpi });
  } catch (err) {
    console.warn("Không refresh được dữ liệu realtime:", err, payload || "");
  } finally {
    realtimeRefreshInFlight = false;
    if (realtimeRefreshQueued) {
      realtimeRefreshQueued = false;
      scheduleRealtimeRefresh({ source: "queued" });
    }
  }
}

// --- Data Fetching ---
async function loadDataAndRender() {
  if (!supabaseClient) return;
  const skeletonStartedAt = performance.now();
  renderDashboardSkeleton();

  const waitForVisibleSkeleton = async () => {
    const elapsed = performance.now() - skeletonStartedAt;
    if (elapsed < DASHBOARD_SKELETON_MIN_MS) {
      await sleep(DASHBOARD_SKELETON_MIN_MS - elapsed);
    }
  };

  // Preferred path: pull everything from the shared `dashboard-summary` edge
  // function so the KPI numbers, exchange rate, and app titles match the
  // Telegram bot exactly (same computation, same rate snapshot).
  try {
    const s = await fetchDashboardSummary();
    applyDashboardSummary(s);
    populateAppDropdown();
    await waitForVisibleSkeleton();
    renderDashboard({ animateLatestKpi: true });
    await populateTopPlayersMonthOptions();
    renderTopPlayers();
    await loadLoginLogs();
    return;
  } catch (err) {
    console.warn("dashboard-summary fetch failed, falling back:", err);
  }

  // Fallback: read the tables directly (KPIs then computed client-side).
  serverSummary = null;
  try {
    const { data: apps, error: appsErr } = await supabaseClient
      .from("apps")
      .select("*")
      .eq("play_account_id", currentPlayAccountId())
      .order("title");
    if (appsErr) throw appsErr;
    appsList = (apps || []).map(a => ({
      ...a,
      title: cleanAppTitle(a.id, a.title)
    }));

    const { data: earnings, error: earnErr } = await supabaseClient
      .from("earnings")
      .select("*")
      .eq("play_account_id", currentPlayAccountId())
      .order("month", { ascending: false });
    if (earnErr) throw earnErr;
    earningsData = earnings || [];

    populateAppDropdown();
    await waitForVisibleSkeleton();
    renderDashboard({ animateLatestKpi: true });
    await populateTopPlayersMonthOptions();
    renderTopPlayers();
    await loadLoginLogs();
  } catch (err) {
    console.error("Lỗi khi tải dữ liệu:", err);
    alert("Không thể tải dữ liệu từ Supabase: " + err.message);
  }
}

async function loadLoginLogs({ showSkeleton = true } = {}) {
  if (!loginLogCard || !loginLogBody || !supabaseClient || !session) return;
  if (!canViewLoginLogs()) {
    loginLogCard.classList.add("hidden");
    if (loginLogSubtitle) loginLogSubtitle.textContent = "";
    loginLogBody.innerHTML = "";
    return;
  }

  loginLogCard.classList.remove("hidden");
  if (showSkeleton) {
    renderSimpleTableSkeleton(loginLogBody, 5, 4);
    if (loginLogSubtitle) loginLogSubtitle.textContent = "Đang tải lịch sử đăng nhập...";
  }

  try {
    const { data, error } = await supabaseClient
      .from("admin_login_logs")
      .select("email,ip_address,user_agent,login_at,metadata")
      .order("login_at", { ascending: false })
      .limit(30);
    if (error) throw error;
    renderLoginLogs(data || []);
  } catch (err) {
    console.warn("Không tải được lịch sử đăng nhập:", err);
    if (showSkeleton) {
      loginLogBody.innerHTML = `<tr><td colspan="5" style="text-align:center;color:var(--danger);">Không tải được lịch sử đăng nhập</td></tr>`;
    }
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

function buildRtdnAddonEarningRows(summary) {
  const addon = summary && summary.rtdnAddon && Array.isArray(summary.rtdnAddon.byApp)
    ? summary.rtdnAddon.byApp
    : [];
  return addon.flatMap((row, index) => {
    const month = String(row.ledgerMonth || "");
    const appId = String(row.packageName || "").trim();
    const currency = String(row.currency || "USD").toUpperCase();
    const amount = Math.round(numberValue(row.netAmount) * 100) / 100;
    const rows = Math.max(0, Math.trunc(numberValue(row.rows)));
    if (!/^\d{6}$/.test(month) || !appId || amount === 0) return [];
    return [{
      id: `rtdn-addon-${month}-${appId}-${currency}-${index}`,
      app_id: appId,
      month,
      amount,
      currency,
      source: "google_play_estimate",
      note: `Giao dịch realtime bổ sung: ${rows} giao dịch chưa có trong Estimated sales report`,
      updated_at: row.lastEvent || row.firstEvent || null,
      is_rtdn_addon: true,
      rtdn_addon_rows: rows,
    }];
  });
}

function mergeRtdnAddonIntoEarnings(rows, summary) {
  const baseRows = Array.isArray(rows) ? rows : [];
  if (baseRows.some(row => row && row.is_rtdn_addon)) return baseRows;
  const addonRows = buildRtdnAddonEarningRows(summary);
  return addonRows.length ? [...baseRows, ...addonRows] : baseRows;
}

function baseEarningsRows(summary = serverSummary) {
  const rows = Array.isArray(summary && summary.earnings) ? summary.earnings : [];
  return rows.filter(row => !(row && row.is_rtdn_addon));
}

function estimateMonthsForRealtime() {
  const months = new Set();
  const addonMonths = serverSummary && serverSummary.rtdnAddon && Array.isArray(serverSummary.rtdnAddon.months)
    ? serverSummary.rtdnAddon.months
    : [];
  addonMonths.forEach(month => {
    if (/^\d{6}$/.test(String(month))) months.add(String(month));
  });
  baseEarningsRows().forEach(row => {
    if (row && row.source === "google_play_estimate" && /^\d{6}$/.test(String(row.month || ""))) {
      months.add(String(row.month));
    }
  });
  return months;
}

function monthKeyFromIsoPacific(iso) {
  const ms = Date.parse(iso || "");
  if (isNaN(ms)) return null;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(new Date(ms));
  const year = parts.find(part => part.type === "year")?.value;
  const month = parts.find(part => part.type === "month")?.value;
  return year && month ? `${year}${month}` : null;
}

function rtdnEventIso(row) {
  return row && (row.event_time || row.created_at) ? String(row.event_time || row.created_at) : null;
}

function normalizeRealtimeRtdnRow(row) {
  if (!row || typeof row !== "object") return null;
  const pkg = String(row.package_name || "").trim();
  const orderId = String(row.order_id || "").trim();
  if (!pkg || !orderId) return null;
  const existing = rtdnByOrder[orderId] || {};
  return {
    ...existing,
    ...row,
    order_id: orderId,
    package_name: pkg,
    amount: numberValue(row.amount),
    currency: String(row.currency || "USD").toUpperCase(),
    details: row.details && typeof row.details === "object" ? row.details : (existing.details || {}),
    title: cleanAppTitle(pkg, appRecordById(pkg)?.title || existing.title || pkg),
    player_name: rtdnPlayerName(row) || rtdnPlayerName(existing) || null,
  };
}

function rtdnRowMatchesCurrentAccount(row) {
  if (!row) return false;
  const accountId = String(row.play_account_id || DEFAULT_PLAY_ACCOUNT_ID);
  return accountId === currentPlayAccountId();
}

function rtdnAmountUsd(row) {
  const amount = numberValue(row && row.amount);
  const currency = String(row && row.currency || "USD").toUpperCase();
  return currency === "VND" ? amount / currentUsdToVndRate : amount;
}

async function isOrderInGoogleEstimate(orderId) {
  const cleanOrderId = String(orderId || "").trim();
  if (!cleanOrderId) return false;
  const cacheKey = `${currentPlayAccountId()}::${cleanOrderId}`;
  if (realtimeEstimateOrderCache.has(cacheKey)) {
    return realtimeEstimateOrderCache.get(cacheKey);
  }
  if (!supabaseClient) return false;

  try {
    const { data, error } = await supabaseClient
      .from("estimates")
      .select("order_id")
      .eq("play_account_id", currentPlayAccountId())
      .eq("source", "google_play_estimate")
      .eq("order_id", cleanOrderId)
      .limit(1);
    if (error) throw error;
    const exists = Array.isArray(data) && data.length > 0;
    realtimeEstimateOrderCache.set(cacheKey, exists);
    return exists;
  } catch (err) {
    console.warn("Không kiểm tra được order trong estimate report:", err);
    return null;
  }
}

async function realtimeRtdnAddonDelta(row) {
  const tx = normalizeRealtimeRtdnRow(row);
  if (!tx || !rtdnRowMatchesCurrentAccount(tx) || !String(tx.order_id).startsWith("GPA.")) return null;
  const month = monthKeyFromIsoPacific(rtdnEventIso(tx));
  if (!month || !estimateMonthsForRealtime().has(month)) return null;

  const isDuplicate = await isOrderInGoogleEstimate(tx.order_id);
  if (isDuplicate === null) return { failed: true };
  if (isDuplicate) return null;

  return {
    row: tx,
    month,
    currency: String(tx.currency || "USD").toUpperCase(),
    amount: numberValue(tx.amount),
    amountUSD: roundMoney(rtdnAmountUsd(tx)),
  };
}

function upsertCurrencyAggregate(rows, currency, amountDelta, rowDelta) {
  const list = Array.isArray(rows) ? rows : [];
  const cur = String(currency || "USD").toUpperCase();
  const current = list.find(row => String(row.currency || "USD").toUpperCase() === cur);
  if (current) {
    current.amount = roundMoney(numberValue(current.amount) + amountDelta);
    current.rows = Math.max(0, Math.trunc(numberValue(current.rows) + rowDelta));
  } else if (rowDelta > 0) {
    list.push({ currency: cur, amount: roundMoney(amountDelta), rows: Math.max(0, rowDelta) });
  }
  return list
    .filter(row => numberValue(row.amount) !== 0 || numberValue(row.rows) > 0)
    .sort((a, b) => String(a.currency || "").localeCompare(String(b.currency || "")));
}

function upsertRtdnAddonByApp(row, month, amountDelta, rowDelta) {
  if (!serverSummary) return;
  if (!serverSummary.rtdnAddon) serverSummary.rtdnAddon = {};
  const addon = serverSummary.rtdnAddon;
  const list = Array.isArray(addon.byApp) ? addon.byApp : [];
  const currency = String(row.currency || "USD").toUpperCase();
  const pkg = String(row.package_name || "").trim();
  const current = list.find(item =>
    String(item.ledgerMonth || "") === month &&
    String(item.packageName || "") === pkg &&
    String(item.currency || "USD").toUpperCase() === currency
  );
  const eventIso = rtdnEventIso(row);

  if (current) {
    current.netAmount = roundMoney(numberValue(current.netAmount) + amountDelta);
    current.rows = Math.max(0, Math.trunc(numberValue(current.rows) + rowDelta));
    if (eventIso) {
      if (!current.firstEvent || eventIso < String(current.firstEvent)) current.firstEvent = eventIso;
      if (!current.lastEvent || eventIso > String(current.lastEvent)) current.lastEvent = eventIso;
    }
  } else if (pkg && rowDelta > 0) {
    list.push({
      ledgerMonth: month,
      packageName: pkg,
      currency,
      rows: Math.max(0, rowDelta),
      netAmount: roundMoney(amountDelta),
      firstEvent: eventIso,
      lastEvent: eventIso,
    });
  }

  addon.byApp = list
    .filter(item => numberValue(item.netAmount) !== 0 || numberValue(item.rows) > 0)
    .sort((a, b) =>
      String(a.ledgerMonth || "").localeCompare(String(b.ledgerMonth || "")) ||
      numberValue(b.netAmount) - numberValue(a.netAmount) ||
      String(a.packageName || "").localeCompare(String(b.packageName || ""))
    );
}

function ensureRecentMonthKpi(month) {
  if (!serverSummary) return null;
  if (!serverSummary.kpis) serverSummary.kpis = {};
  const recent = Array.isArray(serverSummary.kpis.recentMonths)
    ? [...serverSummary.kpis.recentMonths]
    : buildRecentMonthlyKpisFromEarnings(earningsData, currentUsdToVndRate);
  let row = recent.find(item => item.month === month);
  if (!row) {
    row = {
      month,
      kind: "estimate",
      amountUSD: 0,
      officialUSD: 0,
      estimateUSD: 0,
      rtdnAddonUSD: 0,
      rtdnAddonRows: 0,
    };
    recent.push(row);
  }
  serverSummary.kpis.recentMonths = recent
    .sort((a, b) => String(a.month).localeCompare(String(b.month)))
    .slice(-3);
  return serverSummary.kpis.recentMonths.find(item => item.month === month) || null;
}

function applyRealtimeKpiDelta(delta, sign) {
  if (!serverSummary || !delta || sign === 0) return;
  const amountDelta = delta.amount * sign;
  const usdDelta = delta.amountUSD * sign;
  const rowDelta = sign;

  if (!serverSummary.rtdnAddon) serverSummary.rtdnAddon = {};
  const addon = serverSummary.rtdnAddon;
  addon.totalByCurrency = upsertCurrencyAggregate(addon.totalByCurrency, delta.currency, amountDelta, rowDelta);
  addon.rows = Math.max(0, Math.trunc(numberValue(addon.rows) + rowDelta));
  addon.totalUSD = roundMoney(numberValue(addon.totalUSD) + usdDelta);
  upsertRtdnAddonByApp(delta.row, delta.month, amountDelta, rowDelta);

  const kpis = serverSummary.kpis || (serverSummary.kpis = {});
  kpis.rtdnAddonUSD = roundMoney(numberValue(kpis.rtdnAddonUSD) + usdDelta);
  kpis.rtdnAddonRows = Math.max(0, Math.trunc(numberValue(kpis.rtdnAddonRows) + rowDelta));
  kpis.yourEarningsUSD = roundMoney(numberValue(kpis.yourEarningsUSD) + usdDelta);

  const recent = ensureRecentMonthKpi(delta.month);
  if (recent) {
    recent.rtdnAddonUSD = roundMoney(numberValue(recent.rtdnAddonUSD) + usdDelta);
    recent.rtdnAddonRows = Math.max(0, Math.trunc(numberValue(recent.rtdnAddonRows) + rowDelta));
    if (recent.kind !== "final") {
      recent.amountUSD = roundMoney(numberValue(recent.amountUSD) + usdDelta);
    }
  }

  if (serverSummary.currentMonth === delta.month) {
    kpis.estimateUSD = roundMoney(numberValue(kpis.estimateUSD) + usdDelta);
  }

  serverSummary.earnings = mergeRtdnAddonIntoEarnings(baseEarningsRows(), serverSummary);
  earningsData = serverSummary.earnings;
}

function compareRtdnRowsDesc(a, b) {
  const aMs = Date.parse(rtdnEventIso(a) || "") || 0;
  const bMs = Date.parse(rtdnEventIso(b) || "") || 0;
  if (aMs !== bMs) return bMs - aMs;
  return String(b.order_id || "").localeCompare(String(a.order_id || ""));
}

function applyRealtimeRtdnListChange(payload, normalizedNew, normalizedOld) {
  if (!serverSummary) return;
  const currentRows = Array.isArray(serverSummary.rtdnTransactions)
    ? [...serverSummary.rtdnTransactions]
    : [];
  const eventType = payload && payload.eventType;
  const newOrderId = normalizedNew && normalizedNew.order_id;
  const oldOrderId = normalizedOld && normalizedOld.order_id;
  const targetOrderId = newOrderId || oldOrderId;
  if (!targetOrderId) return;

  const existingIndex = currentRows.findIndex(row => row.order_id === targetOrderId);
  if (eventType === "DELETE") {
    if (existingIndex >= 0) currentRows.splice(existingIndex, 1);
    serverSummary.rtdnTotalCount = Math.max(0, numberValue(serverSummary.rtdnTotalCount) - 1);
  } else if (normalizedNew) {
    if (existingIndex >= 0) {
      currentRows[existingIndex] = { ...currentRows[existingIndex], ...normalizedNew };
    } else {
      currentRows.push(normalizedNew);
      if (eventType === "INSERT") {
        serverSummary.rtdnTotalCount = numberValue(serverSummary.rtdnTotalCount) + 1;
      }
    }
  }

  serverSummary.rtdnTransactions = currentRows
    .sort(compareRtdnRowsDesc)
    .slice(0, REALTIME_RTDN_PAGE_SIZE);
}

function realtimeSyncInfoFromRow(row) {
  if (!row) return null;
  const details = row.details || {};
  const pkg = String(row.package_name || "").trim();
  return {
    source: "realtime_addon",
    transactionAt: rtdnEventIso(row),
    transactionDate: null,
    orderId: row.order_id || null,
    appId: pkg || null,
    appTitle: pkg ? cleanAppTitle(pkg, appRecordById(pkg)?.title || row.title) : null,
    productTitle: details.productTitle || row.sku || null,
    amount: row.amount,
    currency: row.currency || "USD",
  };
}

function maybeUpdateCurrentMonthSync(row, month) {
  if (!serverSummary || !row || month !== serverSummary.currentMonth) return;
  const nextIso = rtdnEventIso(row);
  if (!nextIso) return;
  const currentIso = serverSummary.currentMonthSync && serverSummary.currentMonthSync.transactionAt;
  if (!currentIso || Date.parse(nextIso) >= Date.parse(currentIso)) {
    serverSummary.currentMonthSync = realtimeSyncInfoFromRow(row);
  }
}

async function enrichRealtimeRtdnPlayerName(orderId) {
  if (!orderId || !serverSummary || !Array.isArray(serverSummary.rtdnTransactions)) return;
  const current = serverSummary.rtdnTransactions.find(row => row.order_id === orderId);
  if (!current || rtdnPlayerName(current)) return;
  const enriched = await attachPlayerNamesToRtdnRows([current]);
  const next = enriched && enriched[0];
  if (!next || !rtdnPlayerName(next)) return;
  serverSummary.rtdnTransactions = serverSummary.rtdnTransactions.map(row =>
    row.order_id === orderId ? { ...row, player_name: next.player_name } : row
  );
  renderRtdnTransactions();
}

function getOrderSyncDetails(details) {
  if (!details || typeof details !== "object") return {};
  if (details.orderSync && typeof details.orderSync === "object") return details.orderSync;
  const step = details.steps && details.steps["sync-orders"];
  if (step && step.details && typeof step.details === "object") return step.details;
  return {};
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

function formatCompactNumber(value, digits = 2) {
  const n = numberValue(value);
  const abs = Math.abs(n);
  if (abs >= 1_000_000_000) return `${trimNumber(n / 1_000_000_000, digits)}B`;
  if (abs >= 1_000_000) return `${trimNumber(n / 1_000_000, digits)}M`;
  if (abs >= 1_000) return `${trimNumber(n / 1_000, digits)}K`;
  return new Intl.NumberFormat("vi-VN", { maximumFractionDigits: digits }).format(n);
}

function trimNumber(value, digits = 2) {
  const fixed = Number(value || 0).toFixed(digits);
  return fixed.replace(/\.?0+$/, "");
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
  const accountPayload = googlePlayAccountPayload();

  for (let run = 1; run <= ORDER_SYNC_MAX_RUNS; run++) {
    addLog(`Orders API enrichment: lượt ${run}/${ORDER_SYNC_MAX_RUNS}, tối đa ${formatCount(ORDER_SYNC_BATCH_LIMIT)} transactions`, "blue");
    const step = await invokeAdminSyncStep("sync-orders", {
      ...accountPayload,
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
  const accountPayload = googlePlayAccountPayload();

  syncProgressPlan = buildSyncProgressPlan();

  addLog(`Finalized earnings: dự kiến ${formatElapsed(syncProgressPlan.phases["sync-earnings"].durationMs)}`, "blue");
  startSyncProgressPhase("sync-earnings");
  const earningsStep = await invokeAdminSyncStep("sync-earnings", {
    ...accountPayload,
    source: `${source}:sync-earnings`,
    syncIcons: forceIconSync,
  });
  completeSyncProgressPhase("sync-earnings", earningsStep.elapsedMs);
  logFinalizedProgress(stepDetails(earningsStep.body), earningsStep.elapsedMs);

  addLog(`Estimated sales reports: dự kiến ${formatElapsed(syncProgressPlan.phases["sync-estimates"].durationMs)}`, "blue");
  startSyncProgressPhase("sync-estimates");
  const estimatesStep = await invokeAdminSyncStep("sync-estimates", {
    ...accountPayload,
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
  const selectedAccount = googlePlayAccounts.find(account => account.id === currentPlayAccountId());
  addLog(`Account Google Play: ${selectedAccount?.label || currentPlayAccountId()}`, "muted");
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
        addLog(`  Giao dịch realtime: ${syncedDelayedRtdn}, Estimated sales: ${syncedDelayedEstimates}`, "muted");

        if (hasOwnValue(orderSync, "delayedStill") || hasOwnValue(orderSync, "delayedStillRtdn") || hasOwnValue(orderSync, "delayedStillEstimates")) {
          const delayedStillRtdn = numberValue(orderSync.delayedStillRtdn);
          const delayedStillEstimates = numberValue(orderSync.delayedStillEstimates);
          const delayedStillTotal = hasOwnValue(orderSync, "delayedStill")
            ? numberValue(orderSync.delayedStill)
            : delayedStillRtdn + delayedStillEstimates;
          addLog(`- Transaction delay còn chờ retry: ${delayedStillTotal}`, "muted");
          addLog(`  Giao dịch realtime: ${delayedStillRtdn}, Estimated sales: ${delayedStillEstimates}`, "muted");
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
      .insert([{ id, title, play_account_id: currentPlayAccountId() }]);
      
    if (error) throw error;
    
    // Refresh apps list
    const { data: apps } = await supabaseClient
      .from("apps")
      .select("*")
      .eq("play_account_id", currentPlayAccountId())
      .order("title");
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
    play_account_id: currentPlayAccountId(),
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
      // Create/Upsert (account + source + app + month must be unique)
      const { error: err } = await supabaseClient
        .from("earnings")
        .upsert([payload], { onConflict: "play_account_id,app_id,month,source" });
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
function renderDashboard(options = {}) {
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
  //  - "Ước lượng tháng hiện tại": estimate rows plus realtime add-on rows
  //    that are not yet present in the Google Estimated sales report.
  const rate = currentUsdToVndRate;
  const toUSD = e => (e.currency === "VND" ? parseFloat(e.amount) / rate : parseFloat(e.amount));
  const isEstimate = e => e.source === "google_play_estimate";

  // For the full, unfiltered view, render the edge function's precomputed KPIs
  // verbatim so these cards match the Telegram bot exactly. Client-side
  // recomputation still drives the cards whenever a filter/search is active.
  const unfiltered = sourceFilter === "all" && !searchQuery;
  const recentMonthlyKpis = unfiltered && serverSummary && serverSummary.kpis && Array.isArray(serverSummary.kpis.recentMonths)
    ? serverSummary.kpis.recentMonths
    : buildRecentMonthlyKpisFromEarnings(filtered, rate);

  // Guard against null: a browser may have an older cached index.html whose
  // KPI elements differ from this script during a deploy transition.
  renderMonthlyKpi(kpiPrev2MonthLabel, kpiPrev2Month, kpiPrev2MonthVnd, recentMonthlyKpis[0], "Tháng N-2");
  renderMonthlyKpi(kpiPrevMonthLabel, kpiPrevMonth, kpiPrevMonthVnd, recentMonthlyKpis[1], "Tháng N-1");
  renderMonthlyKpi(kpiCurrentRtdnLabel, kpiCurrentRtdn, kpiCurrentRtdnVnd, recentMonthlyKpis[2], "Ước tính tháng N", {
    animate: options.animateLatestKpi,
    animateInitial: options.animateLatestKpi,
  });

  // The hidden legacy estimate card follows the same estimate + realtime snapshot.
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

  const csvEstimateUSD = filtered.filter(e => e.source === "google_play_estimate").reduce((sum, e) => sum + toUSD(e), 0);
  if (kpiCurrentEstimate) kpiCurrentEstimate.textContent = fmtUSD(csvEstimateUSD);
  if (kpiCurrentEstimateVnd) {
    kpiCurrentEstimateVnd.textContent = `≈ ${fmtVND(csvEstimateUSD * rate)}`;
  }

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

  // 6. Render realtime transactions (from the shared summary)
  renderRtdnTransactions();
}

// Render the individual realtime transactions returned by dashboard-summary.
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

function loginDeviceLabel(userAgent) {
  const ua = String(userAgent || "");
  if (!ua) return "—";
  const browser = /Edg\//.test(ua) ? "Edge"
    : /Chrome\//.test(ua) ? "Chrome"
    : /Safari\//.test(ua) ? "Safari"
    : /Firefox\//.test(ua) ? "Firefox"
    : "Browser";
  const os = /Mac OS X|Macintosh/.test(ua) ? "macOS"
    : /Windows/.test(ua) ? "Windows"
    : /Android/.test(ua) ? "Android"
    : /iPhone|iPad|iOS/.test(ua) ? "iOS"
    : "Unknown";
  return `${browser} · ${os}`;
}

function loginLogStatusLabel(row) {
  const event = String(row && row.metadata && row.metadata.event || "").trim().toLowerCase();
  if (event === "alive") {
    return isRecentLoginLog(row)
      ? { icon: "fa-signal", label: "Đang online", tone: "online" }
      : { icon: "fa-clock", label: "Vừa online", tone: "recent" };
  }
  if (event === "reload") return { icon: "fa-rotate", label: "Reload web", tone: "reload" };
  return { icon: "fa-circle-check", label: "Đăng nhập", tone: "login" };
}

function isRecentLoginLog(row, windowMs = ADMIN_ALIVE_STALE_MS) {
  const timestamp = Date.parse(row && row.login_at || "");
  return Number.isFinite(timestamp) && Date.now() - timestamp <= windowMs;
}

function renderLoginLogs(rows) {
  if (!loginLogBody) return;
  if (loginLogSubtitle) {
    const onlineCount = rows.filter(row => isRecentLoginLog(row)).length;
    loginLogSubtitle.textContent = rows.length
      ? `${rows.length} client/IP gần nhất · ${onlineCount} đang online`
      : "Chưa có lịch sử đăng nhập";
  }

  if (!rows.length) {
    loginLogBody.innerHTML = `<tr><td colspan="5" style="text-align:center;color:var(--text-muted);">Chưa có lịch sử đăng nhập</td></tr>`;
    return;
  }

  loginLogBody.innerHTML = rows.map((row) => {
    const time = vnDateParts(row.login_at);
    const status = loginLogStatusLabel(row);
    return `
      <tr>
        <td><div class="login-log-time">${escapeHtml(time.date)}</div><div class="login-log-sub">${escapeHtml(time.time)}</div></td>
        <td>${escapeHtml(row.email || "—")}</td>
        <td><code class="login-log-ip">${escapeHtml(row.ip_address || "—")}</code></td>
        <td><span class="login-log-device" title="${escapeHtml(row.user_agent || "")}">${escapeHtml(loginDeviceLabel(row.user_agent))}</span></td>
        <td><span class="login-log-status is-${escapeHtml(status.tone)}"><i class="fa-solid ${status.icon}"></i> ${escapeHtml(status.label)}</span></td>
      </tr>
    `;
  }).join("");
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
  const onerror = `this.outerHTML='${fallback}'`;
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
    console.warn("Không tải được tên người chơi cho giao dịch realtime:", err);
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
    body.innerHTML = `<tr><td colspan="8" style="text-align:center;padding:30px;color:var(--text-muted)">Chưa có giao dịch nào. Mỗi giao dịch IAP sẽ xuất hiện ngay khi Google gửi thông báo realtime.</td></tr>`;
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
      .eq("play_account_id", currentPlayAccountId())
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

function roundMoney(value) {
  return Math.round(numberValue(value) * 100) / 100;
}

function monthlyKpiLabel(row, fallback) {
  if (!row || !row.month) return fallback;
  const prefix = row.kind === "final" ? "Thu nhập tháng" : "Ước tính tháng";
  return `${prefix} ${monthLabel(row.month)}`;
}

function renderMonthlyKpi(labelEl, amountEl, vndEl, row, fallbackLabel, options = {}) {
  const usd = row ? numberValue(row.amountUSD) : 0;
  if (labelEl) labelEl.textContent = monthlyKpiLabel(row, fallbackLabel);
  setKpiNumber(amountEl, usd, fmtUSD, options.animate, { animateInitial: options.animateInitial });
  setKpiNumber(vndEl, usd * currentUsdToVndRate, (value) => `≈ ${fmtVND(value)}`, options.animate, {
    animateInitial: options.animateInitial,
  });
}

function setKpiNumber(el, value, formatter, animate = false, options = {}) {
  if (!el) return;
  const next = numberValue(value);
  const previous = Number(el.dataset.kpiNumber);
  const hasPrevious = Number.isFinite(previous);
  const startValue = hasPrevious ? previous : 0;
  const canAnimate = hasPrevious || options.animateInitial;
  const changed = canAnimate && Math.abs(startValue - next) >= 0.005;

  if (!animate || !changed) {
    el.textContent = formatter(next);
    el.dataset.kpiNumber = String(next);
    return;
  }

  const animationId = numberValue(el.dataset.kpiAnimationId) + 1;
  el.dataset.kpiAnimationId = String(animationId);
  el.classList.add("kpi-counting");
  pulseKpiCard(el);

  const startedAt = performance.now();
  const diff = next - startValue;
  const tick = (now) => {
    if (String(animationId) !== el.dataset.kpiAnimationId) return;
    const rawProgress = Math.min(1, (now - startedAt) / KPI_COUNT_ANIMATION_MS);
    const eased = 1 - Math.pow(1 - rawProgress, 3);
    el.textContent = formatter(startValue + diff * eased);
    if (rawProgress < 1) {
      requestAnimationFrame(tick);
      return;
    }
    el.textContent = formatter(next);
    el.dataset.kpiNumber = String(next);
    el.classList.remove("kpi-counting");
  };

  requestAnimationFrame(tick);
}

function pulseKpiCard(el) {
  const card = el.closest(".kpi-card");
  if (!card) return;
  card.classList.remove("kpi-live-pulse");
  void card.offsetWidth;
  card.classList.add("kpi-live-pulse");
}

function buildRecentMonthlyKpisFromEarnings(rows, rate) {
  const byMonth = new Map();
  rows.forEach(e => {
    const month = String(e.month || "");
    if (!/^\d{6}$/.test(month)) return;
    const current = byMonth.get(month) || {
      month,
      officialUSD: 0,
      estimateUSD: 0,
      officialRows: 0,
      estimateRows: 0,
    };
    const amount = e.currency === "VND"
      ? parseFloat(e.amount || 0) / rate
      : parseFloat(e.amount || 0);
    if (e.source === "google_play") {
      current.officialUSD += amount;
      current.officialRows += 1;
    } else if (e.source === "google_play_estimate") {
      current.estimateUSD += amount;
      current.estimateRows += 1;
    }
    byMonth.set(month, current);
  });

  return Array.from(byMonth.values())
    .sort((a, b) => a.month.localeCompare(b.month))
    .slice(-3)
    .map(row => {
      const isFinal = row.officialRows > 0;
      return {
        month: row.month,
        kind: isFinal ? "final" : "estimate",
        amountUSD: roundMoney(isFinal ? row.officialUSD : row.estimateUSD),
      };
    });
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
  const subject = info.orderId || info.productTitle || "cuối";
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
    const appIds = activeAccountAppIds();
    if (!appIds.length) throw new Error("Không có app cho account đang chọn");
    for (let from = 0; from < maxRows; from += pageSize) {
      const { data, error } = await supabaseClient
        .from("client_purchase_logs")
        .select("created_at")
        .in("package_name", appIds)
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

function chunks(values, size) {
  const out = [];
  for (let i = 0; i < values.length; i += size) {
    out.push(values.slice(i, i + size));
  }
  return out;
}

async function fetchEstimateOrderIds(orderIds) {
  const found = new Set();
  for (const group of chunks(orderIds, 500)) {
    const { data, error } = await supabaseClient
      .from("estimates")
      .select("order_id")
      .eq("play_account_id", currentPlayAccountId())
      .eq("source", "google_play_estimate")
      .in("order_id", group);
    if (error) throw error;
    (data || []).forEach(row => {
      if (row.order_id) found.add(String(row.order_id));
    });
  }
  return found;
}

async function fetchPagedRtdnRangeRows(range, useEventTime) {
  const rows = [];
  const pageSize = 1000;
  const maxRows = 50000;
  for (let from = 0; from < maxRows; from += pageSize) {
    let query = supabaseClient
      .from("rtdn_transactions")
      .select("order_id,package_name,amount,currency,event_time,created_at")
      .eq("play_account_id", currentPlayAccountId())
      .like("order_id", "GPA.%")
      .not("amount", "is", null)
      .order(useEventTime ? "event_time" : "created_at", { ascending: false, nullsFirst: false })
      .range(from, from + pageSize - 1);

    if (useEventTime) {
      query = query
        .gte("event_time", range.start)
        .lt("event_time", range.end);
    } else {
      query = query
        .is("event_time", null)
        .gte("created_at", range.start)
        .lt("created_at", range.end);
    }

    const { data, error } = await query;
    if (error) throw error;
    rows.push(...(data || []));
    if (!data || data.length < pageSize) break;
  }
  return rows;
}

async function fetchRtdnAddonRowsForRange(range) {
  const candidates = [
    ...await fetchPagedRtdnRangeRows(range, true),
    ...await fetchPagedRtdnRangeRows(range, false),
  ];
  const byOrderId = new Map();
  candidates.forEach(row => {
    const orderId = String(row.order_id || "").trim();
    if (orderId && !byOrderId.has(orderId)) byOrderId.set(orderId, row);
  });

  const orderIds = Array.from(byOrderId.keys());
  if (!orderIds.length) return [];

  const existingEstimateOrderIds = await fetchEstimateOrderIds(orderIds);
  return orderIds
    .filter(orderId => !existingEstimateOrderIds.has(orderId))
    .map(orderId => byOrderId.get(orderId))
    .filter(Boolean);
}

function topRevenueValue(app) {
  return Math.max(0, numberValue(app.totalUSD != null ? app.totalUSD : app.total));
}

function formatPlayMetricNumber(value) {
  if (value === null || value === undefined || value === "") return "—";
  return formatCompactNumber(value, 2);
}

function formatPlayRating(value) {
  const n = numberValue(value, NaN);
  if (!Number.isFinite(n) || n <= 0) return "—";
  return `${n.toFixed(3)}★`;
}

function formatPlayRevenue(value) {
  const n = Math.max(0, numberValue(value));
  return n >= 1000 ? `$${formatCompactNumber(n, 2)}` : fmtUSD(n);
}

function formatPlayDate(value) {
  if (!value) return "";
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) return String(value);
  return new Date(ms).toLocaleDateString("vi-VN", {
    timeZone: "Asia/Ho_Chi_Minh",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function playProductionLabel(value) {
  const raw = String(value || "").trim();
  const normalized = raw.toLowerCase();
  if (!raw || normalized === "published" || normalized === "completed" || normalized === "inprogress") {
    return "Production";
  }
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}

function playDeltaHtml(value) {
  if (value === null || value === undefined || value === "") return `<span class="play-delta is-muted">Chưa có so sánh 30 ngày trước</span>`;
  const n = numberValue(value);
  const cls = n > 0 ? "is-up" : n < 0 ? "is-down" : "is-flat";
  const icon = n > 0 ? "fa-arrow-up" : n < 0 ? "fa-arrow-down" : "fa-minus";
  return `<span class="play-delta ${cls}"><i class="fa-solid ${icon}"></i> ${trimNumber(Math.abs(n), 1)}% so với 30 ngày trước</span>`;
}

function playMetricSourceHtml(sourceDate) {
  const formatted = formatPlayDate(sourceDate);
  return formatted ? `<span class="play-metric-source">Dữ liệu tới ${escapeHtml(formatted)}</span>` : "";
}

function playMetricHtml(label, value, tooltip, deltaHtml, extraClass = "", sourceDate = "") {
  return `
    <div class="play-metric ${extraClass}">
      <span class="play-metric-label" data-tooltip="${escapeHtml(tooltip)}">${escapeHtml(label)}</span>
      <strong>${value}</strong>
      ${playMetricSourceHtml(sourceDate)}
      ${deltaHtml || ""}
    </div>
  `;
}

function normalizeTopRevenueCards(sortedApps) {
  return sortedApps.map(app => ({
    id: app.id,
    title: app.title || cleanAppTitle(app.id),
    iconUrl: app.iconUrl || app.icon_url || appIconUrl(app.id),
    totalUSD: topRevenueValue(app),
    playStoreUrl: app.playStoreUrl || app.play_store_url || `https://play.google.com/store/apps/details?id=${encodeURIComponent(app.id)}`,
    playStoreStatus: app.playStoreStatus || app.play_store_status || "published",
    productionStatus: app.productionStatus || app.play_production_status || "Production",
    lastUpdatedAt: app.lastUpdatedAt || app.play_last_updated_at || app.play_stats_source_date || "",
    statsSourceDate: app.statsSourceDate || app.play_stats_source_date || "",
    installedAudience: app.installedAudience ?? app.installed_audience ?? null,
    installedAudienceSourceDate: app.installedAudienceSourceDate || app.installed_audience_source_date || app.statsSourceDate || app.play_stats_source_date || "",
    installedAudienceDeltaPct: app.installedAudienceDeltaPct ?? app.installed_audience_delta_pct ?? null,
    userAcquisition: app.userAcquisition ?? app.user_acquisition ?? null,
    userAcquisitionSourceDate: app.userAcquisitionSourceDate || app.user_acquisition_source_date || app.statsSourceDate || app.play_stats_source_date || "",
    userAcquisitionDeltaPct: app.userAcquisitionDeltaPct ?? app.user_acquisition_delta_pct ?? null,
    googlePlayRating: app.googlePlayRating ?? app.google_play_rating ?? null,
    googlePlayRatingSourceDate: app.googlePlayRatingSourceDate || app.google_play_rating_source_date || app.statsSourceDate || app.play_stats_source_date || "",
  }));
}

function renderTopAppsList(sortedApps, emptyText) {
  if (sortedApps.length === 0) {
    topAppsList.innerHTML = `<div class="loading-placeholder">${escapeHtml(emptyText)}</div>`;
    return;
  }

  const cards = normalizeTopRevenueCards(sortedApps);
  topAppsList.innerHTML = cards.map((a) => {
    const icon = appIconHtml(a.id, a.title, "play-app-logo", "play-app-fallback", a.iconUrl);
    const status = playProductionLabel(a.productionStatus || a.playStoreStatus);
    const meta = [
      a.id,
      status,
    ].filter(Boolean);
    return `
    <article class="play-revenue-card">
      <div class="play-app-header">
        <div class="play-app-identity">
          ${icon}
          <div class="play-app-title-wrap">
            <h5>${escapeHtml(a.title)}</h5>
            <p>${meta.map(escapeHtml).join(" · ")}</p>
          </div>
        </div>
        <a class="play-view-link" href="${escapeHtml(a.playStoreUrl)}" target="_blank" rel="noopener">
          Xem app <i class="fa-solid fa-arrow-right"></i>
        </a>
      </div>
      <div class="play-metrics-grid">
        ${playMetricHtml(
          "Người dùng đang cài",
          formatPlayMetricNumber(a.installedAudience),
          "Số thiết bị đang hoạt động có cài ứng dụng theo ngày mới nhất trong báo cáo Google Play.",
          playDeltaHtml(a.installedAudienceDeltaPct),
          "",
          a.installedAudienceSourceDate,
        )}
        ${playMetricHtml(
          "Người dùng mới",
          formatPlayMetricNumber(a.userAcquisition),
          "Số người dùng cài ứng dụng và trước đó không cài trên bất kỳ thiết bị nào. Bao gồm người dùng kích hoạt thiết bị mới hoặc kích hoạt lại thiết bị không hoạt động có cài app.",
          playDeltaHtml(a.userAcquisitionDeltaPct),
          "",
          a.userAcquisitionSourceDate,
        )}
        ${playMetricHtml(
          "Đánh giá Google Play",
          formatPlayRating(a.googlePlayRating),
          "Điểm đánh giá trung bình hiện có của ứng dụng trên Google Play.",
          "",
          "",
          a.googlePlayRatingSourceDate,
        )}
        ${playMetricHtml(
          "Ước tính (USD)",
          formatPlayRevenue(a.totalUSD),
          "Doanh thu ledger ước tính trong tháng hiện tại. Giá trị âm được hiển thị là 0.",
          "",
          "is-revenue",
        )}
      </div>
    </article>
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
  topAppsList.innerHTML = renderPlayRevenueSkeleton(2);
  if (topAppsSyncInfo) {
    topAppsSyncInfo.textContent = `Dữ liệu doanh thu từ ${range.label} + giao dịch realtime chưa có trong estimate`;
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
        .eq("play_account_id", currentPlayAccountId())
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

    const rtdnAddonRows = await fetchRtdnAddonRowsForRange(range);
    if (requestId !== topAppsRangeRequestId) return;

    const totals = {};
    rows.forEach(row => {
      totals[row.app_id] = (totals[row.app_id] || 0) + amountToUSD(row.amount, row.currency, rate);
    });
    rtdnAddonRows.forEach(row => {
      const appId = String(row.package_name || "").trim();
      if (!appId) return;
      totals[appId] = (totals[appId] || 0) + amountToUSD(row.amount, row.currency, rate);
    });

    const sortedApps = Object.entries(totals)
      .map(([id, total]) => ({
        id,
        title: appMap[id] || cleanAppTitle(id),
        total: Math.round(numberValue(total) * 100) / 100,
      }))
      .filter(a => !isAdjustmentApp(a.id, a.title))
      .filter(a => isPublishedApp(a.id, a.title))
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
  topPlayersList.innerHTML = renderRankingSkeleton();
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
    const appIds = activeAccountAppIds();
    if (!appIds.length) {
      renderTopPlayersList([], customRange ? `Chưa có log nạp trong khoảng ${customRange.label}` : "Chưa có log nạp trong tháng này");
      return;
    }
    for (let from = 0; from < maxRows; from += pageSize) {
      const { data, error } = await supabaseClient
        .from("client_purchase_logs")
        .select("player_name,amount,currency,app_name,package_name,event_time,created_at")
        .in("package_name", appIds)
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
  const selectedMonth = (serverSummary && serverSummary.currentMonth) || currentMonthKeyVN();
  const customRange = topAppsFilterMode === "custom"
    ? getCustomRangeWindow(topAppsRangeStart, topAppsRangeEnd)
    : null;

  if (topAppsFilterMode === "custom" && topAppsMonthSelect) {
    renderTopAppsCustomRange(customRange, appMap, rate);
    return;
  }
  topAppsRangeRequestId += 1;

  if (topAppsSyncInfo) {
    const syncText = currentMonthSyncText(serverSummary);
    topAppsSyncInfo.textContent =
      syncText
        ? `${syncText} · Ước tính ledger tháng ${monthLabel(selectedMonth)}, chỉ gồm app đang publish`
        : `Ước tính ledger tháng ${monthLabel(selectedMonth)}, chỉ gồm app đang publish`;
  }

  let sortedApps = [];
  const topRevenueCards = serverSummary && Array.isArray(serverSummary.topRevenueCards)
    ? serverSummary.topRevenueCards
    : null;

  if (topRevenueCards) {
    sortedApps = topRevenueCards
      .filter(a => isPublishedApp(a.id, a.title))
      .filter(a => !shouldHideTopApp(a))
      .sort((a, b) => topRevenueValue(b) - topRevenueValue(a));
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
      ...appsList
        .filter(app => isPublishedApp(app.id, app.title))
        .map(app => app.id),
      ...Object.keys(totals).filter(id => !isAdjustmentApp(id, appMap[id])),
    ]);
    sortedApps = Array.from(appIds)
      .map(id => {
        const app = appRecordById(id) || {};
        return {
          ...app,
          id,
          title: appMap[id] || app.title || id,
          totalUSD: Math.max(0, totals[id] || 0),
        };
      })
      .filter(a => isPublishedApp(a.id, a.title))
      .filter(a => !shouldHideTopApp(a))
      .sort((a, b) => topRevenueValue(b) - topRevenueValue(a));
  }

  renderTopAppsList(sortedApps, `Không có ứng dụng đang publish trong tháng ${monthLabel(selectedMonth)}`);
}

// Render Chart
function renderChart(filtered, uniqueMonths, rate) {
  setChartSkeleton(false);
  const mainCanvas = document.getElementById("revenue-chart-main");
  const mainCtx = mainCanvas ? mainCanvas.getContext("2d") : null;
  
  if (chartMain) chartMain.destroy();
  chartMain = null;

  if (uniqueMonths.length === 0) {
    if (mainCtx) mainCtx.clearRect(0, 0, mainCanvas.width, mainCanvas.height);
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
  if (chartKpiSubtitle) chartKpiSubtitle.textContent = `${monthLabel(latestMonth)} · KPI tháng gần nhất`;

  const chartDataset = () => ({
    label: "Doanh thu (USD)",
    data: dataPoints,
    backgroundColor: "rgba(108, 140, 255, 0.45)",
    borderColor: "#6c8cff",
    borderWidth: 2,
    borderRadius: 8,
    hoverBackgroundColor: "rgba(108, 140, 255, 0.85)",
  });

  if (!mainCtx) return;
  chartMain = new Chart(mainCtx, {
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
