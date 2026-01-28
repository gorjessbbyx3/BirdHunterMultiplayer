# Kirin Storm Multiplayer Game

## Overview
A multiplayer fishing/hunting game built with the Egret game engine. The game supports up to 6 players in the same room, all playing simultaneously and seeing each other's actions in real-time.

## Recent Changes
- **2026-01-28**: Converted single-player WebSocket game to full multiplayer support
  - Created Node.js WebSocket server with room management
  - Implemented game state synchronization across all players
  - Added multiplayer lobby with nickname entry
  - Fish spawning is synchronized across all players
  - Player actions (shooting, scoring) are broadcast to all room members

## Project Architecture

### Server (server.js)
- **Express.js**: Serves static game files from `BirdHunterVP/` directory
- **WebSocket Server**: Handles real-time multiplayer communication
- **GameRoom Class**: Manages individual game rooms with:
  - Player tracking (up to 6 players per room)
  - Fish spawning and synchronization
  - Score management
  - Action broadcasting
- **RoomManager**: Handles creation and management of game rooms

### Client (BirdHunterVP/)
- **index.html**: Main entry point with multiplayer lobby
- **skdm.js**: SDK/platform utilities
- **cdn/**: Game assets and scripts
  - **1011/118ce7cca92b611b4f5e143b54aee1ce.js**: Main game logic
  - Game uses Egret WebSocket for binary JSON communication

### Game Protocol (WebSocket Messages)
| Message Type | Direction | Purpose |
|-------------|-----------|---------|
| login | Client→Server | Player login to room |
| enterroom | Client→Server | Request room state |
| fire | Client→Server | Player shoots |
| hit | Client→Server | Report fish hit |
| broadplayer | Server→Client | Player join/leave |
| increasesprites | Server→Client | New fish spawned |
| decreasesprites | Server→Client | Fish removed |
| hitsprites | Server→Client | Fish caught result |
| changegun | Bidirectional | Weapon change |
| heart | Bidirectional | Keep-alive ping |

## Running the Game
1. Start the server: `npm start` or `node server.js`
2. Open the game in browser at port 5000
3. Enter a nickname and click "Join Game"
4. Multiple browser tabs/windows can join the same game room

## Key Files
- `server.js` - Multiplayer WebSocket server
- `package.json` - Node.js dependencies
- `BirdHunterVP/index.html` - Game client with lobby
- `BirdHunterVP/manifest/1011.json` - Game script manifest

## Dependencies
- express: Web server for static files
- ws: WebSocket library for real-time communication

## Multiplayer Features
- Single shared game room (all players join the same room)
- Up to 6 players per room
- Real-time fish spawning synchronized across all players
- Player positions assigned automatically
- Score tracking per player - broadcast to all players on fire and hit
- Fish catch synchronization - decreasesprites broadcast when fish are caught
- Player join/leave notifications
- Automatic heartbeat to maintain connections

## Architecture Notes
- Currently implements a single shared room for all players
- Room management framework exists in RoomManager class for future expansion
- All score updates are broadcast to all players to maintain state consistency
