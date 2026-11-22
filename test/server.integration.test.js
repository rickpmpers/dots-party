import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { WebSocket } from 'ws';

const port = 39000 + Math.floor(Math.random() * 1000);
const origin = `http://127.0.0.1:${port}`;
let server;

const waitForHealth = async () => {
  for (let attempt = 0; attempt < 50; attempt++) {
    try { if ((await fetch(`${origin}/health`)).ok) return; } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('Server did not become healthy');
};

const openClient = async () => {
  const socket = new WebSocket(origin, { origin });
  await once(socket, 'open');
  return socket;
};

const nextEvent = (socket, event, timeoutMs = 3000) => new Promise((resolve, reject) => {
  const timeout = setTimeout(() => { cleanup(); reject(new Error(`Timed out waiting for ${event}`)); }, timeoutMs);
  const onMessage = raw => {
    const message = JSON.parse(String(raw));
    if (message.event !== event) return;
    cleanup(); resolve(message);
  };
  const onClose = () => { cleanup(); reject(new Error(`Socket closed while waiting for ${event}`)); };
  const cleanup = () => { clearTimeout(timeout); socket.off('message', onMessage); socket.off('close', onClose); };
  socket.on('message', onMessage); socket.on('close', onClose);
});

const sendAndWait = (socket, payload, event) => {
  const pending = nextEvent(socket, event);
  socket.send(JSON.stringify(payload));
  return pending;
};

test.before(async () => {
  server = spawn(process.execPath, ['server.js'], {
    cwd: new URL('..', import.meta.url),
    env: { ...process.env, PORT: String(port), PUBLIC_ORIGIN: origin, ALLOWED_ORIGINS: origin },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await waitForHealth();
});

test.after(async () => {
  if (!server?.killed) server.kill('SIGTERM');
  if (server?.exitCode === null) await once(server, 'exit');
});

test('serves secure headers and a room QR code', async () => {
  const page = await fetch(origin);
  assert.equal(page.status, 200);
  assert.equal(page.headers.get('x-frame-options'), 'DENY');
  assert.match(page.headers.get('content-security-policy'), /connect-src/);
  const qr = await fetch(`${origin}/api/qr?room=ABC234`);
  assert.equal(qr.status, 200);
  assert.match(qr.headers.get('content-type'), /image\/svg\+xml/);
  assert.match(await qr.text(), /^<svg/);
});

test('synchronizes a 10-player match and rejects player 11', async t => {
  const clients = [];
  t.after(() => clients.forEach(socket => socket.close()));
  const host = await openClient(); clients.push(host);
  const hostIdentity = await sendAndWait(host, { action: 'create', name: 'Host' }, 'identity');
  assert.match(hostIdentity.code, /^[A-HJ-NP-Z2-9]{6}$/);

  const identities = [hostIdentity];
  for (let number = 2; number <= 10; number++) {
    const client = await openClient(); clients.push(client);
    identities.push(await sendAndWait(client, { action: 'join', code: hostIdentity.code, name: `Player ${number}` }, 'identity'));
  }

  const extra = await openClient(); clients.push(extra);
  const full = await sendAndWait(extra, { action: 'join', code: hostIdentity.code, name: 'Player 11' }, 'error');
  assert.match(full.message, /full \(10 players\)/);

  const playing = nextEvent(clients[1], 'state');
  host.send(JSON.stringify({ action: 'start' }));
  let state;
  do { ({ state } = await playing); } while (state.status !== 'playing');
  assert.equal(state.players.length, 10);
  assert.equal(state.turnId, hostIdentity.playerId);

  const synchronized = nextEvent(clients[1], 'state');
  host.send(JSON.stringify({ action: 'line', orientation: 'h', row: 0, col: 0 }));
  ({ state } = await synchronized);
  assert.equal(state.board.horizontal[0][0], hostIdentity.playerId);
  assert.equal(state.turnId, identities[1].playerId);
});
