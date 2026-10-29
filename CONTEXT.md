# Gang Poker

A cooperative card game in which players communicate only through numbered chips to rank their poker hands from weakest to strongest.

## Language

**Table**:
The shared game space that players join from their own devices, each viewing it from their seat. Chip movements, community cards, and locked chip history are visible to everyone.

**Player**:
A participant occupying a seat with two private cards and a player area. Players may take a seat until pre-flop locks; each new player adds the next numbered rank chip and clears every player's ready confirmation while existing cards and chip positions remain in place.

**Spectator**:
A participant who watches the shared table without occupying a seat or taking part in ranking. Spectators may join at any time and cannot see private cards until the reveal.

**Seat**:
A player's place at the table for a game. The occupied seats become fixed when pre-flop locks.

**Private cards**:
The two cards dealt to a player, visible only to that player until the end-of-game reveal.
_Avoid_: Public cards

**Community cards**:
The shared cards revealed across the flop, turn, and river that every player uses with their private cards.

**Hand**:
A player's poker hand, formed from their private cards and the available community cards.

**Rank chip**:
One of the chips numbered from 1 to the number of players, expressing a proposed relative hand strength. Chip 1 represents the weakest hand and the highest numbered chip represents the strongest.
_Avoid_: Bet, wager

**Chip movement**:
The players' sole communication channel for negotiating their relative hand strengths, including how they take and move rank chips. Any player may move an available chip anywhere on the table, including another player's area.

**Active drag**:
A player's exclusive hold on a rank chip while moving it, ending when they release it. Other players cannot take that chip during the active drag.

**Player area**:
The visibly bounded region in front of a player where current-stage rank chips count toward that player's proposed rank, determined by each chip's center point even during an active drag. A released chip in a player area remains available for anyone to take.

**Ready**:
A player's explicit confirmation of a specific current-stage rank chip when exactly one chip is in their player area; only that player can confirm it. That confirmation clears if the confirmed chip changes or their area contains zero or multiple chips.

**Stage**:
One of pre-flop, flop, turn, or river, with its own distinctly colored set of rank chips. Players negotiate ranks using that stage's chips until everyone is ready simultaneously and no active drag remains.
_Avoid_: Round

**Pre-flop**:
The opening stage, which begins without a separate start action and remains open for players to join until it locks. It requires at least three seated players to complete.

**Locked chip**:
A rank chip from a completed stage, placed in a fixed history position in front of the player who held it when everyone became ready. Locked chips cannot be moved and do not count toward readiness in later stages.

**Final ranking**:
The players' proposed order of hand strength recorded by the locked river chips. Earlier stages' locked chips preserve communication history rather than scored rankings.

**Reveal**:
The end-of-game sequence that exposes all players' private cards after the river ranking is locked.

## Example dialogue

Developer: “Can players explain why they want a rank chip?”
Domain expert: “No. They communicate only through the rank chips, so how they move and take them matters.”

Developer: “Does Ready protect my chip from being stolen?”
Domain expert: “No. Only completing the stage locks the chips; until then, a released chip can still be taken.”
