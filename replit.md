# Kirin Storm Multiplayer Game

## Overview
A multiplayer fishing/hunting game built with the Egret game engine. The game supports up to 6 players in the same room, all playing simultaneously and seeing each other's actions in real-time. Server implements the original PHP protocol with full RTP/bank management.

## Recent Changes
- **2026-01-28**: Full multiplayer implementation matching original PHP protocol
  - Added succ/errinfo fields to all responses
  - Implemented quickenterroom with proper room state
  - Added betting/RTP logic with bank management
  - Fish paytable and damage tables for win calculations
  - Multiple room types (0, 1, 2) with different bet ranges
  - Scene changes every 80 seconds
  - Proper player score synchronization

## Project Architecture

### Server (server.js)
- **Express.js**: Serves static game files from `BirdHunterVP/` directory
- **WebSocket Server**: Handles real-time multiplayer communication
- **GameRoom Class**: Manages individual game rooms with:
  - Player tracking (up to 6 players per room)
  - Fish spawning and synchronization with paytable
  - Bank/RTP management (96% RTP)
  - Score management with betting
  - Scene rotation every 80 seconds
- **RoomManager**: Handles room types (0=low, 1=medium, 2=high stakes)

### Game Configuration
| Room Type | Min Bet | Max Bet | Default Bet |
|-----------|---------|---------|-------------|
| 0 (Low)   | 1       | 200     | 1           |
| 1 (Medium)| 10      | 2000    | 10          |
| 2 (High)  | 50      | 20000   | 50          |

### Fish Paytable (Fish Type → Win Multiplier Range)
- Types 1-5: 2x-8x multiplier
- Types 6-10: 6x-25x multiplier  
- Types 11-15: 20x-80x multiplier
- Types 16-20: 60x-250x multiplier
- Types 21-24: 200x-600x multiplier
- Type 25: Bomb (special effect)

### Client (BirdHunterVP/)
- **index.html**: Main entry point with multiplayer lobby
- **skdm.js**: SDK/platform utilities
- **cdn/**: Game assets and scripts

### Game Protocol (WebSocket Messages)
All messages include `succ: true/false` and `errinfo: "ok"` fields.

| Message Type | Direction | Purpose |
|-------------|-----------|---------|
| login | Client→Server | Player login |
| quickenterroom | Client→Server | Join room with type selection |
| enterroom | Client→Server | Request room state |
| fire | Client→Server | Player shoots (deducts bet) |
| hit | Client→Server | Report fish hit (calculates win) |
| changerate | Client→Server | Change bet amount |
| changelocking | Client→Server | Lock onto fish |
| broadplayer | Server→Client | Player state updates |
| increasesprites | Server→Client | New fish spawned |
| decreasesprites | Server→Client | Fish removed |
| hitsprites | Server→Client | Fish caught with rewards |
| changescene | Server→Client | Scene rotation |
| heart | Bidirectional | Keep-alive ping |

## Running the Game
1. Start the server: `npm start` or `node server.js`
2. Open the game in browser at port 5000
3. Enter a nickname and click "Join Game"
4. Multiple browser tabs/windows can join the same game room

## Key Files
- `server.js` - Multiplayer WebSocket server with RTP logic
- `package.json` - Node.js dependencies
- `BirdHunterVP/index.html` - Game client with lobby
- `BirdHunterVP/manifest/1011.json` - Game script manifest

## Dependencies
- express: Web server for static files
- ws: WebSocket library for real-time communication

## RTP/Bank Management
- Server maintains a bank pool for each room
- RTP set to 96% (configurable via rtpPercent)
- Wins are calculated based on:
  1. Fish paytable multiplier
  2. Fish damage/catch probability
  3. Available bank balance
  4. Player bet amount
- Bank receives portion of each bet
- Wins deducted from bank when fish caught

## Multiplayer Features
- Single shared game room per room type
- Up to 6 players per room
- Real-time fish spawning synchronized
- Player positions assigned automatically
- Score tracking with betting system
- Fish catch synchronization
- Player join/leave notifications
- Scene changes broadcast to all
- Automatic heartbeat maintenance
