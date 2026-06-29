// Supabase Client variables
const supabaseUrl = "https://lnazpyhoojqotnanrvqf.supabase.co";
const supabaseAnonKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxuYXpweWhvb2pxb3RuYW5ydnFmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI1NzAyNjcsImV4cCI6MjA5ODE0NjI2N30.uc4WAXKm_UDKoLEm260mu0RHyHaL4HGtPI3sG-TbJSg";
let supabaseClient = null;
let session = null;
let chart = null;

// --- App package mappings ---
const PACKAGE_MAP = {
  "com.galaxteam.treasurequest": "Treasure Quest",
  "com.galaxteam.braingems": "Brain Gems",
  "com.luckyspin.game": "Lucky Spin",
  "com.galaxteam.wordchain": "Word Chain",
  "com.galaxteam.vocabquest": "Vocab Quest",
  "com.galaxteam.viet_riddles": "Viet Riddles",
  "com.galaxteam.pixel_realms": "Pixel Realms",
  "com.galaxteam.galaxarcade": "Galax Arcade",
  "com.galaxteam.bloombounce": "Orbiloop",
};

function cleanAppTitle(pkg, fallback) {
  const cleanPkg = String(pkg).trim().toLowerCase();
  for (const [k, v] of Object.entries(PACKAGE_MAP)) {
    if (k.toLowerCase() === cleanPkg) return v;
  }
  if (fallback) {
    const cleanFallback = String(fallback).trim().toLowerCase();
    for (const [k, v] of Object.entries(PACKAGE_MAP)) {
      if (k.toLowerCase() === cleanFallback) return v;
    }
    return fallback;
  }
  if (pkg && pkg.includes(".")) {
    const parts = pkg.split(".");
    const name = parts[parts.length - 1];
    return name.charAt(0).toUpperCase() + name.slice(1);
  }
  return pkg || "Unknown";
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
  
  btnCloseSyncOverlay.addEventListener("click", () => {
    syncOverlay.classList.add("hidden");
    loadDataAndRender();
  });

  // Try to initialize Supabase
  initSupabase();
  const { data } = await supabaseClient.auth.getSession();
  if (data && data.session) {
    session = data.session;
    showScreen("dashboard");
    loadDataAndRender();
  } else {
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
        if (s.rtdnRecentEstimates && s.rtdnRecentEstimates.length > 0) {
          earningsData = [...earningsData, ...s.rtdnRecentEstimates];
        }
        populateAppDropdown();
        renderDashboard();
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
  } catch (err) {
    console.error("Lỗi khi tải dữ liệu:", err);
    alert("Không thể tải dữ liệu từ Supabase: " + err.message);
  }
}

function populateAppDropdown() {
  incomeAppSelect.innerHTML = appsList.map(a => `<option value="${a.id}">${a.title} (${a.id})</option>`).join("");
}

