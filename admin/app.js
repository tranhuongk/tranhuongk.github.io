// Supabase Client variables
let supabaseUrl = "";
let supabaseAnonKey = "";
let supabaseClient = null;
let session = null;
let chart = null;

// Local caching of data
let appsList = [];
let earningsData = [];

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
const btnAddIncome = document.getElementById("btn-add-income");
const btnCloseSyncOverlay = document.getElementById("btn-close-sync-overlay");

const kpiTotalRevenue = document.getElementById("kpi-total-revenue");
const kpiAppsCount = document.getElementById("kpi-apps-count");
const kpiMonthsCount = document.getElementById("kpi-months-count");
const kpiAvgRevenue = document.getElementById("kpi-avg-revenue");

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

// --- Initialization ---
document.addEventListener("DOMContentLoaded", async () => {
  // Load connection settings
  sbUrlInput.value = localStorage.getItem("supabase_url") || "https://lnazpyhoojqotnanrvqf.supabase.co";
  sbAnonKeyInput.value = localStorage.getItem("supabase_anon_key") || "";

  // Event Listeners
  configToggle.addEventListener("click", () => {
    configFields.classList.toggle("hidden");
    const icon = configToggle.querySelector(".fa-chevron-down");
    if (icon) {
      icon.classList.toggle("fa-chevron-up");
      icon.classList.toggle("fa-chevron-down");
    }
  });

  loginForm.addEventListener("submit", handleLogin);
  btnLogout.addEventListener("click", handleLogout);
  btnSync.addEventListener("click", triggerSync);
  btnAddIncome.addEventListener("click", () => openIncomeModal());
  
  document.querySelectorAll(".btn-close-modal").forEach(btn => {
    btn.addEventListener("click", closeIncomeModal);
  });
  
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
  if (sbUrlInput.value && sbAnonKeyInput.value) {
    initSupabase();
    const { data } = await supabaseClient.auth.getSession();
    if (data && data.session) {
      session = data.session;
      showScreen("dashboard");
      loadDataAndRender();
    } else {
      showScreen("auth");
    }
  } else {
    showScreen("auth");
  }
});

function initSupabase() {
  supabaseUrl = sbUrlInput.value.trim();
  supabaseAnonKey = sbAnonKeyInput.value.trim();
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
  
  if (!sbUrlInput.value || !sbAnonKeyInput.value) {
    showError("Vui lòng cấu hình đầy đủ Supabase URL và Anon Key.");
    return;
  }

  try {
    initSupabase();
  } catch (err) {
    showError("Định dạng Supabase URL không đúng.");
    return;
  }

  const email = loginEmail.value.trim();
  const password = loginPassword.value;

  const btn = loginForm.querySelector("button[type='submit']");
  btn.disabled = true;
  btn.querySelector("span").textContent = "Đang kết nối...";

  try {
    const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
    if (error) throw error;
    
    // Save settings
    localStorage.setItem("supabase_url", supabaseUrl);
    localStorage.setItem("supabase_anon_key", supabaseAnonKey);
    
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
  
  try {
    // 1. Fetch Apps
    const { data: apps, error: appsErr } = await supabaseClient
      .from("apps")
      .select("*")
      .order("title");
    if (appsErr) throw appsErr;
    appsList = apps || [];

    // 2. Fetch Earnings
    const { data: earnings, error: earnErr } = await supabaseClient
      .from("earnings")
      .select("*")
      .order("month", { ascending: false });
    if (earnErr) throw earnErr;
    earningsData = earnings || [];

    // Populate app dropdown in Modal
    populateAppDropdown();
    
    // Render
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
  } catch (err) {
    addLog(`Lỗi đồng bộ: ${err.message}`, "red");
    addLog("Vui lòng kiểm tra lại cấu hình GCS Bucket (PLAY_BUCKET) và Service Account (SA_JSON_B64) trong Supabase Secrets.", "red");
  } finally {
    btnCloseSyncOverlay.classList.remove("hidden");
  }
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
  // The headline KPIs reflect money ACTUALLY received: estimate rows
  // (source "google_play_estimate", shown with an "Est" marker) are excluded.
  // "Tổng thực nhận" và "Số tháng đã chốt" chỉ tính khoản đã nhận.
  // Conversion rate: 1 USD = 25000 VND (simple fallback)
  const rate = 25000;
  const toUSD = e => (e.currency === "VND" ? parseFloat(e.amount) / rate : parseFloat(e.amount));
  const received = filtered.filter(e => e.source !== "google_play_estimate");

  const totalUSD = received.reduce((sum, e) => sum + toUSD(e), 0);

  const uniqueApps = Array.from(new Set(filtered.map(e => e.app_id)));
  // All months (incl. estimate) drive the chart + pivot table below;
  // closedMonths (received only) drive the "đã chốt" / average KPIs.
  const uniqueMonths = Array.from(new Set(filtered.map(e => e.month))).sort();
  const closedMonths = Array.from(new Set(received.map(e => e.month))).sort();
  const avgMonthlyUSD = closedMonths.length ? totalUSD / closedMonths.length : 0;

  kpiTotalRevenue.textContent = fmtUSD(totalUSD);
  kpiAppsCount.textContent = uniqueApps.length;
  kpiMonthsCount.textContent = closedMonths.length;
  kpiAvgRevenue.textContent = fmtUSD(avgMonthlyUSD);

  // 3. Render Top Apps List
  renderTopApps(filtered, appMap, rate);

  // 4. Render Chart
  renderChart(filtered, uniqueMonths, rate);

  // 5. Render Pivot Table
  renderPivotTable(filtered, uniqueApps, uniqueMonths, appMap);
}

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

// Render Top Apps
function renderTopApps(filtered, appMap, rate) {
  const totals = {};
  filtered.forEach(e => {
    const amt = parseFloat(e.amount);
    const usd = e.currency === "USD" ? amt : amt / rate;
    totals[e.app_id] = (totals[e.app_id] || 0) + usd;
  });

  const sortedApps = Object.entries(totals)
    .map(([id, total]) => ({ id, title: appMap[id] || id, total }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 5); // top 5

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
          const usd = e.currency === "USD" ? amt : amt / 25000;
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
