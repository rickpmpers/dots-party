import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { randomBytes, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { WebSocketServer, WebSocket } from 'ws';
import QRCode from 'qrcode';
import { newBoard, playLine, publicState, MAX_PLAYERS } from './game.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3000);
const PUBLIC_ORIGIN = (process.env.PUBLIC_ORIGIN || '').replace(/\/$/, '');
const ALLOWED_ORIGINS = new Set((process.env.ALLOWED_ORIGINS || PUBLIC_ORIGIN).split(',').map(value => value.trim()).filter(Boolean));
const TRUST_PROXY = process.env.TRUST_PROXY === '1';
const MAX_ROOMS = Number(process.env.MAX_ROOMS || 1000);
const rooms = new Map();
const creationWindows = new Map();
const palette = ['#ec777d','#7da7f5','#f6b552','#7acbad','#b693ed','#ee91c4','#78cfd8','#d1c46b','#9ca8bd','#f18c66'];
const allowedFiles = {'/':'index.html','/index.html':'index.html','/app.js':'app.js','/styles.css':'styles.css'};
const mime = { '.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8' };

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (!['GET', 'HEAD'].includes(req.method)) return respond(res, 405, 'Method not allowed', 'text/plain');
    if (url.pathname === '/health') return respond(res, 200, 'ok', 'text/plain');
    if (url.pathname === '/api/qr') {
      const room = (url.searchParams.get('room') || '').toUpperCase();
      if (!/^[A-HJ-NP-Z2-9]{6}$/.test(room)) return respond(res, 400, 'Invalid room code', 'text/plain');
      // Use the browser's public origin when provided. Accept only a valid http(s) origin.
      const supplied = url.searchParams.get('origin');
      const candidate = supplied && /^https?:\/\/[\w.\-:\[\]]+$/.test(supplied) ? supplied : '';
      const origin = PUBLIC_ORIGIN || (candidate && (ALLOWED_ORIGINS.size === 0 || ALLOWED_ORIGINS.has(candidate))
        ? candidate : `${req.headers['x-forwarded-proto'] === 'https' ? 'https' : 'http'}://${req.headers.host}`);
      const svg = await QRCode.toString(`${origin}/?room=${room}`, { type:'svg', margin:1, color:{dark:'#14243b',light:'#ffffffff'} });
      return respond(res, 200, svg, 'image/svg+xml');
    }
    const fileName = allowedFiles[url.pathname];
    if (!fileName) return respond(res, 404, 'Not found', 'text/plain');
    const file = await readFile(path.join(__dirname, 'public', fileName));
    respond(res, 200, file, mime[path.extname(fileName)]);
  } catch (e) {
    console.error(e); respond(res, 500, 'Server error', 'text/plain');
  }
});
function respond(res, status, body, contentType) {
  res.writeHead(status, {
    'Content-Type': contentType,
    'Cache-Control':'no-store',
    'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self' ws: wss:; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
    'Cross-Origin-Opener-Policy':'same-origin',
    'Permissions-Policy':'camera=(), microphone=(), geolocation=()',
    'Referrer-Policy':'no-referrer',
    'X-Content-Type-Options':'nosniff',
    'X-Frame-Options':'DENY',
  });
  res.end(body);
}
const clientIp = req => TRUST_PROXY ? String(req.headers['cf-connecting-ip'] || req.socket.remoteAddress || '') : String(req.socket.remoteAddress || '');
const originAllowed = origin => ALLOWED_ORIGINS.size === 0 || ALLOWED_ORIGINS.has(origin);
const wss = new WebSocketServer({
  server,
  maxPayload: 2048,
  perMessageDeflate: false,
  verifyClient: ({ origin, req }, done) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname !== '/') return done(false, 404, 'Not found');
    if (!originAllowed(origin)) return done(false, 403, 'Origin not allowed');
    done(true);
  },
});
const send = (socket, event, data={}) => { if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ event, ...data })); };
const notify = room => { room.updatedAt = Date.now(); const state = publicState(room); for (const socket of room.sockets) send(socket, 'state', {state}); };
const createCode = () => { const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; let code; do { code = Array.from(randomBytes(6), b=>alphabet[b%alphabet.length]).join(''); } while(rooms.has(code)); return code; };
const safeName = value => typeof value === 'string' ? value.trim().slice(0, 18).replace(/[<>]/g,'') : '';
const nextPlayer = (room, previousId) => {
  const i = room.players.findIndex(p => p.id === previousId);
  for (let step = 1; step <= room.players.length; step++) {
    const player = room.players[(i + step) % room.players.length];
    if (player.connected) return player.id;
  }
  return null;
};
const ownSocket = (room, playerId) => [...room.sockets].find(ws => ws.playerId === playerId);
const fail = (socket, reason) => send(socket, 'error', { message:reason });

