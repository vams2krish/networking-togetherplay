import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { WebSocketServer, WebSocket } from 'ws';
import { validSource } from './sync.js';

const files = { '/': ['public/index.html', 'text/html'], '/app.js': ['public/app.js', 'text/javascript'], '/style.css': ['public/style.css', 'text/css'] };
const server = http.createServer(async (req, res) => {
  const file = files[new URL(req.url, 'http://localhost').pathname];
  if (!file) { res.writeHead(404); return res.end('Not found'); }
  try { res.writeHead(200, { 'Content-Type': file[1], 'X-Content-Type-Options': 'nosniff' }); res.end(await readFile(new URL(file[0], import.meta.url))); }
  catch { res.writeHead(500); res.end('Unable to load application'); }
});
const rooms = new Map();
const wss = new WebSocketServer({ server, maxPayload: 4096 });
function broadcast(room) {
  const data = JSON.stringify({ type: 'state', ...room.state, members: room.clients.size });
  for (const client of room.clients) if (client.readyState === WebSocket.OPEN) client.send(data);
}
wss.on('connection', (socket) => {
  let room;
  let count = 0, windowStart = Date.now();
  const fail = message => socket.send(JSON.stringify({ type: 'error', message }));
  socket.on('message', raw => {
    if (Date.now() - windowStart > 1000) { windowStart = Date.now(); count = 0; }
    if (++count > 30) return socket.close(1008, 'Too many messages');
    let msg; try { msg = JSON.parse(raw); } catch { return fail('Invalid message'); }
    if (!msg || typeof msg !== 'object') return;
    if (msg.type === 'ping') return socket.send(JSON.stringify({ type: 'pong', sent: msg.sent, server: Date.now() }));
    if (msg.type === 'join' && !room) {
      if (typeof msg.room !== 'string' || !/^[a-f0-9]{32}$/.test(msg.room)) return fail('Use a valid invitation link.');
      room = rooms.get(msg.room);
      if (room && room.clients.size >= 2) { room = undefined; return fail('This room already has two people.'); }
      if (!room) { room = { clients: new Set(), state: { source: '', playing: false, position: 0, updatedAt: Date.now(), revision: 0 } }; rooms.set(msg.room, room); }
      room.clients.add(socket); socket.roomId = msg.room; broadcast(room); return;
    }
    if (!room) return;
    const state = room.state;
    if (msg.type === 'source' && validSource(msg.source)) {
      room.state = { source: msg.source, playing: false, position: 0, updatedAt: Date.now(), revision: state.revision + 1 };
    } else if (msg.type === 'control' && typeof msg.playing === 'boolean' && Number.isFinite(msg.position) && msg.position >= 0 && msg.position <= 604800) {
      room.state = { ...state, playing: msg.playing, position: msg.position, updatedAt: Date.now(), revision: state.revision + 1 };
    } else if (msg.type === 'refresh') { /* Return the authoritative snapshot. */ }
    else return;
    broadcast(room);
  });
  socket.on('close', () => {
    if (!room) return;
    room.clients.delete(socket);
    if (!room.clients.size) rooms.delete(socket.roomId); else broadcast(room);
  });
  socket.on('error', () => {});
});
server.listen(process.env.PORT || 3000, () => console.log(`TogetherPlay listening on port ${server.address().port}`));
