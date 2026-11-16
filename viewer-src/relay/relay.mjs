// Self-hosted WS⇄TCP relay: same wire protocol as worker/ (GET /tcp?ip=&port=443, subprotocol
// `uvpipe`, close codes 4403/4429/4502/1003/1000), without the Workers free-plan CPU kill.
// Runs behind Caddy (TLS) on a VM; listens on loopback only. Never logs payload bytes or IPs.
import { createServer } from 'node:http';
import { connect } from 'node:net';
import { WebSocketServer } from 'ws';

const HOST = process.env.RELAY_HOST ?? '127.0.0.1';
const PORT = Number(process.env.RELAY_PORT ?? 8080);
const MAX_PER_IP = 4; // one viewer session = 2 pipes (command + data)
const CONNECT_TIMEOUT_MS = 10_000;
const PING_EVERY_MS = 30_000;
const HIGH_WATER = 4 * 1024 * 1024; // pause the slow side above this many buffered bytes

const SUBPROTOCOL = 'uvpipe';
const CLOSE_NORMAL = 1000;
const CLOSE_UNSUPPORTED_DATA = 1003;
const CLOSE_FORBIDDEN_TARGET = 4403;
const CLOSE_TOO_MANY = 4429;
const CLOSE_CONNECT_FAILED = 4502;

// --- target guard: copy of worker/src/guard.ts (public IPv4 literal, port 443 only) ---------
const DOTTED_QUAD = /^(0|[1-9]\d{0,2})\.(0|[1-9]\d{0,2})\.(0|[1-9]\d{0,2})\.(0|[1-9]\d{0,2})$/;

function isPublicIPv4(ip) {
  const m = DOTTED_QUAD.exec(ip);
  if (!m) return false;
  const [a, b, c, d] = [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])];
  if ([a, b, c, d].some((n) => n > 255)) return false;
  if (a === 0 || a === 10 || a === 127) return false;
  if (a >= 224) return false;
  if (a === 100 && b >= 64 && b <= 127) return false;
  if (a === 169 && b === 254) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && b === 168) return false;
  if (a === 192 && b === 0 && (c === 0 || c === 2)) return false;
  if (a === 198 && (b === 18 || b === 19)) return false;
  if (a === 198 && b === 51 && c === 100) return false;
  if (a === 203 && b === 0 && c === 113) return false;
  return true;
}

function parseTarget(ip, port) {
  if (ip === null || port !== '443' || !isPublicIPv4(ip)) return null;
  return { ip, port: 443 };
}

// --- per-IP concurrency: in-process counter, so a dead pipe always releases its slot -------
const live = new Map();

/** Caddy appends the real peer last in X-Forwarded-For; earlier entries are client-supplied. */
function clientIp(req) {
  const xff = req.headers['x-forwarded-for'];
  const last = typeof xff === 'string' ? xff.split(',').pop()?.trim() : undefined;
  return last || req.socket.remoteAddress || 'unknown';
}

function acquire(key) {
  const n = live.get(key) ?? 0;
  if (n >= MAX_PER_IP) return false;
  live.set(key, n + 1);
  return true;
}

function release(key) {
  const n = (live.get(key) ?? 1) - 1;
  if (n <= 0) live.delete(key);
  else live.set(key, n);
}

function safeClose(ws, code, reason) {
  try {
    ws.close(code, reason);
  } catch {
    // already closed
  }
}

// --- server --------------------------------------------------------------------------------
const http = createServer((req, res) => {
  const path = new URL(req.url ?? '/', 'http://x').pathname;
  if (path === '/healthz') {
    res.writeHead(200, { 'content-type': 'text/plain' }).end(`ok ${countPipes()}\n`);
  } else if (path === '/tcp') {
    res.writeHead(426, { 'content-type': 'text/plain' }).end('Expected WebSocket\n');
  } else {
    res.writeHead(404, { 'content-type': 'text/plain' }).end('Not found\n');
  }
});

// Echo `uvpipe` whenever offered: a browser aborts with 1006 when none is selected.
const wss = new WebSocketServer({
  noServer: true,
  perMessageDeflate: false,
  maxPayload: 16 * 1024 * 1024,
  handleProtocols: (protocols) => (protocols.has(SUBPROTOCOL) ? SUBPROTOCOL : false),
});

http.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url ?? '/', 'http://x');
  if (url.pathname !== '/tcp') {
    socket.end('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n');
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => {
    const target = parseTarget(url.searchParams.get('ip'), url.searchParams.get('port'));
    if (target === null) return safeClose(ws, CLOSE_FORBIDDEN_TARGET, 'forbidden target');
    const key = clientIp(req);
    if (!acquire(key)) return safeClose(ws, CLOSE_TOO_MANY, 'too many connections');
    pipe(ws, target, () => release(key));
  });
});

function countPipes() {
  let n = 0;
  for (const v of live.values()) n += v;
  return n;
}

/** Dumb byte pipe: WS binary messages <-> raw TCP bytes. Payload is never inspected. */
function pipe(ws, target, onDone) {
  let done = false;
  const finish = (code, reason) => {
    if (done) return;
    done = true;
    clearInterval(pinger);
    tcp.destroy();
    safeClose(ws, code, reason);
    onDone();
  };

  const tcp = connect({ host: target.ip, port: target.port, noDelay: true });
  tcp.setTimeout(CONNECT_TIMEOUT_MS, () => finish(CLOSE_CONNECT_FAILED, 'tcp connect failed'));
  let connected = false;
  tcp.once('connect', () => {
    connected = true;
    tcp.setTimeout(0);
    tcp.setKeepAlive(true, 30_000);
  });

  // WS -> TCP (net.Socket queues writes made before `connect`, in order).
  let wsPaused = false;
  ws.on('message', (data, isBinary) => {
    if (!isBinary) return finish(CLOSE_UNSUPPORTED_DATA, 'binary only');
    if (!tcp.write(data) && !wsPaused) {
      wsPaused = true;
      ws.pause();
      tcp.once('drain', () => {
        wsPaused = false;
        ws.resume();
      });
    }
  });

  // TCP -> WS, with backpressure on the browser side.
  tcp.on('data', (chunk) => {
    ws.send(chunk, { binary: true }, () => {
      if (tcp.isPaused() && ws.bufferedAmount < HIGH_WATER / 2) tcp.resume();
    });
    if (ws.bufferedAmount > HIGH_WATER) tcp.pause();
  });
  tcp.on('end', () => finish(CLOSE_NORMAL, 'tcp closed'));
  tcp.on('close', () => finish(CLOSE_NORMAL, 'tcp closed'));
  tcp.on('error', () => finish(CLOSE_CONNECT_FAILED, connected ? 'tcp closed' : 'tcp connect failed'));

  ws.on('close', () => finish(CLOSE_NORMAL, 'ws closed'));
  ws.on('error', () => finish(CLOSE_NORMAL, 'ws error'));

  // Keep idle NAT/proxy paths open; drop a browser that stopped answering.
  let alive = true;
  ws.on('pong', () => (alive = true));
  const pinger = setInterval(() => {
    if (!alive) return finish(CLOSE_NORMAL, 'ping timeout');
    alive = false;
    try {
      ws.ping();
    } catch {
      // closing
    }
  }, PING_EVERY_MS);
}

http.listen(PORT, HOST, () => {
  console.log(`uv-relay listening on ${HOST}:${PORT}`);
});

for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, () => {
    for (const ws of wss.clients) safeClose(ws, 1001, 'relay restarting');
    http.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 2_000).unref();
  });
}
