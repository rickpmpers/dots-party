import assert from 'node:assert/strict';
import { once } from 'node:events';
import { WebSocket } from 'ws';
import QRCode from 'qrcode';

const baseUrl = (process.argv[2] || 'https://mm-game.selfserved.ai').replace(/\/$/, '');
const wsUrl = baseUrl.replace(/^http/, 'ws');
const clients = [];

const nextEvent = (socket, event, timeoutMs = 10_000) => new Promise((resolve, reject) => {
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

const connect = async () => {
  const socket = new WebSocket(wsUrl, { origin: baseUrl });
  clients.push(socket);
  await once(socket, 'open');
  return socket;
};

const sendAndWait = (socket, payload, event) => {
  const pending = nextEvent(socket, event);
  socket.send(JSON.stringify(payload));
  return pending;
};

try {
  const page = await fetch(baseUrl);
  assert.equal(page.status, 200);
  assert.match(page.headers.get('content-security-policy'), /frame-ancestors 'none'/);

  const host = await connect();
  const hostIdentity = await sendAndWait(host, { action: 'create', name: 'Edge Host' }, 'identity');
  assert.match(hostIdentity.code, /^[A-HJ-NP-Z2-9]{6}$/);

  const qr = await fetch(`${baseUrl}/api/qr?room=${hostIdentity.code}`);
  assert.equal(qr.status, 200);
  const qrBody = await qr.text();
  const expectedQr = await QRCode.toString(`${baseUrl}/?room=${hostIdentity.code}`, {
    type: 'svg', margin: 1, color: { dark: '#14243b', light: '#ffffffff' },
  });
  assert.equal(qrBody, expectedQr);

  const identities = [hostIdentity];
  for (let number = 2; number <= 10; number++) {
    const socket = await connect();
    identities.push(await sendAndWait(socket, { action: 'join', code: hostIdentity.code, name: `Edge Player ${number}` }, 'identity'));
  }

  const extra = await connect();
  const full = await sendAndWait(extra, { action: 'join', code: hostIdentity.code, name: 'Edge Player 11' }, 'error');
  assert.match(full.message, /full \(10 players\)/);

  const started = nextEvent(clients[1], 'state');
  host.send(JSON.stringify({ action: 'start' }));
  let { state } = await started;
  assert.equal(state.status, 'playing');
  assert.equal(state.players.length, 10);

  const moved = nextEvent(clients[1], 'state');
  host.send(JSON.stringify({ action: 'line', orientation: 'h', row: 0, col: 0 }));
  ({ state } = await moved);
  assert.equal(state.board.horizontal[0][0], hostIdentity.playerId);
  assert.equal(state.turnId, identities[1].playerId);

  console.log(JSON.stringify({
    url: baseUrl,
    https: true,
    websocket: true,
    roomCode: hostIdentity.code,
    qrJoinUrl: `${baseUrl}/?room=${hostIdentity.code}`,
    synchronizedPlayers: state.players.length,
    capacityLimitVerified: true,
  }, null, 2));
} finally {
  for (const socket of clients) socket.close();
}
