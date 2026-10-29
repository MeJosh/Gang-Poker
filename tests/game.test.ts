import { describe, expect, test } from 'bun:test';
import { Game } from '../src/server/game';
import { areaFor, seatPoint } from '../src/shared/types';
function table(count = 3, max = 6) {
  const game = new Game(max);
  const ids = Array.from({ length: count }, (_, i) => game.join(`Player ${i + 1}`, null, false).member.id);
  return { game, ids };
}
function place(game: Game, mover: string, chip: number, owner: string, now = 100) {
  const player = game.players.find(p => p.id === owner)!;
  game.action(mover, { type: 'grab', chip }, now);
  game.action(mover, { type: 'move', chip, ...seatPoint(player.seat, game.players.length) }, now);
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
  test('joining pre-flop preserves cards and carries area chips, appends chip and clears readiness', () => {
    const { game, ids } = table();
    place(game, ids[0], 1, ids[0]); game.action(ids[0], { type: 'ready', value: true });
    const cards = [...game.players[0].cards]; const position = { ...game.chips[0] };
    game.join('Fourth', null, false);
    expect(game.players[0].cards).toEqual(cards); expect(game.chips[0]).toEqual(position);
    expect(game.chips.map(c => c.id)).toEqual([1, 2, 3, 4]); expect(game.players[0].readyChip).toBeNull();
  });
  test('joining rotates all chips in an area and leaves outside chips untouched', () => {
    const { game, ids } = table();
    const center = seatPoint(1, 3);
    Object.assign(game.chips[0], { x: center.x + .25, z: center.z - .2 });
    Object.assign(game.chips[1], { x: center.x - .3, z: center.z + .15 });
    const outside = { ...game.chips[2] };
    const before = game.chips.slice(0, 2).map(c => ({ ...c }));
    game.action(ids[0], { type: 'grab', chip: 1 });
    game.join('Fourth', null, false);
    before.forEach((chip, i) => {
      const angle = Math.PI / 2 - Math.PI * 2 / 3;
      expect(game.chips[i].x).toBeCloseTo(chip.x * Math.cos(angle) + chip.z * Math.sin(angle));
      expect(game.chips[i].z).toBeCloseTo(chip.z * Math.cos(angle) - chip.x * Math.sin(angle));
      expect(areaFor(game.chips[i], game.players)).toBe(ids[1]);
    });
    expect(game.chips[2]).toEqual(outside);
    expect(game.chips[0].holder).toBeNull(); expect(game.leases.size).toBe(0);
  });
  test('leaving pre-flop compacts seats, carries remaining area chips and permits rejoining', () => {
    const { game, ids } = table(4);
    place(game, ids[0], 1, ids[2]);
    place(game, ids[0], 2, ids[1]);
    const departedAreaChip = { ...game.chips[1] };
    const cards = [...game.players[2].cards];
    game.action(ids[1], { type: 'leave' });
    expect(game.players.map(p => p.seat)).toEqual([0, 1, 2]);
    expect(game.players[1].cards).toEqual(cards);
    expect(areaFor(game.chips[0], game.players)).toBe(ids[2]);
    expect(game.chips[1]).toEqual(departedAreaChip);
    expect(game.chips.map(c => c.id)).toEqual([1, 2, 3]);
    expect(game.snapshot(ids[1]).canSit).toBe(true);
    game.action(ids[1], { type: 'sit' });
    expect(game.players.map(p => p.seat)).toEqual([0, 1, 2, 3]);
    expect(game.chips.map(c => c.id)).toEqual([1, 2, 3, 4]);
  });
  test('leaving is blocked after pre-flop locks and empty tables can be seated again', () => {
    const { game, ids } = table(); rankAll(game, ids);
    game.action(ids[0], { type: 'leave' }); expect(game.players).toHaveLength(3);
    game.tick(1700); game.action(ids[0], { type: 'leave' }); expect(game.players).toHaveLength(3);
    const solo = table(1);
    solo.game.action(solo.ids[0], { type: 'leave' });
    expect(solo.game.players).toHaveLength(0); expect(solo.game.chips).toHaveLength(0);
    solo.game.action(solo.ids[0], { type: 'sit' });
    expect(solo.game.players[0].seat).toBe(0); expect(solo.game.chips).toHaveLength(1);
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

describe('debug readiness', () => {
  test('is disabled by default, even for forged actions', () => {
    const { game, ids } = table(); place(game, ids[0], 1, ids[1]);
    game.action(ids[0], { type: 'debug-ready', player: ids[1] });
    expect(game.players[1].readyChip).toBeNull(); expect(game.snapshot(ids[0]).debugReady).toBe(false);
  });
  test('allows connected members to toggle another player while preserving chip rules', () => {
    const game = new Game(6, true);
    const ids = Array.from({ length: 3 }, (_, i) => game.join(`Player ${i}`, null, false).member.id);
    const watcher = game.join('Debug watcher', null, true).member.id;
    expect(game.snapshot(watcher).debugReady).toBe(true);
    game.action(watcher, { type: 'debug-ready', player: ids[1] });
    expect(game.players[1].readyChip).toBeNull();
    place(game, ids[0], 1, ids[1]);
    game.action('unknown', { type: 'debug-ready', player: ids[1] });
    expect(game.players[1].readyChip).toBeNull();
    game.action(watcher, { type: 'debug-ready', player: ids[1] });
    expect(game.players[1].readyChip).toBe(1);
    game.action(watcher, { type: 'debug-ready', player: ids[1] });
    expect(game.players[1].readyChip).toBeNull();
    place(game, ids[0], 2, ids[1]);
    game.action(watcher, { type: 'debug-ready', player: ids[1] });
    expect(game.players[1].readyChip).toBeNull();
    ids.forEach((id, i) => place(game, ids[0], i + 1, id));
    ids.forEach(id => game.action(watcher, { type: 'debug-ready', player: id }, 100));
    expect(game.phase).toBe('transition');
    game.action(watcher, { type: 'debug-ready', player: ids[0] });
    expect(game.players[0].readyChip).toBeNull();
  });
});

test('debug reset is gated and restarts during a transition without changing seats', () => {
  const { game, ids } = table(); rankAll(game, ids, 100);
  const revision = game.revision;
  game.action(ids[0], { type: 'debug-reset' });
  expect(game.phase).toBe('transition'); expect(game.revision).toBe(revision);
  game.debugReady = true;
  const spectator = game.join('Debugger', null, true).member.id;
  game.action('unknown', { type: 'debug-reset' }); expect(game.phase).toBe('transition');
  game.action(spectator, { type: 'debug-reset' });
  expect(game.phase).toBe('playing'); expect(game.stage).toBe(0); expect(game.board).toEqual([]);
  expect(game.players.map(p => p.id)).toEqual(ids);
  expect(game.players.every(p => p.readyChip === null && p.history.length === 0)).toBe(true);
  expect(new Set(game.players.flatMap(p => p.cards)).size).toBe(6);
  expect(game.chips.map(c => c.id)).toEqual([1, 2, 3]); expect(game.leases.size).toBe(0);
  game.tick(10000); expect(game.stage).toBe(0); expect(game.canSit()).toBe(true);
  game.action(ids[0], { type: 'grab', chip: 1 });
  game.action(spectator, { type: 'debug-reset' });
  expect(game.chips.every(chip => chip.holder === null)).toBe(true); expect(game.leases.size).toBe(0);
});
