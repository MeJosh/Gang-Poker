# Gang Poker

A cooperative, real-time poker party game. Rank your hands from weakest to strongest using only numbered chips to communicate. No betting, chat, or scoring.

## Run locally

Install [Bun](https://bun.sh), then run:

```sh
make install
make dev
```

Open http://localhost:3000. All visitors join the same table after entering a display name. At least three seated players are required to advance. To test several players on one computer, use separate browser profiles or private browsing sessions: tabs sharing browser storage reclaim the same seat.

To play on phones on the same network, open `http://<your-computer-LAN-address>:3000`. Touch and mouse both use direct dragging. This first pass keeps the same fixed-seat layout across screen sizes; responsive layout and reveal choreography remain areas to refine.

The development server watches server/shared source files and rebuilds the client on restart. After changing client-only files, run `make build` and refresh the browser.

## Commands

| Command | Purpose |
| --- | --- |
| `make dev` | Build and start the development server |
| `make build` | Build the browser client |
| `make start` | Build and serve in production mode |
| `make check` | Check TypeScript |
| `make test` | Run rule and real-WebSocket integration tests |
| `make docker` | Build the production image |
| `make docker-run` | Run the production container on port 3000 |

`PORT` defaults to `3000`. `MAX_PLAYERS` defaults to `6` and accepts integers from `3` to `10` (the standard deck's ten-player limit). For example:

```sh
MAX_PLAYERS=8 PORT=3100 make dev
```

## Production container

```sh
make docker
docker run --rm -p 3000:3000 -e MAX_PLAYERS=6 gang-poker
```

One Bun process serves static assets and WebSockets from the same origin. The image uses a separate build stage and runs as the unprivileged `bun` user. `/health` returns readiness. If placed behind a reverse proxy, preserve the Host header, support WebSocket upgrades, and set `PUBLIC_ORIGIN` to the browser-facing origin (for example, `https://poker.example.com`); use TLS for internet hosting. Run a single replica: game state lives in process memory and is lost on restart.

## Game flow

- Pre-flop opens immediately. New players take available seats until it locks; spectators can join anytime. “Watch instead” bypasses seating.
- Each player sees their own two cards. Spectators and other players receive card backs until the reveal.
- Drag any released chip anywhere on the felt. Active drags are exclusive; a lifted chip and a small seat-colored name marker identify its controller.
- Exactly one current-stage chip must have its center inside your circle to confirm Ready. Your confirmation belongs to that chip, and clears if the chip leaves, changes, or another chip enters. You can withdraw Ready manually.
- Everyone must be connected and Ready, with no active drag, to advance. Three players are required. Completed chips move to locked history positions; the next stage gets fresh chips in a new color.
- Flop reveals three shared cards, turn one, and river one. After river locks, every hand is revealed. Any seated player can choose Play again.
- Refreshing restores the same seat using a private browser token. Opening the seat in another tab replaces its previous connection. Disconnects clear Ready and release held chips; the table waits for that player to return.

The server decides drag ownership, positions, readiness, and transitions. Local dragging updates immediately and other movement is interpolated. Abandoned drag locks expire; heartbeat timeouts detect silent disconnects. Spectators cannot manipulate chips, and private cards are filtered on the server before sending snapshots.

## Project map

- `src/server/game.ts`: room state and game rules, independent of transport.
- `src/server/index.ts`: Bun HTTP/WebSocket server, validation, reconnects, and broadcast loop.
- `src/shared/types.ts`: shared messages, seat geometry, and stage colors.
- `src/client/main.ts`: Three.js table, pointer controls, and interface.
- `public/`: page and styles; browser bundle is generated in `public/assets/`.
- [CONTEXT.md](CONTEXT.md): domain glossary.
- [docs/mvp.md](docs/mvp.md): agreed MVP scope and deferred work.

Deferred: multiple rooms, persistent recovery, replacing absent players, scoring, history infographics, refined animations, adaptive seating layouts, and chip physics. The reveal and Play again flow are placeholders.
