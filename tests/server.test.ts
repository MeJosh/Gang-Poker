import { afterAll, beforeAll, expect, test } from 'bun:test';
import type { Snapshot } from '../src/shared/types';
const port = 32000 + Math.floor(Math.random() * 10000);
const origin = `http://localhost:${port}`;
let process: ReturnType<typeof Bun.spawn>;
const sockets: WebSocket[] = [];
const TestWebSocket = WebSocket as unknown as new (url: string, options: Bun.WebSocketOptions) => WebSocket;
beforeAll(async () => {
  process = Bun.spawn(['bun', 'src/server/index.ts'], { env: { ...Bun.env, PORT: String(port), NODE_ENV: 'production' }, stdout: 'ignore', stderr: 'pipe' });
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(`${origin}/health`)).ok) return; } catch { /* Wait for startup. */ }
    await Bun.sleep(50);
  }
  process.kill();
  throw new Error(`Server did not start: ${await new Response(process.stderr as ReadableStream<Uint8Array>).text()}`);
});
afterAll(() => { sockets.forEach(ws => ws.close()); process?.kill(); });
function join(name: string, watch = false, token?: string) {
  return new Promise<{ ws: WebSocket; token: string; state: Snapshot }>((resolve, reject) => {
    const ws = new TestWebSocket(`ws://localhost:${port}/ws`, { headers: { Origin: origin } }); sockets.push(ws);
    let receivedToken = '';
    const timeout = setTimeout(() => reject(new Error('Join timed out')), 3000);
    ws.onopen = () => ws.send(JSON.stringify({ type: 'join', name, watch, token }));
    ws.onerror = () => { clearTimeout(timeout); reject(new Error('WebSocket failed')); };
    ws.onmessage = event => {
      const data = JSON.parse(String(event.data));
      if (data.type === 'welcome') receivedToken = data.token;
      if (data.type === 'state' && receivedToken) { clearTimeout(timeout); resolve({ ws, token: receivedToken, state: data.state }); }
    };
  });
}
test('serves production client and rejects foreign WebSocket origins', async () => {
  expect((await fetch(origin)).status).toBe(200);
  expect((await fetch(`${origin}/assets/main.js`)).headers.get('content-type')).toContain('javascript');
  expect((await fetch(`${origin}/ws`, { headers: { Origin: 'https://unrelated.example' } })).status).toBe(403);
  expect((await fetch(`${origin}/src/server/index.ts`)).status).toBe(404);
});
test('real sockets mask private cards and reclaim a seat without duplicating it', async () => {
  const a = await join('Alice'); const b = await join('Bob'); const spectator = await join('Watcher', true);
  expect(a.state.players[0].cards[0]).not.toBe('??');
  expect(b.state.players.find(p => p.name === 'Alice')!.cards).toEqual(['??', '??']);
  expect(spectator.state.players.every(p => p.cards[0] === '??')).toBe(true);
  const closed = new Promise<number>(resolve => a.ws.addEventListener('close', e => resolve(e.code), { once: true }));
  const restored = await join('Alice', false, a.token);
  expect(restored.state.selfId).toBe(a.state.selfId); expect(restored.state.players).toHaveLength(2); expect(await closed).toBe(4001);
  const acknowledgement = new Promise<any>(resolve => restored.ws.addEventListener('message', event => { const data = JSON.parse(String(event.data)); if (data.type === 'grab-result') resolve(data); }));
  restored.ws.send(JSON.stringify({ type: 'grab', chip: 1 })); expect((await acknowledgement).accepted).toBe(true);
});
