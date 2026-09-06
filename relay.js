// MeetingMind ASR relay
//
// Browsers cannot set custom HTTP headers (X-Api-Key, etc.) on a WebSocket
// handshake, but BytePlus's ASR-Streaming API requires them. This tiny local
// server bridges the gap: meeting.html connects to it over a plain
// ws://localhost socket, and this process opens the authenticated upstream
// connection to BytePlus, then pipes bytes through in both directions
// untouched. It does not understand or modify the BytePlus binary protocol.
//
// Setup (one-time):
//   npm install ws
// Run (each time before using meeting.html):
//   node relay.js [--port <port>] [--host <host>]      (default port 8765)
//
// Why a flag instead of a bare positional argument: meeting.html is served
// from this same process (see STATIC_FILES below) and browsers scope
// localStorage per origin (scheme+host+port). A user who fat-fingers an
// extra word on the command line used to get it silently parsed as the
// port — landing on a different, unexpected port with a fresh, empty
// localStorage (no saved API keys/corrections/settings) and no obvious
// explanation why. Requiring --port makes an intentional port change
// explicit and turns a typo into "unrecognised argument" instead of a
// silent origin switch.

const { WebSocketServer, WebSocket } = require('ws');
const crypto = require('crypto');
const http = require('http');
const fs = require('fs');
const path = require('path');

// Args: node relay.js [--port <port>] [--host <host>]. --host defaults to
// 127.0.0.1 (localhost-only); pass --host 0.0.0.0 to opt into LAN access.
const rawArgs = process.argv.slice(2);
let HOST = '127.0.0.1';
let PORT = 8765;
for (let i = 0; i < rawArgs.length; i++) {
  if (rawArgs[i] === '--port') {
    PORT = parseInt(rawArgs[i + 1], 10);
    i++;
  } else if (rawArgs[i] === '--host') {
    HOST = rawArgs[i + 1] || HOST;
    i++;
  }
}
const UPSTREAM_BASE = 'wss://voice.ap-southeast-1.bytepluses.com/api/v3/sauc';
const BACKPRESSURE_BYTES = 1024 * 1024; // 1MB — visibility only, no throttling.

let connCounter = 0;
function ts() { return new Date().toISOString(); }
function log(id, msg) { console.log(`[${ts()}] [${id}] ${msg}`); }

// Serve the app itself over http://localhost so Chrome PERSISTS mic
// permissions ("Allow while visiting the site") — file:// pages get
// re-prompted on every single meeting. Static serving only; the ASR
// relaying below stays a dumb byte pipe.
const STATIC_FILES = {
  '/': 'meeting.html',
  '/meeting.html': 'meeting.html',
  '/core.js': 'core.js',
};
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8' };

const httpServer = http.createServer((req, res) => {
  if (req.url === '/favicon.ico') { res.writeHead(204); res.end(); return; }
  const file = STATIC_FILES[req.url.split('?')[0]];
  if (!file) { res.writeHead(404); res.end('not found'); return; }
  const filePath = path.join(__dirname, file);
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(500); res.end('read error'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
});

const wss = new WebSocketServer({ noServer: true });

httpServer.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} already in use — is another relay running? Close it or pass a different port: node relay.js ${PORT + 1}`);
    process.exit(1);
  }
  console.error('Server error:', err.message);
  process.exit(1);
});

httpServer.listen(PORT, HOST, () => {
  console.log(`MeetingMind running at http://${HOST}:${PORT} (ASR relay on the same port)`);
});

// Origin check on upgrade: reject browser connections from any origin other
// than this same host:port. Non-browser clients (no Origin header) are
// allowed through — this is a same-origin check, not an auth mechanism.
const ALLOWED_ORIGINS = new Set([
  `http://localhost:${PORT}`,
  `http://127.0.0.1:${PORT}`,
]);

