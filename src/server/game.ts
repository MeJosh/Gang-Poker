import { randomBytes } from 'node:crypto';
import { areaFor, type Action, type Card, type Chip, type Phase, type Player, type Snapshot } from '../shared/types';
interface Member { id: string; token: string; name: string; connected: boolean }
export class Game {
  members = new Map<string, Member>();
  players: Player[] = [];
  chips: Chip[] = [];
  deck: Card[] = [];
  board: Card[] = [];
  stage = 0;
  phase: Phase = 'playing';
  revision = 0;
  transitionAt = 0;
  leases = new Map<number, number>();
  constructor(public maxPlayers = 6) {
    if (!Number.isInteger(maxPlayers) || maxPlayers < 3 || maxPlayers > 10) throw new Error('MAX_PLAYERS must be an integer from 3 to 10');
    this.shuffle();
  }
  shuffle() {
    this.deck = [...'23456789TJQKA'].flatMap(rank => [...'cdhs'].map(suit => rank + suit));
    for (let i = this.deck.length - 1; i > 0; i--) {
      const j = crypto.getRandomValues(new Uint32Array(1))[0];
      // Rejection sampling avoids modulo bias.
      const limit = Math.floor(2 ** 32 / (i + 1)) * (i + 1);
      if (j >= limit) { i++; continue; }
      const k = j % (i + 1);
      [this.deck[i], this.deck[k]] = [this.deck[k], this.deck[i]];
    }
  }
  join(name: string, token: string | null, watch: boolean): { member: Member; restored: boolean } {
    if (token) {
      const existing = [...this.members.values()].find(member => member.token === token);
      if (existing) {
        existing.connected = true;
        const player = this.players.find(p => p.id === existing.id);
        if (player) player.connected = true;
        this.revision++;
        return { member: existing, restored: true };
      }
    }
    const member: Member = { id: crypto.randomUUID(), token: randomBytes(32).toString('hex'), name, connected: true };
    this.members.set(member.id, member);
    if (!watch) this.sit(member.id);
    this.revision++;
    return { member, restored: false };
  }
  canSit() { return this.phase === 'playing' && this.stage === 0 && this.players.length < this.maxPlayers; }
  sit(id: string) {
    const member = this.members.get(id);
    if (!member || !member.connected || !this.canSit() || this.players.some(p => p.id === id)) return;
    const previous = this.players.map(p => ({ ...p }));
    const seat = this.players.length;
    this.players.push({ id, name: member.name, seat, connected: true, readyChip: null, cards: [this.deck.pop()!, this.deck.pop()!], history: [] });
    this.reseat(previous);
    const count = this.players.length;
    const angle = (count - 1) * 2.4;
    this.chips.push({ id: count, x: Math.sin(angle) * 1.65, z: Math.cos(angle) * 1.65, holder: null });
  }
  // Classify chips against the old layout before moving any seat or chip.
  reseat(previous: Pick<Player, 'id' | 'seat'>[]) {
    const owners = this.chips.map(chip => areaFor(chip, previous));
    this.players.forEach((player, seat) => { player.seat = seat; player.readyChip = null; });
    this.chips.forEach((chip, index) => {
      const before = previous.find(p => p.id === owners[index]);
      const after = this.players.find(p => p.id === owners[index]);
      if (before && after) {
        const angle = after.seat * Math.PI * 2 / this.players.length - before.seat * Math.PI * 2 / previous.length;
        const { x, z } = chip;
        chip.x = x * Math.cos(angle) + z * Math.sin(angle);
        chip.z = z * Math.cos(angle) - x * Math.sin(angle);
      }
      // End drags so a stale pointer cannot undo the layout change.
      chip.holder = null;
    });
    this.leases.clear();
  }
  leave(id: string) {
    if (this.phase !== 'playing' || this.stage !== 0) return;
    const player = this.players.find(p => p.id === id);
    if (!player) return;
    const previous = this.players.map(p => ({ ...p }));
    this.players = this.players.filter(p => p.id !== id);
    this.deck.unshift(...player.cards);
    this.reseat(previous);
    // Keep ranks contiguous: a table of N players has chips 1 through N.
    this.chips = this.chips.filter(chip => chip.id <= this.players.length);
  }
  disconnect(id: string) {
    const member = this.members.get(id);
    if (!member) return;
    member.connected = false;
    const player = this.players.find(p => p.id === id);
    if (player) { player.connected = false; player.readyChip = null; }
    for (const chip of this.chips) if (chip.holder === id) { chip.holder = null; this.leases.delete(chip.id); }
    if (!player) this.members.delete(id);
    this.revision++;
  }
  invalidateReady() {
    for (const player of this.players) {
      const chips = this.chips.filter(c => areaFor(c, this.players) === player.id);
      if (chips.length !== 1 || chips[0].id !== player.readyChip) player.readyChip = null;
    }
  }
  action(id: string, action: Action, now = Date.now()) {
    if (action.type === 'leave') { this.leave(id); this.revision++; return; }
    if (action.type === 'sit') { this.sit(id); this.revision++; return; }
    const player = this.players.find(p => p.id === id);
    if (!player || !player.connected) return;
    if (action.type === 'again') {
      if (this.phase !== 'reveal') return;
      this.stage = 0; this.phase = 'playing'; this.board = []; this.shuffle(); this.leases.clear();
      for (const p of this.players) { p.cards = [this.deck.pop()!, this.deck.pop()!]; p.history = []; p.readyChip = null; }
      this.freshChips(); this.revision++; return;
    }
    if (this.phase !== 'playing') return;
    const chip = 'chip' in action ? this.chips.find(c => c.id === action.chip) : undefined;
    if (action.type === 'grab' && chip && chip.holder === null && !this.chips.some(c => c.holder === id)) {
      chip.holder = id; this.leases.set(chip.id, now + 8000);
    } else if (action.type === 'move' && chip?.holder === id) {
      if (!Number.isFinite(action.x) || !Number.isFinite(action.z)) return;
      const length = Math.hypot(action.x, action.z);
      const scale = length > 5.6 ? 5.6 / length : 1;
      chip.x = action.x * scale; chip.z = action.z * scale;
      this.leases.set(chip.id, now + 8000);
    } else if (action.type === 'release' && chip?.holder === id) {
      chip.holder = null; this.leases.delete(chip.id);
    } else if (action.type === 'ready') {
      const owned = this.chips.filter(c => areaFor(c, this.players) === id);
      player.readyChip = action.value && owned.length === 1 ? owned[0].id : null;
    } else return;
    this.invalidateReady(); this.maybeAdvance(now); this.revision++;
  }
  maybeAdvance(now: number) {
    if (this.phase !== 'playing' || this.players.length < 3 || this.chips.some(c => c.holder)) return;
    if (!this.players.every(p => p.connected && p.readyChip !== null)) return;
    for (const p of this.players) { p.history.push(p.readyChip!); p.readyChip = null; }
    this.phase = 'transition'; this.transitionAt = now + 1600;
  }
  freshChips() {
    this.chips = this.players.map((_, i) => ({ id: i + 1, x: Math.sin(i * Math.PI * 2 / this.players.length) * 1.65, z: Math.cos(i * Math.PI * 2 / this.players.length) * 1.65, holder: null }));
  }
  tick(now = Date.now()) {
    for (const chip of this.chips) {
      if (chip.holder && (this.leases.get(chip.id) ?? 0) <= now) {
        chip.holder = null; this.leases.delete(chip.id); this.revision++;
      }
    }
    if (this.phase === 'transition' && now >= this.transitionAt) {
      if (this.stage === 3) { this.phase = 'reveal'; this.chips = []; }
      else {
        this.stage++;
        this.deck.pop(); // Burn one card before each community deal.
        const count = this.stage === 1 ? 3 : 1;
        for (let i = 0; i < count; i++) this.board.push(this.deck.pop()!);
        this.freshChips(); this.phase = 'playing';
      }
      this.revision++;
    } else if (this.phase === 'playing') {
      const before = this.phase; this.maybeAdvance(now);
      if (this.phase !== before) this.revision++;
    }
  }
  snapshot(id: string): Snapshot {
    return {
      revision: this.revision, stage: this.stage, phase: this.phase, maxPlayers: this.maxPlayers,
      players: this.players.map(p => ({ ...p, cards: p.id === id || this.phase === 'reveal' ? [...p.cards] : ['??', '??'], history: [...p.history] })),
      chips: this.chips.map(c => ({ ...c })), board: [...this.board],
      spectators: [...this.members.values()].filter(m => m.connected && !this.players.some(p => p.id === m.id)).length,
      selfId: id, canSit: this.canSit() && !this.players.some(p => p.id === id),
    };
  }
}
