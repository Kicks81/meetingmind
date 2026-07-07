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
//   node relay.js [port]      (default port 8765)

const { WebSocketServer, WebSocket } = require('ws');
const crypto = require('crypto');

const PORT = process.argv[2] ? parseInt(process.argv[2], 10) : 8765;
const UPSTREAM_BASE = 'wss://voice.ap-southeast-1.bytepluses.com/api/v3/sauc';

const wss = new WebSocketServer({ port: PORT });
console.log(`MeetingMind ASR relay listening on ws://localhost:${PORT}`);

wss.on('connection', (client) => {
  let upstream = null;
  let initialized = false;

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
        console.log(`Upstream connected (mode=${mode}, resourceId=${resourceId})`);
        client.send(JSON.stringify({ type: 'ready' }));
      });

      upstream.on('message', (msg) => {
        if (client.readyState === WebSocket.OPEN) client.send(msg);
      });

      upstream.on('close', (code, reason) => {
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
          console.error('Upstream handshake rejected:', detail);
          if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify({ type: 'error', message: detail }));
            client.close(1011, 'upstream handshake rejected');
          }
        });
      });

      upstream.on('error', (err) => {
        console.error('Upstream error:', err.message);
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
    if (upstream) upstream.close();
  });

  client.on('error', () => {
    if (upstream) upstream.close();
  });
});
