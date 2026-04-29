// CDP-over-TCP-through-sandbox proof-of-concept — 2026-04-28
//
// Demonstrates that a process running inside the macOS Seatbelt
// sandbox (the same sandbox Claude Code's tool calls run in, and
// therefore the same restrictions an agent inside any Duo PTY
// faces) can drive a separate Chrome instance via Chrome DevTools
// Protocol using only TCP transport — no Unix sockets.
//
// The sandbox blocks Unix-socket outbound connections by default
// (this is what Duo's Stage 20 "sandbox-tolerant transport" ADR
// works around for the duo CLI). The chrome-cdp-skill at
// https://github.com/dudgeon/chrome-cdp-skill has the same gap
// today: its per-tab daemon listens on a Unix socket, so
// page-level commands (snap / eval / click / shot / nav / type)
// hang in a sandboxed environment. Browser-level commands (list
// / windows / audit) bypass the daemon and work fine.
//
// Fixing the skill: swap `net.createServer({path: sockPath})` for
// `net.createServer().listen(0, '127.0.0.1')`, write the chosen
// port + a per-daemon token to /tmp/cdp-<targetId>.port, have the
// CLI read that file and connect via TCP. Same shape Duo's web
// daemon uses for its CLI bridge today.
//
// To run this test:
//
//   1. Launch a fresh Chrome with CDP enabled (separate user-data-dir
//      so it doesn't disturb the user's main Chrome):
//
//        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
//          --remote-debugging-port=9333 \
//          --remote-allow-origins='*' \
//          --user-data-dir=/tmp/duo-cdp-chrome-data \
//          --no-first-run --no-default-browser-check \
//          about:blank &
//
//   2. Run this script with Node 22+ (built-in WebSocket required):
//
//        ~/.nvm/versions/node/v22.22.1/bin/node cdp-tcp-sandbox-test.mjs
//
//   3. Expect: connects to fresh Chrome via TCP, opens a Gmail tab,
//      captures Page.captureScreenshot to /tmp/gmail-via-sandbox-cdp.png,
//      reads Accessibility.getFullAXTree, prints final URL+title.

import { request } from 'http';

const CHROME_PORT = 9333;

function httpJson(path, method = 'GET') {
  return new Promise((resolve, reject) => {
    const req = request(
      { host: '127.0.0.1', port: CHROME_PORT, path, method },
      (res) => {
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () => {
          try { resolve(JSON.parse(body)); } catch { resolve(body); }
        });
      }
    );
    req.on('error', reject);
    req.end();
  });
}

class CDP {
  constructor() {
    this.id = 0;
    this.pending = new Map();
    this.ws = null;
  }
  connect(url) {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(url);
      this.ws.onopen = () => resolve();
      this.ws.onerror = (e) =>
        reject(new Error('WS error: ' + (e.message || e.type)));
      this.ws.onmessage = (e) => {
        const msg = JSON.parse(e.data);
        if (msg.id && this.pending.has(msg.id)) {
          const { resolve, reject } = this.pending.get(msg.id);
          this.pending.delete(msg.id);
          if (msg.error) reject(new Error(msg.error.message));
          else resolve(msg.result);
        }
      };
    });
  }
  send(method, params = {}, sessionId) {
    const id = ++this.id;
    const msg = { id, method, params };
    if (sessionId) msg.sessionId = sessionId;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify(msg));
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`timeout: ${method}`));
        }
      }, 15000);
    });
  }
}

const v = await httpJson('/json/version');
console.log('[browser]', v.Browser);

// Modern Chrome requires PUT for /json/new
const newTab = await httpJson('/json/new?https://mail.google.com', 'PUT');
console.log('[new-tab opened]', newTab.id, '|', newTab.url);

const cdp = new CDP();
await cdp.connect(newTab.webSocketDebuggerUrl);
console.log('[ws-connected to tab]');

await cdp.send('Page.enable');
console.log(
  '[Page.enable ack — sent through Seatbelt-sandboxed shell to Chrome via TCP+WS]'
);

// Wait for nav to settle (Google redirects to accounts.google.com sign-in)
await new Promise((r) => setTimeout(r, 6000));

// Page.captureScreenshot — the canonical "page-level operation"
const shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
const fs = await import('fs');
fs.writeFileSync(
  '/tmp/gmail-via-sandbox-cdp.png',
  Buffer.from(shot.data, 'base64')
);
console.log(
  '[screenshot saved] /tmp/gmail-via-sandbox-cdp.png',
  Math.round((shot.data.length * 0.75) / 1024),
  'KB'
);

// Accessibility tree — the structural read of the page
const ax = await cdp.send('Accessibility.getFullAXTree');
console.log('[ax-tree nodes]', ax.nodes.length);
const meaningful = ax.nodes
  .filter(
    (n) =>
      n.role?.value &&
      n.name?.value &&
      n.role.value !== 'none' &&
      n.role.value !== 'generic'
  )
  .slice(0, 12);
console.log('[ax — first 12 named nodes]:');
for (const n of meaningful) {
  console.log(
    `  ${n.role.value.padEnd(18)} | ${(n.name.value || '').slice(0, 70)}`
  );
}

const ti = await cdp.send('Target.getTargetInfo', { targetId: newTab.id });
console.log('[final url]', ti.targetInfo.url);
console.log('[final title]', ti.targetInfo.title);

cdp.ws.close();
process.exit(0);
