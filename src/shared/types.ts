export const STAGES = ['Pre-flop', 'Flop', 'Turn', 'River'] as const;
export const STAGE_COLORS = ['#f5f3eb', '#f4d35e', '#f29b50', '#eb6b6b'];
export const SEAT_COLORS = ['#ffad72', '#84d3ff', '#cf9bff', '#a5df80', '#ff8caa', '#ffe38a', '#74dbc6', '#d6c3a0', '#a4b9ed', '#ecb9db'];
export type Card = string;
export type Phase = 'playing' | 'transition' | 'reveal';
export interface Point { x: number; z: number }
export interface Chip extends Point { id: number; holder: string | null }
export interface Player {
  id: string; name: string; seat: number; connected: boolean;
  readyChip: number | null; cards: Card[]; history: number[];
}
export interface Snapshot {
  revision: number; stage: number; phase: Phase; maxPlayers: number;
  players: Player[]; chips: Chip[]; board: Card[]; spectators: number;
  selfId: string; canSit: boolean; debugReady: boolean;
}
export type Action =
  | { type: 'grab'; chip: number }
  | { type: 'move'; chip: number; x: number; z: number }
  | { type: 'release'; chip: number }
  | { type: 'ready'; value: boolean }
  | { type: 'debug-ready'; player: string }
  | { type: 'debug-reset' }
  | { type: 'again' }
  | { type: 'sit' }
  | { type: 'leave' };
export function seatPoint(seat: number, max: number, radius = 4.35): Point {
  const angle = seat * Math.PI * 2 / max;
  return { x: Math.sin(angle) * radius, z: Math.cos(angle) * radius };
}
export function areaFor(point: Point, players: Pick<Player, 'id' | 'seat'>[]): string | null {
  for (const player of players) {
    const center = seatPoint(player.seat, players.length);
    if (Math.hypot(point.x - center.x, point.z - center.z) <= 1.12) return player.id;
  }
  return null;
}