httpServer.on('upgrade', (req, socket, head) => {
  const origin = req.headers.origin;
  if (origin && !ALLOWED_ORIGINS.has(origin)) {
    socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit('connection', ws, req);
  });
});

wss.on('connection', (client, req) => {
  const id = `c${++connCounter}`;
  log(id, `client connected (origin=${req.headers.origin || 'none'})`);
  let upstream = null;
  let initialized = false;

  const bpTimer = setInterval(() => {
    const clientBuf = client.bufferedAmount || 0;
    const upstreamBuf = upstream ? (upstream.bufferedAmount || 0) : 0;
    if (clientBuf > BACKPRESSURE_BYTES || upstreamBuf > BACKPRESSURE_BYTES) {
      log(id, `WARNING backpressure — client.bufferedAmount=${clientBuf} upstream.bufferedAmount=${upstreamBuf}`);
    }
  }, 5000);

  client.on('message', (data, isBinary) => {
    if (!initialized) {
      initialized = true;

      if (isBinary) {
        client.close(1002, 'expected a JSON init message first');
        return;
      }

      let init;
      try {
        init = JSON.parse(data.toString());
      } catch {
        client.close(1002, 'init message was not valid JSON');
        return;
      }

      if (!init.apiKey) {
        client.send(JSON.stringify({ type: 'error', message: 'missing apiKey' }));
        client.close(1002, 'missing apiKey');
        return;
      }

      const mode = init.mode || 'bigmodel_async';
      const resourceId = init.resourceId || 'volc.seedasr.sauc.duration';
      const url = `${UPSTREAM_BASE}/${mode}`;

      upstream = new WebSocket(url, {
        headers: {
          'X-Api-Key': init.apiKey,
          'X-Api-Resource-Id': resourceId,
          'X-Api-Connect-Id': crypto.randomUUID(),
        },
      });

      upstream.on('open', () => {
        log(id, `upstream open (mode=${mode}, resourceId=${resourceId})`);
        client.send(JSON.stringify({ type: 'ready' }));
      });

      upstream.on('message', (msg) => {
        if (client.readyState === WebSocket.OPEN) client.send(msg);
      });

      upstream.on('close', (code, reason) => {
        log(id, `upstream closed (code=${code} reason=${reason || ''})`);
        if (client.readyState === WebSocket.OPEN) {
          client.close(1000, `upstream closed (${code} ${reason})`);
        }
      });

      // Fired when the handshake itself gets rejected (e.g. HTTP 401/403 from
      // BytePlus before the connection ever upgrades to a WebSocket) — the
      // generic 'error' event alone hides the response status/body, which is
      // exactly what's needed to tell a bad key apart from a wrong resource
      // ID or region.
      upstream.on('unexpected-response', (req, res) => {
        let body = '';
        res.on('data', (chunk) => { body += chunk; });
        res.on('end', () => {
          const detail = `HTTP ${res.statusCode} ${res.statusMessage || ''} — ${body || '(empty body)'} — logid: ${res.headers['x-tt-logid'] || 'n/a'}`;
          log(id, `upstream handshake rejected: ${detail}`);
          if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify({ type: 'error', message: detail }));
            client.close(1011, 'upstream handshake rejected');
          }
        });
      });

      upstream.on('error', (err) => {
        log(id, `upstream error: ${err.message}`);
        if (client.readyState === WebSocket.OPEN) {
          client.send(JSON.stringify({ type: 'error', message: err.message }));
          client.close(1011, 'upstream error');
        }
      });

      return;
    }

    // All subsequent messages are already-framed BytePlus protocol bytes —
    // forward verbatim, no inspection.
    if (upstream && upstream.readyState === WebSocket.OPEN) {
      upstream.send(data);
    }
  });

  client.on('close', () => {
    clearInterval(bpTimer);
    log(id, 'client disconnected');
    if (upstream) upstream.close();
  });

  client.on('error', (err) => {
    log(id, `client error: ${err.message}`);
    if (upstream) upstream.close();
  });
});
