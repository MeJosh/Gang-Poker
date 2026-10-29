# MVP decisions

## Game flow

- The MVP has one shared room. Entering a display name automatically joins it; there is no room code or room selection. Multiple rooms are deferred, with game state scoped to a room to accommodate them later.
- Newcomers default to a player seat when pre-flop is open and capacity is available; otherwise they join as spectators. Name entry also offers “Watch instead.”
- Each player uses their own browser and sees only their own private cards until the reveal.
- Private cards stay face up on their owner's screen, with no peek control. Other viewers see card backs until the reveal.
- The table opens directly into pre-flop without a host start action. Players may join until pre-flop locks; spectators may join anytime.
- Pre-flop requires at least three seated players to complete. The seat limit is configurable and defaults to six.
- Joining during pre-flop deals the newcomer two cards, adds the next numbered chip, and clears everyone's ready status. Existing cards stay unchanged. Seats redistribute evenly around the circle. Chips whose centers are inside a remaining player’s area rotate with them; other chips stay at their table coordinates.
- Each stage uses a fresh set of chips with a distinct color. When everyone is ready simultaneously, its chips move to fixed history positions in front of their holders and lock. Readiness clears for the next stage.
- Only the final ranking matters. Earlier chips preserve communication history. Scoring and automatic ranking checks are outside the MVP.
- After river locks, all private cards are revealed. Reveal choreography will be designed later.
- Placeholder after the reveal: any seated player can choose “Play again,” clearing cards and chip history, dealing a fresh pre-flop, and reopening seats for joining. The end-of-game flow remains subject to refinement.
- Stage transitions are automatic: pause chip interaction, move completed chips into history positions, reveal the next community cards, and place fresh chips in the center. Animation timing and choreography remain to be refined.

## Chip interaction

- Players communicate only through chips.
- An active drag reserves a chip until release. Released chips can be taken from anywhere, including another player's area.
- Players can place chips anywhere on the table, including another player's area.
- Only a player can confirm their own readiness, requiring exactly one current-stage chip in their area. Zero or multiple chips clear readiness.
- Ready chips remain stealable until the stage locks.
- Player areas have visible boundaries. A chip belongs to an area when its center is inside, including during a drag; boundary crossings immediately update readiness. Locked history chips do not count.
- Stage completion requires everyone ready and no active drag. Players may confirm readiness while a chip is being held in their area.
- Readiness confirms a specific chip. Replacing it clears readiness even if the area never appears empty.
- Chips follow the pointer or finger directly on the table, without momentum, bouncing, or pushing other chips. Overlap is allowed. Physics may be explored separately later.
- During a drag, the chip lifts slightly and displays a compact seat-colored marker identifying its controller. Keep this separate from the chip's stage color and avoid visual clutter.
- Each seat displays its Ready status. Players can withdraw their own confirmation without moving a chip.

## Visual direction

- Board-game feel with dark teal felt, clear card faces, chunky numbered chips, and distinct stage colors.

## Devices and connections

- Mouse and touch interaction are required, including phone support. Detailed responsive layout remains to be designed.
- Only occupied seats are shown, spread evenly around the circular table, with the viewer’s own seat nearest the bottom. Joining or explicitly leaving during pre-flop redistributes seats and clears readiness. Active drags end on layout changes. Leaving removes the highest numbered chip so ranks remain 1 through the player count; chips in the departing player’s area otherwise stay in place.
- A disconnected player's seat and cards are preserved, their active drag is released, and their ready status clears. The game waits for them to reconnect.
- Disconnected seats are visibly marked. Other players may keep moving chips while stage completion waits for the absent player.
- Removing or replacing absent players is deferred until after the MVP.
- Spectators see only the shared table until the reveal. Spectator takeover of an absent player's seat is deferred.
- Refreshing or reconnecting from the same browser restores the player's existing seat and private cards using a private reconnect token. Display names do not authorize seat recovery; accounts and passwords are unnecessary for the MVP.
- Active games live in server memory and are lost on server restart. Persistent recovery is deferred.

## Requested implementation foundation

- TypeScript and Bun.
- A 3D table in a web client, with Three.js proposed.
- WebSocket communication for smooth shared chip movement.
- A Makefile with basic development commands.
- A Docker container serving the client and server in production.
- The server is authoritative over chip positions, drag ownership, readiness, and stage transitions. It resolves simultaneous grabs to one controller.
- Local dragging responds immediately; remote movement is smoothly interpolated. Clients reconcile with the server's accepted state.
