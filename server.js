const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server, path: '/websocket' });

app.use(express.static(path.join(__dirname, 'BirdHunterVP')));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'BirdHunterVP', 'index.html'));
});

class GameRoom {
  constructor(id) {
    this.id = id;
    this.players = new Map();
    this.fish = new Map();
    this.fishUidCounter = 1;
    this.sceneId = 1;
    this.serverTime = Date.now();
    this.freezeStartTime = 0;
    this.freezeEndTime = 0;
    this.spawnInterval = null;
    this.updateInterval = null;
  }

  addPlayer(ws, playerData) {
    const pos = this.getNextPosition();
    if (pos === -1) return null;
    
    const player = {
      ws,
      uid: playerData.uid || Date.now() + Math.random(),
      pos: pos + 1,
      score: 10000,
      gunId: 1,
      rate: 1,
      nickname: playerData.nickname || `Player${pos + 1}`,
      featherCount: 0
    };
    
    this.players.set(ws, player);
    return player;
  }

  getNextPosition() {
    const usedPositions = new Set();
    this.players.forEach(p => usedPositions.add(p.pos - 1));
    for (let i = 0; i < 6; i++) {
      if (!usedPositions.has(i)) return i;
    }
    return -1;
  }

  removePlayer(ws) {
    const player = this.players.get(ws);
    if (player) {
      this.broadcast({
        type: 'broadplayer',
        message: {
          type: 2,
          player: { uid: player.uid, pos: player.pos }
        }
      }, ws);
      this.players.delete(ws);
    }
    if (this.players.size === 0) {
      this.stopSpawning();
    }
  }

  broadcast(data, excludeWs = null) {
    const message = JSON.stringify(data);
    const messageBuffer = Buffer.from(message, 'utf8');
    this.players.forEach((player, ws) => {
      if (ws !== excludeWs && ws.readyState === WebSocket.OPEN) {
        ws.send(messageBuffer);
      }
    });
  }

  sendToPlayer(ws, data) {
    if (ws.readyState === WebSocket.OPEN) {
      const message = JSON.stringify(data);
      ws.send(Buffer.from(message, 'utf8'));
    }
  }

  startSpawning() {
    if (this.spawnInterval) return;
    
    this.spawnInterval = setInterval(() => {
      this.spawnFish();
    }, 2000);

    this.updateInterval = setInterval(() => {
      this.serverTime = Date.now();
    }, 100);
  }

  stopSpawning() {
    if (this.spawnInterval) {
      clearInterval(this.spawnInterval);
      this.spawnInterval = null;
    }
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = null;
    }
  }

  spawnFish() {
    const fishCount = Math.floor(Math.random() * 3) + 1;
    const fishList = [];
    
    for (let i = 0; i < fishCount; i++) {
      const fishType = Math.floor(Math.random() * 20) + 1;
      const routeId = Math.floor(Math.random() * 30) + 1;
      const fish = {
        uid: this.fishUidCounter++,
        classid: fishType,
        routeid: routeId,
        rate: Math.floor(Math.random() * 10) + 1,
        offsettype: 0,
        offsetx: 0,
        offsety: 0,
        offsetr: 0,
        born_time: Date.now(),
        dead_time: Date.now() + 30000
      };
      this.fish.set(fish.uid, fish);
      fishList.push(fish);

      setTimeout(() => {
        this.fish.delete(fish.uid);
        this.broadcast({
          type: 'decreasesprites',
          message: { sprites: [fish.uid] }
        });
      }, 30000);
    }

    this.broadcast({
      type: 'increasesprites',
      message: { sprites: fishList }
    });
  }

  getPlayersInfo() {
    const players = [];
    this.players.forEach(p => {
      players.push({
        uid: p.uid,
        pos: p.pos,
        score: p.score,
        gunId: p.gunId,
        rate: p.rate,
        nickname: p.nickname
      });
    });
    return players;
  }

  handleHit(ws, hitData) {
    const player = this.players.get(ws);
    if (!player) return;

    const fishUids = hitData.fishuid || [];
    const hitFish = [];
    
    fishUids.forEach(uid => {
      if (this.fish.has(uid)) {
        const fish = this.fish.get(uid);
        const caught = Math.random() < 0.3;
        if (caught) {
          const reward = fish.rate * hitData.rate;
          player.score += reward;
          hitFish.push({
            uid: uid,
            classid: fish.classid,
            win: reward
          });
          this.fish.delete(uid);
        }
      }
    });

    this.broadcast({
      type: 'broadplayer',
      message: {
        type: 3,
        player: {
          uid: player.uid,
          pos: player.pos,
          score: player.score
        }
      }
    });

    if (hitFish.length > 0) {
      const caughtFishUids = hitFish.map(f => f.uid);
      
      this.broadcast({
        type: 'decreasesprites',
        message: { sprites: caughtFishUids }
      });
      
      this.broadcast({
        type: 'hitsprites',
        message: {
          pos: player.pos,
          hitfish: hitFish,
          score: player.score
        }
      });
    }
  }
}

class RoomManager {
  constructor() {
    this.rooms = new Map();
    this.defaultRoom = this.createRoom('default');
  }

