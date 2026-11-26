// Admin page for the Hà Nội proxy/VPN. All data comes from the VPS API (/padmin), which needs the admin
// password; this page holds nothing secret itself. Values from the API are put in the DOM as text only.
(() => {
  'use strict';
  const API = 'https://103-75-184-121.sslip.io/padmin';
  const PROXY = '103.75.184.121:48080';
  const TOKEN_KEY = 'proxyadmin.token';
  const $ = (id) => document.getElementById(id);

  let token = null;
  try { token = localStorage.getItem(TOKEN_KEY); } catch { /* storage blocked */ }
  let tab = 'live';
  let timer = null;
  let myIp = '';
  let logRows = [];

  // ---------- helpers ----------
  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v === false || v == null) continue;
      if (k === 'class') el.className = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const kid of kids.flat()) {
      if (kid == null || kid === false) continue;
      el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
    }
    return el;
  }

  function bytes(n) {
    n = Number(n) || 0;
    if (n < 1024) return `${n} B`;
    const u = ['KB', 'MB', 'GB', 'TB'];
    let i = -1;
    do { n /= 1024; i++; } while (n >= 1024 && i < u.length - 1);
    return `${n.toFixed(n < 10 ? 1 : 0)} ${u[i]}`;
  }

  function dur(s) {
    s = Math.max(0, Math.round(s));
    if (s < 60) return `${s} giây`;
    if (s < 3600) return `${Math.floor(s / 60)} phút`;
    if (s < 86400) return `${Math.floor(s / 3600)} giờ ${Math.floor((s % 3600) / 60)} phút`;
    return `${Math.floor(s / 86400)} ngày`;
  }

  const fmt = new Intl.DateTimeFormat('vi-VN', {
    timeZone: 'Asia/Ho_Chi_Minh', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const when = (t) => (t ? fmt.format(new Date(t * 1000)) : '—');
  const ago = (t) => (t ? `${dur(Date.now() / 1000 - t)} trước` : '—');

  const KIND = { proxy: 'Proxy', wireguard: 'WireGuard', ikev2: 'IKEv2' };
  const PROTO = { http: 'HTTP', socks5: 'SOCKS5', socks4: 'SOCKS4', wireguard: 'WireGuard', ikev2: 'IKEv2' };
  const stripPort = (host) => host.replace(/:(80|443)$/, '');

  let toastTimer = null;
  function toast(msg, err = false) {
    const t = $('toast');
    t.textContent = msg;
    t.className = err ? 'toast err' : 'toast';
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, 3500);
  }

  function setStatus(text, cls) {
    const s = $('status');
    s.textContent = text;
    s.className = `pill ${cls || ''}`;
  }

  async function api(path, body) {
    const opts = { headers: { Authorization: `Bearer ${token}` } };
    if (body !== undefined) {
      opts.method = 'POST';
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    let res;
    try {
      res = await fetch(API + path, opts);
    } catch {
      setStatus('Mất kết nối VPS', 'bad');
      throw new Error('Không gọi được VPS.');
    }
    const data = await res.json().catch(() => ({}));
    if (res.status === 401) {
      logout(false);
      throw new Error('Phiên đăng nhập đã hết.');
    }
    if (!res.ok) throw new Error(data.error || `Lỗi ${res.status}`);
    setStatus('Đang chạy', 'ok');
    return data;
  }

  async function act(fn, okMsg) {
    try {
      const r = await fn();
      if (okMsg) toast(typeof okMsg === 'function' ? okMsg(r) : okMsg);
      await refresh();
    } catch (e) {
      toast(e.message, true);
    }
  }

  const copy = async (text, what) => {
    try {
      await navigator.clipboard.writeText(text);
      toast(`Đã chép ${what}`);
    } catch {
      prompt('Chép thủ công:', text);
    }
  };

  // ---------- actions ----------
  const kickSid = (sid) => act(() => api('/kick', { sid }), 'Đã ngắt kết nối');
  const kickIke = (id) => act(() => api('/kick', { ike_id: id }), 'Đã ngắt VPN');
  const kickIp = (ip) => act(() => api('/kick', { ip }), (r) => `Đã ngắt ${r.kicked} kết nối của ${ip}`);

  function blockIp(ip, note = '') {
    const mine = ip === myIp ? '\n\nĐây là IP bạn đang dùng — bạn sẽ không dùng được proxy/VPN từ mạng này.' : '';
    if (!confirm(`Chặn ${ip}? IP này sẽ không dùng được proxy và VPN.${mine}`)) return;
    act(() => api('/block', { ip, note }), (r) => `Đã chặn ${ip}${r.kicked ? `, ngắt ${r.kicked} kết nối` : ''}`);
  }
  const unblockIp = (ip) => act(() => api('/unblock', { ip }), `Đã bỏ chặn ${ip}`);

  const ipButtons = (ip, blocked) => [
    h('button', { class: 'small', onclick: () => { showLogFor(ip); } }, 'Nhật ký'),
    blocked
      ? h('button', { class: 'small', onclick: () => unblockIp(ip) }, 'Bỏ chặn')
      : h('button', { class: 'small danger', onclick: () => blockIp(ip) }, 'Chặn IP'),
  ];

  const ipTags = (ip) => (ip === myIp ? h('span', { class: 'tag me' }, 'IP của bạn') : null);
  const empty = (text) => h('div', { class: 'empty' }, text);

  // ---------- live ----------
  async function loadLive() {
    const d = await api('/live');
    myIp = d.you || '';
    const now = d.now || Date.now() / 1000;
    const proxy = d.proxy || [];
    const wg = (d.wireguard || []).filter((p) => p.online);
    const ike = d.ikev2 || [];

    const byIp = new Map();
    for (const c of proxy) {
      if (!byIp.has(c.ip)) byIp.set(c.ip, []);
      byIp.get(c.ip).push(c);
    }
    const users = new Set(proxy.map((c) => c.user).filter(Boolean));
    $('live-stats').replaceChildren(
      stat(byIp.size, 'IP dùng proxy'),
      stat(proxy.length, 'kết nối proxy'),
      stat(users.size, 'user đang dùng'),
      stat(wg.length + ike.length, 'thiết bị VPN'),
    );

    $('live-proxy').replaceChildren(...(byIp.size ? [...byIp].map(([ip, conns]) => proxyGroup(ip, conns, now)) : [empty('Chưa ai dùng proxy lúc này.')]));

    const vpn = [
      ...wg.map((p) => h('div', { class: 'item' },
        h('div', { class: 'row between' },
          h('div', { class: 'group-head' }, h('span', { class: 'ip' }, p.ip || '—'), ipTags(p.ip), h('span', { class: 'tag ok' }, 'WireGuard'), h('span', { class: 'tag' }, p.name)),
          h('div', { class: 'actions' }, p.ip ? ipButtons(p.ip, false) : [])),
        h('div', { class: 'meta' }, h('span', {}, `IP trong VPN ${p.vpn_ip}`), h('span', {}, `bắt tay ${ago(p.handshake)}`),
          h('span', {}, `↓ ${bytes(p.tx)}  ↑ ${bytes(p.rx)}`)))),
      ...ike.map((s) => h('div', { class: 'item' },
        h('div', { class: 'row between' },
          h('div', { class: 'group-head' }, h('span', { class: 'ip' }, s.ip), ipTags(s.ip), h('span', { class: 'tag ok' }, 'IKEv2'), h('span', { class: 'tag' }, s.user)),
          h('div', { class: 'actions' }, h('button', { class: 'small', onclick: () => kickIke(s.ike_id) }, 'Ngắt'), ipButtons(s.ip, false))),
        h('div', { class: 'meta' }, h('span', {}, `IP trong VPN ${s.vpn_ip || '—'}`), h('span', {}, `đã nối ${dur(now - s.since)}`),
          h('span', {}, `↓ ${bytes(s.tx)}  ↑ ${bytes(s.rx)}`)))),
    ];
    $('live-vpn').replaceChildren(...(vpn.length ? vpn : [empty('Không có thiết bị nào đang nối VPN.')]));
  }

  function stat(n, label) {
    return h('div', { class: 'stat' }, h('b', {}, n), h('span', {}, label));
  }

  function proxyGroup(ip, conns, now) {
    const users = [...new Set(conns.map((c) => c.user).filter(Boolean))];
    const rx = conns.reduce((a, c) => a + (c.rx || 0), 0);
    const tx = conns.reduce((a, c) => a + (c.tx || 0), 0);
    return h('div', { class: 'item' },
      h('div', { class: 'row between' },
        h('div', { class: 'group-head' }, h('span', { class: 'ip' }, ip), ipTags(ip),
          users.map((u) => h('span', { class: 'tag' }, u)), h('span', { class: 'meta' }, `${conns.length} kết nối · ↓ ${bytes(tx)} ↑ ${bytes(rx)}`)),
        h('div', { class: 'actions' }, h('button', { class: 'small', onclick: () => kickIp(ip) }, 'Ngắt hết'), ipButtons(ip, false))),
      conns.map((c) => h('div', { class: 'sub' },
        h('div', { class: 'meta' },
          h('span', { class: 'hosts' }, c.hosts.length ? c.hosts.map(stripPort).join(', ') : (c.status === 'auth_failed' ? 'sai mật khẩu' : 'đang bắt tay…')),
          h('span', {}, PROTO[c.proto] || c.proto),
          h('span', {}, c.start ? dur(now - c.start) : ''),
          h('span', {}, `↓ ${bytes(c.tx)} ↑ ${bytes(c.rx)}`)),
        h('button', { class: 'small', onclick: () => kickSid(c.sid) }, 'Ngắt'))));
  }

  // ---------- by IP ----------
  async function loadIps() {
    const d = await api(`/ips?days=${$('ips-days').value}`);
    const rows = d.rows || [];
    $('ips-list').replaceChildren(...(rows.length ? rows.map((r) => h('div', { class: `item${r.blocked ? ' off' : ''}` },
      h('div', { class: 'row between' },
        h('div', { class: 'group-head' }, h('span', { class: 'ip' }, r.ip), ipTags(r.ip),
          r.blocked ? h('span', { class: 'tag bad' }, 'Đã chặn') : null,
          r.kinds.map((k) => h('span', { class: 'tag' }, KIND[k] || k)),
          r.users.map((u) => h('span', { class: 'tag' }, u)),
          r.failed ? h('span', { class: 'tag bad' }, `${r.failed} lần sai mật khẩu`) : null),
        h('div', { class: 'actions' }, ipButtons(r.ip, r.blocked))),
      h('div', { class: 'meta' },
        h('span', {}, `${r.count} kết nối`),
        h('span', {}, `lần cuối ${when(r.last)}`),
        h('span', {}, `lần đầu ${when(r.first)}`),
        h('span', {}, `↓ ${bytes(r.tx)} ↑ ${bytes(r.rx)}`)),
      r.top_hosts.length ? h('div', { class: 'hosts' }, `Hay vào: ${r.top_hosts.join(', ')}`) : null))
      : [empty('Chưa có IP nào trong khoảng này.')]));
  }

  // ---------- log ----------
  function logQuery(before) {
    const p = new URLSearchParams({ limit: '100' });
    const q = $('log-q').value.trim();
    if (q) p.set('q', q);
    if ($('log-kind').value) p.set('kind', $('log-kind').value);
    if ($('log-failed').checked) p.set('status', 'auth_failed');
    if (before) p.set('before', String(before));
    return `/history?${p}`;
  }

  async function loadLog(more = false) {
    const before = more && logRows.length ? logRows[logRows.length - 1].start : 0;
    const d = await api(logQuery(before));
    logRows = more ? logRows.concat(d.rows) : d.rows;
    $('log-more').hidden = !d.more;
    $('log-list').replaceChildren(...(logRows.length ? logRows.map(logItem) : [empty('Không có dòng nào khớp.')]));
  }

  function logItem(r) {
    const failed = r.status === 'auth_failed';
    const hosts = r.kind === 'proxy' ? (r.hosts || '').split(' ').filter(Boolean).map(stripPort).join(', ') : (r.hosts ? `IP trong VPN ${r.hosts}` : '');
    return h('div', { class: 'item' },
      h('div', { class: 'row between' },
        h('div', { class: 'group-head' }, h('span', { class: 'ip' }, r.ip || '—'), ipTags(r.ip),
          h('span', { class: 'tag' }, PROTO[r.proto] || KIND[r.kind] || r.kind),
          r.user ? h('span', { class: 'tag' }, r.user) : null,
          failed ? h('span', { class: 'tag bad' }, 'Sai mật khẩu') : null),
        h('span', { class: 'meta' }, when(r.start))),
      hosts ? h('div', { class: 'hosts' }, hosts) : null,
      h('div', { class: 'meta' },
        h('span', {}, `dài ${dur((r.end || r.start) - r.start)}`),
        h('span', {}, `↓ ${bytes(r.tx)} ↑ ${bytes(r.rx)}`)));
  }

  function showLogFor(ip) {
    $('log-q').value = ip;
    $('log-kind').value = '';
    $('log-failed').checked = false;
    switchTab('log');
  }

  // ---------- users ----------
  async function loadUsers() {
    const d = await api('/users');
    const users = d.users || [];
    $('users-list').replaceChildren(...(users.length ? users.map(userItem) : [empty('Chưa có user nào — không ai dùng được proxy.')]));
  }

  function userItem(u) {
    const secret = h('span', { class: 'secret' }, '••••••••');
    let shown = false;
    const line = `http://${u.name}:${u.password}@${PROXY}`;
    return h('div', { class: `item${u.enabled ? '' : ' off'}` },
      h('div', { class: 'row between' },
        h('div', { class: 'group-head' }, h('b', {}, u.name),
          u.enabled ? null : h('span', { class: 'tag bad' }, 'Đang tắt'),
          u.live ? h('span', { class: 'tag ok' }, `${u.live} kết nối`) : null,
          u.note ? h('span', { class: 'meta' }, u.note) : null),
        h('div', { class: 'actions' },
          h('button', { class: 'small', onclick: () => copy(line, 'chuỗi proxy') }, 'Chép chuỗi proxy'),
          h('button', { class: 'small', onclick: () => editUser(u) }, 'Sửa'),
          h('button', { class: 'small', onclick: () => toggleUser(u) }, u.enabled ? 'Tắt' : 'Bật'),
          h('button', { class: 'small danger', onclick: () => deleteUser(u) }, 'Xoá'))),
      h('div', { class: 'meta' },
        h('span', {}, 'Mật khẩu: ', secret, ' ',
          h('button', { class: 'small ghost', onclick: (e) => { shown = !shown; secret.textContent = shown ? u.password : '••••••••'; e.target.textContent = shown ? 'Ẩn' : 'Hiện'; } }, 'Hiện'),
          ' ', h('button', { class: 'small ghost', onclick: () => copy(u.password, 'mật khẩu') }, 'Chép')),
        h('span', {}, `dùng lần cuối ${u.last ? when(u.last) : 'chưa'}`)));
  }

  function editUser(u) {
    const pw = prompt(`Mật khẩu mới cho ${u.name} (để trống = giữ nguyên). Đổi mật khẩu sẽ ngắt các kết nối đang mở của user này.`, '');
    if (pw === null) return;
    const note = prompt('Ghi chú (ai dùng):', u.note || '');
    if (note === null) return;
    act(() => api('/users/save', { name: u.name, password: pw.trim() || undefined, note }), 'Đã lưu');
  }

  const toggleUser = (u) => act(() => api('/users/save', { name: u.name, enabled: !u.enabled }), u.enabled ? `Đã tắt ${u.name}` : `Đã bật ${u.name}`);

  function deleteUser(u) {
    if (!confirm(`Xoá user ${u.name}? Các kết nối đang mở của user này bị ngắt, không hoàn tác được.`)) return;
    act(() => api('/users/delete', { name: u.name }), `Đã xoá ${u.name}`);
  }

  // ---------- blocked ----------
  async function loadBlocked() {
    const d = await api('/blocked');
    const rows = d.blocked || [];
    $('blocked-list').replaceChildren(...(rows.length ? rows.map((b) => h('div', { class: 'item' },
      h('div', { class: 'row between' },
        h('div', { class: 'group-head' }, h('span', { class: 'ip' }, b.ip), ipTags(b.ip), b.note ? h('span', { class: 'meta' }, b.note) : null),
        h('div', { class: 'actions' }, h('button', { class: 'small', onclick: () => unblockIp(b.ip) }, 'Bỏ chặn'))),
      h('div', { class: 'meta' }, `chặn lúc ${when(b.at)}`))) : [empty('Chưa chặn IP nào.')]));
  }

  // ---------- shell ----------
  const loaders = { live: loadLive, ips: loadIps, log: () => loadLog(false), users: loadUsers, blocked: loadBlocked, settings: async () => {} };

  async function refresh() {
    try {
      await loaders[tab]();
    } catch (e) {
      if (token) toast(e.message, true);
    }
  }

  function schedule() {
    clearInterval(timer);
    timer = null;
    if (tab === 'live' && $('auto').checked) timer = setInterval(() => { if (!document.hidden) refresh(); }, 5000);
  }

  function switchTab(name) {
    tab = name;
    for (const b of document.querySelectorAll('.tabs button')) b.setAttribute('aria-selected', String(b.dataset.tab === name));
    for (const s of document.querySelectorAll('.tab')) s.hidden = s.id !== `tab-${name}`;
    try { localStorage.setItem('proxyadmin.tab', name); } catch { /* ignore */ }
    schedule();
    refresh();
  }

  function showApp() {
    $('login').hidden = true;
    $('app').hidden = false;
    let saved = 'live';
    try { saved = localStorage.getItem('proxyadmin.tab') || 'live'; } catch { /* ignore */ }
    switchTab(loaders[saved] ? saved : 'live');
  }

  function logout(callApi = true) {
    if (callApi && token) fetch(`${API}/logout`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } }).catch(() => {});
    token = null;
    try { localStorage.removeItem(TOKEN_KEY); } catch { /* ignore */ }
    clearInterval(timer);
    $('app').hidden = true;
    $('login').hidden = false;
    $('login-pass').value = '';
    $('login-pass').focus();
  }

  $('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = e.submitter;
    btn.disabled = true;
    $('login-msg').textContent = '';
    try {
      const res = await fetch(`${API}/login`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: $('login-pass').value }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || `Lỗi ${res.status}`);
      token = d.token;
      try { localStorage.setItem(TOKEN_KEY, token); } catch { /* session only */ }
      showApp();
    } catch (err) {
      $('login-msg').textContent = err.message === 'Failed to fetch' ? 'Không gọi được VPS.' : err.message;
    } finally {
      btn.disabled = false;
    }
  });

  for (const b of document.querySelectorAll('.tabs button')) b.addEventListener('click', () => switchTab(b.dataset.tab));
  $('auto').addEventListener('change', schedule);
  $('ips-days').addEventListener('change', refresh);
  let qTimer = null;
  $('log-q').addEventListener('input', () => { clearTimeout(qTimer); qTimer = setTimeout(refresh, 300); });
  $('log-kind').addEventListener('change', refresh);
  $('log-failed').addEventListener('change', refresh);
  $('log-more').addEventListener('click', () => loadLog(true).catch((e) => toast(e.message, true)));
  $('logout').addEventListener('click', () => logout());

  $('user-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const name = $('user-name').value.trim().toLowerCase();
    act(async () => {
      const r = await api('/users/save', { name, password: $('user-pass').value.trim() || undefined, note: $('user-note').value.trim() });
      e.target.reset();
      return r;
    }, `Đã thêm ${name}`);
  });

  $('block-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const ip = $('block-ip').value.trim();
    blockIp(ip, $('block-note').value.trim());
    e.target.reset();
  });

  $('pw-form').addEventListener('submit', (e) => {
    e.preventDefault();
    act(async () => {
      const r = await api('/password', { old: $('pw-old').value, new: $('pw-new').value });
      e.target.reset();
      return r;
    }, 'Đã đổi mật khẩu quản trị; các thiết bị khác phải đăng nhập lại');
  });

  document.addEventListener('visibilitychange', () => { if (!document.hidden && token && tab === 'live') refresh(); });

  if (token) showApp();
  else logout(false);
})();
