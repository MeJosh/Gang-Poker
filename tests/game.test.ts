import { describe, expect, test } from 'bun:test';
import { Game } from '../src/server/game';
import { seatPoint } from '../src/shared/types';
function table(count = 3, max = 6) {
  const game = new Game(max);
  const ids = Array.from({ length: count }, (_, i) => game.join(`Player ${i + 1}`, null, false).member.id);
  return { game, ids };
}
function place(game: Game, mover: string, chip: number, owner: string, now = 100) {
  const player = game.players.find(p => p.id === owner)!;
  game.action(mover, { type: 'grab', chip }, now);
  game.action(mover, { type: 'move', chip, ...seatPoint(player.seat, game.maxPlayers) }, now);
  game.action(mover, { type: 'release', chip }, now);
}
function rankAll(game: Game, ids: string[], now = 100) {
  ids.forEach((id, i) => place(game, id, i + 1, id, now));
  ids.forEach(id => game.action(id, { type: 'ready', value: true }, now));
}
describe('cooperative game rules', () => {
  test('deals unique private cards, masks other hands and spectators, and restores by token', () => {
    const { game, ids } = table();
    const spectator = game.join('Watcher', null, true).member;
    const own = game.snapshot(ids[0]);
    expect(own.players[0].cards).not.toEqual(['??', '??']);
    expect(own.players[1].cards).toEqual(['??', '??']);
    expect(game.snapshot(spectator.id).players.every(p => p.cards[0] === '??')).toBe(true);
    expect(new Set(game.players.flatMap(p => p.cards)).size).toBe(6);
    const member = game.members.get(ids[0])!;
    game.disconnect(ids[0]);
    expect(game.join('Different name', member.token, false).member.id).toBe(ids[0]);
    expect(game.players).toHaveLength(3);
  });
  test('joining pre-flop preserves cards and positions, appends chip and clears readiness', () => {
    const { game, ids } = table();
    place(game, ids[0], 1, ids[0]); game.action(ids[0], { type: 'ready', value: true });
    const cards = [...game.players[0].cards]; const position = { ...game.chips[0] };
    game.join('Fourth', null, false);
    expect(game.players[0].cards).toEqual(cards); expect(game.chips[0]).toEqual(position);
    expect(game.chips.map(c => c.id)).toEqual([1, 2, 3, 4]); expect(game.players[0].readyChip).toBeNull();
  });
  test('capacity is configurable and extra players become spectators', () => {
    const { game } = table(4, 3); expect(game.players).toHaveLength(3); expect(game.members.size).toBe(4);
    expect(() => new Game(2)).toThrow(); expect(() => new Game(11)).toThrow();
  });
  test('requires at least three players', () => {
    const { game, ids } = table(2); rankAll(game, ids); expect(game.phase).toBe('playing');
  });
  test('only one player controls a chip and cannot hold a second chip', () => {
    const { game, ids } = table();
    game.action(ids[0], { type: 'grab', chip: 1 }); game.action(ids[1], { type: 'grab', chip: 1 });
    game.action(ids[0], { type: 'grab', chip: 2 });
    game.action(ids[1], { type: 'move', chip: 1, x: 0, z: 0 });
    expect(game.chips[0].holder).toBe(ids[0]); expect(game.chips[1].holder).toBeNull(); expect(game.chips[0].z).toBe(1.65);
  });
  test('any player can place chips in another area; boundary crossing clears ready mid-drag', () => {
    const { game, ids } = table();
    place(game, ids[1], 1, ids[0]); game.action(ids[0], { type: 'ready', value: true });
    expect(game.players[0].readyChip).toBe(1);
    game.action(ids[2], { type: 'grab', chip: 1 });
    expect(game.players[0].readyChip).toBe(1);
    game.action(ids[2], { type: 'move', chip: 1, x: 0, z: 0 });
    expect(game.players[0].readyChip).toBeNull();
  });
  test('additional chip and replacement invalidate confirmation; removing extra does not restore it', () => {
    const { game, ids } = table(); place(game, ids[0], 1, ids[0]); game.action(ids[0], { type: 'ready', value: true });
    place(game, ids[1], 2, ids[0]); expect(game.players[0].readyChip).toBeNull();
    place(game, ids[1], 1, ids[1]); expect(game.players[0].readyChip).toBeNull();
    game.action(ids[0], { type: 'ready', value: true }); expect(game.players[0].readyChip).toBe(2);
  });
  test('ready can be withdrawn without moving the chip', () => {
    const { game, ids } = table(); place(game, ids[0], 1, ids[0]); game.action(ids[0], { type: 'ready', value: true });
    game.action(ids[0], { type: 'ready', value: false }); expect(game.players[0].readyChip).toBeNull();
  });
  test('all-ready waits for release and locks fixed seats', () => {
    const { game, ids } = table(); ids.forEach((id, i) => place(game, id, i + 1, id));
    game.action(ids[0], { type: 'grab', chip: 1 }, 100);
    ids.forEach(id => game.action(id, { type: 'ready', value: true }, 100));
    expect(game.phase).toBe('playing'); game.action(ids[0], { type: 'release', chip: 1 }, 100);
    expect(game.phase).toBe('transition'); expect(game.players.map(p => p.history)).toEqual([[1], [2], [3]]);
    game.join('Late', null, false); expect(game.players).toHaveLength(3);
  });
  test('plays all four stages, reveals hands only at the end, then restarts', () => {
    const { game, ids } = table(); const spectator = game.join('Watcher', null, true).member.id;
    for (let stage = 0; stage < 4; stage++) {
      expect(game.stage).toBe(stage); expect(game.board.length).toBe([0, 3, 4, 5][stage]);
      expect(game.snapshot(spectator).players[0].cards).toEqual(['??', '??']);
      rankAll(game, ids, stage * 2000); expect(game.phase).toBe('transition');
      game.tick(stage * 2000 + 1600);
    }
    expect(game.phase).toBe('reveal'); expect(game.players[0].history).toEqual([1, 1, 1, 1]);
    expect(game.snapshot(spectator).players[0].cards).not.toEqual(['??', '??']);
    expect(new Set([...game.board, ...game.players.flatMap(p => p.cards)]).size).toBe(11);
    game.action(ids[0], { type: 'again' });
    expect(game.stage).toBe(0); expect(game.board).toEqual([]); expect(game.players[0].history).toEqual([]);
    expect(game.snapshot(spectator).players[0].cards).toEqual(['??', '??']); expect(game.canSit()).toBe(true);
  });
  test('disconnect releases drag, clears ready, preserves cards and blocks advance', () => {
    const { game, ids } = table(); place(game, ids[0], 1, ids[0]);
    game.action(ids[0], { type: 'ready', value: true }); game.action(ids[0], { type: 'grab', chip: 1 });
    const cards = [...game.players[0].cards]; game.disconnect(ids[0]);
    expect(game.chips[0].holder).toBeNull(); expect(game.players[0].readyChip).toBeNull(); expect(game.players[0].cards).toEqual(cards);
    rankAll(game, ids); expect(game.phase).toBe('playing');
  });
  test('stale drag lease expires without a permanent lock', () => {
    const { game, ids } = table(); game.action(ids[0], { type: 'grab', chip: 1 }, 0);
    game.tick(7999); expect(game.chips[0].holder).toBe(ids[0]);
    game.tick(8000); expect(game.chips[0].holder).toBeNull();
  });
  test('rejects spectator manipulation, non-finite positions, and clamps table bounds', () => {
    const { game, ids } = table(); const spectator = game.join('Watch', null, true).member.id;
    game.action(spectator, { type: 'grab', chip: 1 }); expect(game.chips[0].holder).toBeNull();
    game.action(ids[0], { type: 'grab', chip: 1 }); game.action(ids[0], { type: 'move', chip: 1, x: NaN, z: 4 }); expect(game.chips[0].x).toBe(0);
    game.action(ids[0], { type: 'move', chip: 1, x: 1e9, z: 1e9 }); expect(Math.hypot(game.chips[0].x, game.chips[0].z)).toBeCloseTo(5.6);
  });
});