  createRoom(id) {
    const room = new GameRoom(id);
    this.rooms.set(id, room);
    return room;
  }

  getRoom(id) {
    return this.rooms.get(id);
  }

  getDefaultRoom() {
    return this.defaultRoom;
  }
}

const roomManager = new RoomManager();

wss.on('connection', (ws) => {
  let currentRoom = null;
  let currentPlayer = null;

  ws.on('message', (data) => {
    try {
      const message = JSON.parse(data.toString());
      const gameData = message.gameData || message;
      
      handleMessage(ws, gameData, message);
    } catch (e) {
      console.error('Error parsing message:', e);
    }
  });

  function handleMessage(ws, gameData, fullMessage) {
    const type = gameData.type;
    const msg = gameData.message || {};

    switch (type) {
      case 'heart':
        currentRoom?.sendToPlayer(ws, {
          type: 'heart',
          message: { time: Date.now() }
        });
        break;

      case 'login':
        currentRoom = roomManager.getDefaultRoom();
        let playerNickname = msg.nickname || 'Player';
        if (fullMessage.cookie) {
          const nicknameMatch = fullMessage.cookie.match(/playerNickname=([^;]+)/);
          if (nicknameMatch) {
            playerNickname = decodeURIComponent(nicknameMatch[1]);
          }
        }
        currentPlayer = currentRoom.addPlayer(ws, {
          uid: fullMessage.sessionId || Date.now(),
          nickname: playerNickname
        });
        
        if (currentPlayer) {
          currentRoom.sendToPlayer(ws, {
            type: 'login',
            message: {
              code: 0,
              serverTime: Date.now(),
              player: {
                uid: currentPlayer.uid,
                pos: currentPlayer.pos,
                score: currentPlayer.score,
                gunId: currentPlayer.gunId,
                rate: currentPlayer.rate
              }
            }
          });

          currentRoom.broadcast({
            type: 'broadplayer',
            message: {
              type: 1,
              player: {
                uid: currentPlayer.uid,
                pos: currentPlayer.pos,
                score: currentPlayer.score,
                gunId: currentPlayer.gunId,
                nickname: currentPlayer.nickname
              }
            }
          }, ws);

          currentRoom.startSpawning();
        }
        break;

      case 'enterroom':
        if (currentRoom && currentPlayer) {
          const players = currentRoom.getPlayersInfo();
          const fishList = Array.from(currentRoom.fish.values());
          
          currentRoom.sendToPlayer(ws, {
            type: 'enterroom',
            message: {
              code: 0,
              serverTime: Date.now(),
              sceneid: currentRoom.sceneId,
              players: players,
              sprites: fishList,
              feathers: []
            }
          });
        }
        break;

      case 'fire':
        if (currentRoom && currentPlayer) {
          currentPlayer.score -= msg.rate || 1;
          
          currentRoom.broadcast({
            type: 'broadplayer',
            message: {
              type: 3,
              player: {
                uid: currentPlayer.uid,
                pos: currentPlayer.pos,
                score: currentPlayer.score
              }
            }
          });
          
          currentRoom.broadcast({
            type: 'fire',
            message: {
              pos: currentPlayer.pos,
              uid: currentPlayer.uid,
              angle: msg.angle,
              gunId: currentPlayer.gunId,
              rate: msg.rate,
              score: currentPlayer.score
            }
          }, ws);
        }
        break;

      case 'hit':
        if (currentRoom) {
          currentRoom.handleHit(ws, msg);
        }
        break;

      case 'changegun':
        if (currentPlayer) {
          currentPlayer.gunId = msg.gunId || 1;
          currentPlayer.rate = msg.rate || 1;
          
          currentRoom?.broadcast({
            type: 'changegun',
            message: {
              pos: currentPlayer.pos,
              gunId: currentPlayer.gunId,
              rate: currentPlayer.rate
            }
          });
        }
        break;

      case 'lock':
        if (currentRoom && currentPlayer) {
          currentRoom.broadcast({
            type: 'changelock',
            message: {
              pos: currentPlayer.pos,
              lockid: msg.lockid
            }
          });
        }
        break;

      case 'freeze':
        if (currentRoom) {
          currentRoom.freezeStartTime = Date.now();
          currentRoom.freezeEndTime = Date.now() + 5000;
          currentRoom.broadcast({
            type: 'changeimmob',
            message: {
              startTime: currentRoom.freezeStartTime,
              endTime: currentRoom.freezeEndTime
            }
          });
        }
        break;

      case 'exitroom':
      case 'logout':
        if (currentRoom) {
          currentRoom.removePlayer(ws);
          currentRoom = null;
          currentPlayer = null;
        }
        break;

      default:
        console.log('Unknown message type:', type);
    }
  }

  ws.on('close', () => {
    if (currentRoom) {
      currentRoom.removePlayer(ws);
    }
  });

  ws.on('error', (error) => {
    console.error('WebSocket error:', error);
  });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Multiplayer game server running on port ${PORT}`);
  console.log(`WebSocket endpoint: ws://0.0.0.0:${PORT}/websocket`);
});