// --- Sync Handler ---
async function triggerSync() {
  if (!supabaseClient || !session) return;
  
  syncOverlay.classList.remove("hidden");
  btnCloseSyncOverlay.classList.add("hidden");
  syncLogs.innerHTML = "";

  // Reset to the in-progress state (the overlay may have been left showing a
  // finished/failed state from a previous run).
  if (syncLoader) syncLoader.classList.remove("hidden");
  if (syncTitle) {
    syncTitle.textContent = "Đang đồng bộ Google Play...";
    syncTitle.style.color = "";
  }
  if (syncSubtitle) syncSubtitle.textContent = "Đang tải tệp báo cáo từ Google Cloud Storage và tổng hợp dữ liệu doanh thu...";

  addLog("Bắt đầu gọi API đồng bộ...", "blue");
  
  try {
    addLog("Đang gửi yêu cầu xác thực tới Edge Function...", "muted");
    const response = await fetch(`${supabaseUrl}/functions/v1/sync-earnings`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${session.access_token}`
      }
    });

    const result = await response.json();
    
    if (!response.ok) {
      throw new Error(result.error || `HTTP error! status: ${response.status}`);
    }

    addLog("Đồng bộ hoàn tất thành công!", "green");
    addLog(`Đã đồng bộ: ${result.message}`, "green");
    if (result.details) {
      addLog(`- Số app đã quét: ${result.details.appsSyncedCount}`, "blue");
      addLog(`- Số bản ghi doanh thu: ${result.details.earningsSyncedCount}`, "blue");
      addLog(`- Các tháng được cập nhật: ${result.details.monthsSynced.join(", ")}`, "yellow");
    }
    setSyncStatus(true, "Đã cập nhật xong. Bấm \"Đóng\" để xem dữ liệu mới.");
  } catch (err) {
    addLog(`Lỗi đồng bộ: ${err.message}`, "red");
    addLog("Vui lòng kiểm tra lại cấu hình GCS Bucket (PLAY_BUCKET) và Service Account (SA_JSON_B64) trong Supabase Secrets.", "red");
    setSyncStatus(false, "Có lỗi xảy ra trong quá trình đồng bộ.");
  } finally {
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
  const isEstimate = e => e.source === "google_play_estimate" || e.source === "rtdn_recent";

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
  let dEstimate = currentEstimateUSD;
  let dPrevMonth = prevMonth, dPrevMonthUSD = prevMonthUSD;
  let dPrev2Month = prev2Month, dPrev2MonthUSD = prev2MonthUSD;
  if (unfiltered && serverSummary && serverSummary.kpis) {
    dEstimate = serverSummary.kpis.estimateUSD;
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

  if (kpiCurrentEstimate) kpiCurrentEstimate.textContent = fmtUSD(dEstimate);
  if (kpiCurrentEstimateVnd) {
    kpiCurrentEstimateVnd.textContent = `≈ ${fmtVND(dEstimate * rate)}`;
  }
  
  // Calculate current month string (e.g. "06/2026") for the label
  if (kpiCurrentEstimateLabel) {
    let toDateStr = "";
    const estRows = officialRows.length >= 0 ? filtered.filter(isEstimate) : []; // use filtered rows
    if (estRows.length > 0) {
      const maxTime = Math.max(...estRows.map(r => new Date(r.updated_at).getTime()));
      if (!isNaN(maxTime)) {
        const d = new Date(maxTime);
        const dd = String(d.getDate()).padStart(2, '0');
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        toDateStr = ` (tới ngày ${dd}/${mm})`;
      }
    }
    kpiCurrentEstimateLabel.textContent = `Ước tính tháng hiện tại${toDateStr}`;
  }

  // Current-month income actually confirmed via RTDN (server-computed, from the
  // rtdn_transactions table) — independent of the table filters.
  const rtdnUSD = (serverSummary && serverSummary.kpis && serverSummary.kpis.currentMonthRtdnUSD) || 0;
  const kpiCurrentRtdn = document.getElementById("kpi-current-rtdn");
  const kpiCurrentRtdnVnd = document.getElementById("kpi-current-rtdn-vnd");
  if (kpiCurrentRtdn) kpiCurrentRtdn.textContent = fmtUSD(rtdnUSD);
  if (kpiCurrentRtdnVnd) kpiCurrentRtdnVnd.textContent = `≈ ${fmtVND(rtdnUSD * rate)}`;
  
  if (navExchangeRate) {
    navExchangeRate.textContent = `Tỷ giá: ${fmtVND(rate)} / USD`;
  }

  // uniqueApps + uniqueMonths drive the chart + pivot table below.
  const uniqueApps = Array.from(new Set(filtered.map(e => e.app_id)));
  const uniqueMonths = Array.from(new Set(filtered.map(e => e.month))).sort();

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

// One table row (Play Console "Order management" style).
function rtdnRowHtml(t) {
  const d = t.details || {};
  const { date, time } = vnDateParts(t.event_time);
  const pkg = t.package_name || "";
  const initial = (t.title || pkg || "?").charAt(0).toUpperCase();
  const logo = `<img class="rtdn-app-logo" src="app-icons/${pkg}.png" alt="${t.title || pkg}" onerror="this.outerHTML='<div class=&quot;rtdn-app-fallback&quot;>${initial}</div>'">`;
  const estRev = (d.estimatedRevenue != null ? d.estimatedRevenue : t.amount);
  return `<tr>
      <td><div class="rtdn-date-main">${date}</div><div class="rtdn-sub">${time}</div></td>
      <td>${logo}</td>
      <td>
        <div class="rtdn-product-title">${d.productTitle || t.title || pkg}</div>
        <div class="rtdn-sub">${t.sku || ""}</div>
        <div class="rtdn-sub">${d.purchaseType || "Buy"}</div>
      </td>
      <td>${t.order_id}</td>
      <td><span class="rtdn-status"><i class="fa-solid fa-circle-check"></i> ${statusLabel(d.status)}</span></td>
      <td>${fmtMoneyCode(estRev, t.currency)}</td>
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
    body.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:30px;color:var(--text-muted)">Chưa có giao dịch RTDN nào. Mỗi giao dịch IAP sẽ xuất hiện ngay khi Google gửi thông báo realtime.</td></tr>`;
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
    const rows = (data || []).map(t => ({ ...t, title: cleanAppTitle(t.package_name) }));
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
  content.innerHTML =
    row("Order status", `<span class="rtdn-status"><i class="fa-solid fa-circle-check"></i> ${statusLabel(d.status)}</span>`) +
    row("Order ID", t.order_id) +
    row("Date", `${date} ${time}`) +
    row("Billing address", d.buyerCountry || "—") +
    row("List price", fmtMoneyCode(d.listPrice != null ? d.listPrice : t.amount, t.currency)) +
    row("Tax", fmtMoneyCode(d.tax || 0, t.currency)) +
    row("Total", fmtMoneyCode(d.total != null ? d.total : t.amount, t.currency)) +
    row("Estimated revenue", fmtMoneyCode(d.estimatedRevenue != null ? d.estimatedRevenue : t.amount, t.currency)) +
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

// Render Top Apps — ranked by RTDN estimated revenue (from the shared summary).
// Falls back to official earnings only if the summary function is unavailable.
function renderTopApps(filtered, appMap, rate) {
  let sortedApps;
  if (serverSummary && serverSummary.topAppsRtdn) {
    sortedApps = serverSummary.topAppsRtdn
      .filter(a => a.totalUSD)
      .map(a => ({ id: a.id, title: a.title, total: a.totalUSD }))
      .slice(0, 5);
  } else {
    const totals = {};
    filtered
      .filter(e => e.source !== "google_play_estimate")
      .forEach(e => {
        const amt = parseFloat(e.amount);
        const usd = e.currency === "USD" ? amt : amt / rate;
        totals[e.app_id] = (totals[e.app_id] || 0) + usd;
      });
    sortedApps = Object.entries(totals)
      .map(([id, total]) => ({ id, title: appMap[id] || id, total }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 5);
  }

  if (sortedApps.length === 0) {
    topAppsList.innerHTML = `<div class="loading-placeholder">Không có dữ liệu</div>`;
    return;
  }

  topAppsList.innerHTML = sortedApps.map((a, idx) => `
    <div class="app-item">
      <div class="app-item-left">
        <div class="app-badge">${idx + 1}</div>
        <div>
          <span class="app-name">${a.title}</span>
          <span class="app-pkg">${a.id}</span>
        </div>
      </div>
      <span class="app-revenue">${fmtUSD(a.total)}</span>
    </div>
  `).join("");
}

// Render Chart
function renderChart(filtered, uniqueMonths, rate) {
  const ctx = document.getElementById("revenue-chart").getContext("2d");
  
  if (chart) {
    chart.destroy();
  }

  if (uniqueMonths.length === 0) {
    ctx.clearRect(0, 0, 400, 300);
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

  chart = new Chart(ctx, {
    type: "bar",
    data: {
      labels: chronologicalMonths.map(monthLabel),
      datasets: [{
        label: "Doanh thu (USD)",
        data: dataPoints,
        backgroundColor: "rgba(108, 140, 255, 0.45)",
        borderColor: "#6c8cff",
        borderWidth: 2,
        borderRadius: 8,
        hoverBackgroundColor: "rgba(108, 140, 255, 0.85)",
      }]
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
  let headerHtml = "<th>Ứng dụng</th>";
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
    let appTotalUSD = 0;
    
    let rowCellsHtml = `<td>
      <div><strong>${title}</strong></div>
      <div style="font-size:10px;color:var(--text-muted)">${appId}</div>
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
          
          if (e.source === "google_play_estimate" || e.source === "rtdn_recent") isEstimate = true;
          if (e.source !== "google_play" && e.source !== "google_play_estimate" && e.source !== "rtdn_recent") {
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
    let totalRowHtml = "<td><strong>TỔNG CỘNG</strong></td>";
    months.forEach(m => {
      const monthSum = monthTotalsUSD[m] || 0;
      totalRowHtml += `<td class="val-pos" style="font-weight:700">${fmtUSD(monthSum)}</td>`;
    });
    totalRowHtml += `<td class="val-pos" style="font-weight:800;border-left:1px solid var(--border-light)">${fmtUSD(appRows.reduce((sum, r) => sum + r.totalUSD, 0))}</td>`;
    bodyHtml += `<tr class="total-row">${totalRowHtml}</tr>`;
  } else {
    bodyHtml = `<tr><td colspan="${months.length + 2}" style="text-align:center;padding:40px;color:var(--text-muted)">Không tìm thấy bản ghi thu nhập nào. Bấm 'Đồng bộ Google Play' hoặc 'Thêm thu nhập' để bắt đầu.</td></tr>`;
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