wss.on('connection', (socket, req) => {
  socket.isAlive = true;
  socket.ip = clientIp(req);
  socket.messageWindow = { startedAt: Date.now(), count: 0 };
  socket.on('pong', () => { socket.isAlive = true; });
  socket.on('message', raw => {
    const now = Date.now();
    if (now - socket.messageWindow.startedAt > 10_000) socket.messageWindow = { startedAt: now, count: 0 };
    if (++socket.messageWindow.count > 80) return socket.close(1008, 'Message rate exceeded');
    let data;
    try { data = JSON.parse(String(raw)); } catch { return fail(socket, 'Invalid message.'); }
    if (!data || typeof data !== 'object') return;
    if (data.action === 'create') {
      if (socket.roomCode) return fail(socket, 'Already in a room.');
      if (rooms.size >= MAX_ROOMS) return fail(socket, 'Room capacity reached. Try again later.');
      const creationWindow = creationWindows.get(socket.ip) || { startedAt: now, count: 0 };
      if (now - creationWindow.startedAt > 10 * 60_000) { creationWindow.startedAt = now; creationWindow.count = 0; }
      if (++creationWindow.count > 10) return fail(socket, 'Too many rooms created. Try again later.');
      creationWindows.set(socket.ip, creationWindow);
      const name = safeName(data.name);
      if (!name) return fail(socket, 'Enter your name.');
      const code = createCode(), token = randomBytes(24).toString('hex'), id = randomUUID();
      const player = { id, token, name, color:palette[0], connected:true, score:0 };
      const room = { code, hostId:id, players:[player], board:newBoard(), turnId:null, status:'lobby', winnerIds:[], sockets:new Set([socket]), updatedAt:Date.now(), message:'' };
      rooms.set(code, room);
      socket.roomCode = code; socket.playerId = id;
      send(socket, 'identity', { code, token, playerId:id }); notify(room); return;
    }
    if (data.action === 'join') {
      if (socket.roomCode) return fail(socket, 'Already in a room.');
      const code = String(data.code || '').trim().toUpperCase();
      const room = rooms.get(code);
      if (!room) return fail(socket, 'Room not found. Check the 6-character code.');
      const existing = room.players.find(p => p.token === data.token && typeof data.token === 'string');
      let player, token;
      if (existing) {
        player = existing; token = player.token;
        const old = ownSocket(room, player.id);
        if (old) { room.sockets.delete(old); old.roomCode = null; old.playerId = null; old.close(4001, 'Reconnected elsewhere'); }
        player.connected = true;
      } else {
        if (room.status !== 'lobby') return fail(socket, 'The match is already running.');
        if (room.players.length >= MAX_PLAYERS) return fail(socket, 'The room is full (10 players).');
        const name = safeName(data.name);
        if (!name) return fail(socket, 'Enter your name.');
        token = randomBytes(24).toString('hex');
        player = { id:randomUUID(), token, name, color:palette[room.players.length], connected:true, score:0 };
        room.players.push(player);
      }
      socket.roomCode = code; socket.playerId = player.id; room.sockets.add(socket);
      send(socket, 'identity', { code, token, playerId:player.id }); notify(room); return;
    }
    const room = rooms.get(socket.roomCode);
    if (!room || !room.players.some(p => p.id === socket.playerId)) return fail(socket, 'Join a room first.');
    if (data.action === 'start') {
      if (room.hostId !== socket.playerId) return fail(socket, 'Only the host can start.');
      if (!['lobby','finished'].includes(room.status)) return fail(socket, 'The match has already started.');
      if (room.players.filter(p=>p.connected).length < 2) return fail(socket, 'At least two connected players are needed.');
      // Remove players who did not return before starting a fresh match.
      room.players = room.players.filter(p=>p.connected);
      room.players.forEach((p,idx) => { p.score=0; p.color=palette[idx]; });
      room.board = newBoard(); room.status='playing'; room.turnId=room.players[0].id; room.winnerIds=[]; room.message='';
      notify(room); return;
    }
    if (data.action === 'line') {
      if (room.status !== 'playing') return fail(socket, 'The match has not started.');
      if (room.turnId !== socket.playerId) return fail(socket, 'Wait for your turn.');
      const result = playLine(room.board, data.orientation, data.row, data.col, socket.playerId);
      if (result.error) return fail(socket, result.error);
      const player = room.players.find(p=>p.id===socket.playerId);
      player.score += result.claimed.length;
      if (result.complete) {
        room.status='finished'; room.turnId=null;
        const best=Math.max(...room.players.map(p=>p.score));
        room.winnerIds=room.players.filter(p=>p.score===best).map(p=>p.id);
      } else if (result.claimed.length === 0) room.turnId = nextPlayer(room, socket.playerId);
      notify(room); return;
    }
    if (data.action === 'leave') socket.close(1000, 'Left room');
  });
  socket.on('close', () => {
    const room = rooms.get(socket.roomCode);
    if (!room) return;
    room.sockets.delete(socket);
    const player=room.players.find(p=>p.id===socket.playerId);
    if (player) player.connected=false;
    if (room.status==='playing' && room.turnId===socket.playerId) room.turnId=nextPlayer(room, socket.playerId);
    if (room.players.every(p=>!p.connected)) room.updatedAt=Date.now();
    notify(room);
  });
  socket.on('error', err => console.error('Socket error',err.message));
});

// Remove abandoned rooms after 6 hours; restart resets in-memory rooms.
const cleanup=setInterval(()=>{const now=Date.now(); for(const [code,room] of rooms) if(now-room.updatedAt>6*3600_000 && room.sockets.size===0) rooms.delete(code);}, 60_000);
cleanup.unref();
const heartbeat=setInterval(()=>{for(const socket of wss.clients){if(socket.isAlive===false){socket.terminate();continue;}socket.isAlive=false;socket.ping();}}, 30_000);
heartbeat.unref();
const shutdown = () => {
  clearInterval(cleanup); clearInterval(heartbeat);
  for (const socket of wss.clients) socket.close(1001, 'Server restarting');
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10_000).unref();
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
server.listen(PORT, '0.0.0.0', ()=>console.log(`Dots Party at http://localhost:${PORT}`));
