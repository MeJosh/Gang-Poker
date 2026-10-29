import { Game } from './game';
import type { Action } from '../shared/types';
import type { ServerWebSocket } from 'bun';
import { resolve } from 'node:path';

const game = new Game(Number(process.env.MAX_PLAYERS ?? 6));
const connections = new Map<string, ServerWebSocket<Connection>>();
interface Connection { id: string | null; lastSeen: number; windowAt: number; count: number }
const publicDir = resolve(import.meta.dir, '../../public');
if (process.env.NODE_ENV !== 'production') {
  const result = await Bun.build({ entrypoints: [resolve(import.meta.dir, '../client/main.ts')], outdir: resolve(publicDir, 'assets'), target: 'browser', sourcemap: 'linked' });
  if (!result.success) throw new Error(result.logs.join('\n'));
}
function validAction(value: unknown): value is Action {
  if (!value || typeof value !== 'object') return false;
  const a = value as Record<string, unknown>;
  if (a.type === 'again' || a.type === 'sit') return true;
  if (a.type === 'ready') return typeof a.value === 'boolean';
  if (!Number.isInteger(a.chip) || Number(a.chip) < 1 || Number(a.chip) > game.maxPlayers) return false;
  if (a.type === 'grab' || a.type === 'release') return true;
  return a.type === 'move' && typeof a.x === 'number' && Number.isFinite(a.x) && typeof a.z === 'number' && Number.isFinite(a.z);
}
const server = Bun.serve<Connection>({
  hostname: '0.0.0.0', port: Number(process.env.PORT ?? 3000),
  fetch(request, server) {
    const url = new URL(request.url);
    if (url.pathname === '/ws') {
      const origin = request.headers.get('origin');
      if (!origin || origin !== (process.env.PUBLIC_ORIGIN ?? url.origin)) return new Response('Origin rejected', { status: 403 });
      if (server.pendingWebSockets >= 200) return new Response('Table is full', { status: 503 });
      if (server.upgrade(request, { data: { id: null, lastSeen: Date.now(), windowAt: Date.now(), count: 0 } })) return;
      return new Response('WebSocket upgrade required', { status: 400 });
    }
    if (url.pathname === '/health') return Response.json({ ok: true });
    if (request.method !== 'GET' && request.method !== 'HEAD') return new Response('Method not allowed', { status: 405 });
    const paths: Record<string, string> = { '/': 'index.html', '/style.css': 'style.css', '/assets/main.js': 'assets/main.js', '/assets/main.js.map': 'assets/main.js.map' };
    const file = paths[url.pathname];
    if (!file) return new Response('Not found', { status: 404 });
    return new Response(Bun.file(resolve(publicDir, file)), { headers: {
      'Cache-Control': file.endsWith('.html') ? 'no-store' : 'no-cache',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
    } });
  },
  websocket: {
    maxPayloadLength: 2048,
    open(ws) { setTimeout(() => { if (!ws.data.id) ws.close(1008, 'Join required'); }, 10000); },
    message(ws, message) {
      const now = Date.now(); ws.data.lastSeen = now;
      if (now - ws.data.windowAt > 1000) { ws.data.windowAt = now; ws.data.count = 0; }
      if (++ws.data.count > 120) { ws.close(1008, 'Too many messages'); return; }
      let value: any;
      try { value = JSON.parse(String(message)); } catch { return; }
      if (!value || typeof value !== 'object') return;
      if (!ws.data.id) {
        if (value.type !== 'join' || typeof value.name !== 'string') return;
        const name = value.name.trim().replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 24);
        if (!name) return;
        const { member, restored } = game.join(name, typeof value.token === 'string' ? value.token : null, value.watch === true);
        const previous = connections.get(member.id);
        ws.data.id = member.id; connections.set(member.id, ws);
        previous?.close(4001, 'Seat opened in another tab');
        ws.send(JSON.stringify({ type: 'welcome', token: member.token, restored }));
        ws.send(JSON.stringify({ type: 'state', state: game.snapshot(member.id) }));
        return;
      }
      if (value.type === 'ping') { ws.send(JSON.stringify({ type: 'pong' })); return; }
      if (validAction(value)) {
        game.action(ws.data.id, value, now);
        if (value.type === 'grab') ws.send(JSON.stringify({ type: 'grab-result', chip: value.chip, accepted: game.chips.some(c => c.id === value.chip && c.holder === ws.data.id) }));
      }
    },
    close(ws) {
      if (ws.data.id && connections.get(ws.data.id) === ws) { connections.delete(ws.data.id); game.disconnect(ws.data.id); }
    },
  },
});
let sentRevision = -1;
setInterval(() => {
  const now = Date.now(); game.tick(now);
  for (const ws of connections.values()) if (now - ws.data.lastSeen > 15000) ws.close(1001, 'Connection timed out');
  if (sentRevision === game.revision) return;
  sentRevision = game.revision;
  for (const [id, ws] of connections) ws.send(JSON.stringify({ type: 'state', state: game.snapshot(id) }));
}, 33);
console.log(`Gang Poker is ready at http://localhost:${server.port}`);
