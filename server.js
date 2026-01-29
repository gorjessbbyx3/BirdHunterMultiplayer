const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(express.static(path.join(__dirname, 'BirdHunterVP')));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'BirdHunterVP', 'index.html'));
});

app.get('/game/KirinStormVP/server', (req, res) => {
  const command = req.query.command || '';
  const decodedCommand = decodeURIComponent(command);
  console.log('HTTP request:', decodedCommand);
  
  const balanceInCents = 100000;
  
  if (decodedCommand.includes('fishRoomTypeInfo')) {
    res.json({
      Code: 20000,
      Message: "Success",
      Data: {
        roomTypeInfo: {
          money: balanceInCents,
          limit: [
            { roomtype: 0, limitBalance: 1000 },
            { roomtype: 1, limitBalance: 10000 },
            { roomtype: 2, limitBalance: 50000 }
          ]
        },
        fishRoomMod: 1
      }
    });
  } else if (decodedCommand.includes('servids')) {
    res.json({
      Code: 20000,
      Message: "Success",
      Data: {
        res: [{ gameid: 1008, servid: 1 }]
      }
    });
  } else {
    res.json({ succ: true, errinfo: "ok", message: {} });
  }
});

const FISH_PAYTABLE = {
  0: [0], 1: [2], 2: [2], 3: [3], 4: [5], 5: [6], 6: [7], 7: [8], 8: [9], 9: [10],
  10: [12], 11: [15], 12: [18], 13: [20], 14: [25], 15: [30], 16: [40], 17: [60], 18: [80],
  19: [100, 200], 20: [200, 500], 21: [1000],
  22: [0], 23: [0], 24: [0], 25: [0], 26: [0], 27: [0], 28: [0], 29: [0], 30: [0]
};

const FISH_DAMAGE = {
  0: 2, 1: 2, 2: 3, 3: 4, 4: 4, 5: 5, 6: 6, 7: 7, 8: 8, 9: 8,
  10: 10, 11: 15, 12: 15, 13: 25, 14: 25, 15: 30, 16: 30, 17: 40, 18: 40, 19: 40,
  20: 50, 21: 50, 22: 50, 23: 50, 24: 100, 25: 100, 26: 100, 27: 200, 28: 200, 29: 200, 30: 200
};

const ROOM_TYPES = {
  0: { min: 1, max: 200, defaultBet: 1 },
  1: { min: 10, max: 2000, defaultBet: 10 },
  2: { min: 50, max: 20000, defaultBet: 50 }
};

class GameRoom {
  constructor(id, roomType = 0) {
    this.id = id;
    this.roomType = roomType;
    this.players = new Map();
    this.fish = new Map();
    this.fishUidCounter = 1;
    this.sceneId = Math.floor(Math.random() * 3) + 1;
    this.sceneState = 0;
    this.sceneBTime = Date.now();
    this.sceneETime = Date.now() + 80000;
    this.bank = 100000;
    this.rtpPercent = 96;
    this.spawnInterval = null;
    this.sceneInterval = null;
    this.roomConfig = ROOM_TYPES[roomType] || ROOM_TYPES[0];
  }

  addPlayer(ws, playerData) {
    const pos = this.getNextPosition();
    if (pos === -1) return null;
    
    const player = {
      ws,
      uid: playerData.uid || 7401,
      pos: pos + 1,
      score: playerData.score || 100000,
      gunId: 1,
      gunNum: 0,
      rewardRate: this.roomConfig.defaultBet,
      nickname: playerData.nickname || `Player${pos + 1}`,
      isVisitor: 0
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
        message: { type: 2, player: { uid: player.uid, pos: player.pos } },
        succ: true,
        errinfo: "ok",
        type: "broadplayer"
      }, ws);
      this.players.delete(ws);
    }
    if (this.players.size === 0) {
      this.stopSpawning();
    }
  }

  startSpawning() {
    if (this.spawnInterval) return;
    
    this.spawnInterval = setInterval(() => {
      if (this.players.size > 0) {
        this.spawnFish();
      }
    }, 3000);

    this.sceneInterval = setInterval(() => {
      this.changeScene();
    }, 80000);
  }

  stopSpawning() {
    if (this.spawnInterval) {
      clearInterval(this.spawnInterval);
      this.spawnInterval = null;
    }
    if (this.sceneInterval) {
      clearInterval(this.sceneInterval);
      this.sceneInterval = null;
    }
  }

  changeScene() {
    this.sceneId = (this.sceneId % 3) + 1;
    this.sceneState = 0;
    this.sceneBTime = Date.now();
    this.sceneETime = Date.now() + 80000;
    
    this.fish.clear();
    this.fishUidCounter = 1;

    this.broadcastAll({
      message: {
        sceneid: this.sceneId,
        state: this.sceneState,
        servtime: Date.now()
      },
      succ: true,
      errinfo: "ok",
      type: "changescene"
    });
  }

  spawnFish() {
    const fishCount = Math.floor(Math.random() * 5) + 3;
    const newFish = [];

    for (let i = 0; i < fishCount; i++) {
      const fishType = Math.floor(Math.random() * 22);
      const fishUid = this.fishUidCounter++;
      const pathId = Math.floor(Math.random() * 50) + 1;
      const offsetX = Math.floor(Math.random() * 100) - 50;
      const offsetY = Math.floor(Math.random() * 100) - 50;
      const offsetTime = Math.floor(Math.random() * 1000);

      const fish = {
        id: fishUid,
        fishtype: fishType,
        pathid: pathId,
        pathtype: 0,
        speed: 80 + Math.floor(Math.random() * 40),
        offsetx: offsetX,
        offsety: offsetY,
        offsettime: offsetTime,
        dead: 0
      };

      this.fish.set(fishUid, fish);
      newFish.push(fish);
    }

    if (newFish.length > 0) {
      this.broadcastAll({
        message: { sprites: newFish },
        succ: true,
        errinfo: "ok",
        type: "increasesprites"
      });
    }
  }

  generateInitialFish() {
    const fishCount = Math.floor(Math.random() * 10) + 10;
    const fishes = [];
    
    for (let i = 0; i < fishCount; i++) {
      const fishType = Math.floor(Math.random() * 22);
      const fishUid = this.fishUidCounter++;
      const pathId = Math.floor(Math.random() * 50) + 1;
      
      const fish = {
        id: fishUid,
        fishtype: fishType,
        pathid: pathId,
        pathtype: 0,
        speed: 80 + Math.floor(Math.random() * 40),
        offsetx: Math.floor(Math.random() * 100) - 50,
        offsety: Math.floor(Math.random() * 100) - 50,
        offsettime: Math.floor(Math.random() * 1000),
        dead: 0
      };
      
      this.fish.set(fishUid, fish);
      fishes.push(fish);
    }
    
    return fishes;
  }

  broadcast(message, excludeWs = null) {
    const data = JSON.stringify(message);
    this.players.forEach((player, ws) => {
      if (ws !== excludeWs && ws.readyState === WebSocket.OPEN) {
        ws.send(data);
      }
    });
  }

  broadcastAll(message) {
    const data = JSON.stringify(message);
    this.players.forEach((player, ws) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(data);
      }
    });
  }

  sendToPlayer(ws, message) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
    }
  }

  getPlayersInfo() {
    const players = [];
    this.players.forEach((player) => {
      players.push({
        uid: player.uid,
        ws: 0,
        pos: player.pos,
        gunid: player.gunId,
        gunnum: player.gunNum,
        reward_rate: player.rewardRate,
        score: player.score,
        isvistor: player.isVisitor
      });
    });
    return players;
  }

  getFishList() {
    return Array.from(this.fish.values());
  }
}

class RoomManager {
  constructor() {
    this.rooms = new Map();
    for (let i = 0; i < 3; i++) {
      this.createRoom(`room_type_${i}`, i);
    }
  }

  createRoom(id, roomType = 0) {
    const room = new GameRoom(id, roomType);
    this.rooms.set(id, room);
    return room;
  }

  getRoom(roomType) {
    return this.rooms.get(`room_type_${roomType}`);
  }

  getDefaultRoom() {
    return this.rooms.get('room_type_0');
  }
}

const roomManager = new RoomManager();

wss.on('connection', (ws) => {
  console.log('New WebSocket connection');
  let currentRoom = null;
  let currentPlayer = null;

  ws.on('message', (data) => {
    try {
      const message = JSON.parse(data.toString());
      const gameData = message.gameData || message;
      console.log('Received:', gameData.type);
      handleMessage(ws, gameData, message);
    } catch (e) {
      console.error('Error parsing message:', e.message);
    }
  });

  function handleMessage(ws, gameData, fullMessage) {
    const type = gameData.type;
    const msg = gameData.message || {};
    const curTime = Date.now();

    switch (type) {
      case 'heart':
        if (currentRoom) {
          currentRoom.sendToPlayer(ws, {
            type: "heart",
            message: { time: curTime }
          });
        }
        break;

      case 'login':
        currentRoom = roomManager.getDefaultRoom();
        currentPlayer = currentRoom.addPlayer(ws, {
          uid: fullMessage.sessionId || 7401,
          nickname: 'Player',
          score: 100000
        });
        
        if (currentPlayer) {
          currentRoom.sendToPlayer(ws, {
            message: { issucc: 1, uid: currentPlayer.uid },
            succ: true,
            errinfo: "ok",
            type: "login"
          });
        }
        break;

      case 'quickenterroom':
        const roomType = msg.roomtype || 0;
        currentRoom = roomManager.getRoom(roomType);
        
        if (!currentPlayer) {
          currentPlayer = currentRoom.addPlayer(ws, {
            uid: fullMessage.sessionId || 7401,
            score: 100000
          });
        }
        
        if (currentPlayer) {
          const config = ROOM_TYPES[roomType] || ROOM_TYPES[0];
          currentPlayer.rewardRate = config.defaultBet;
          currentRoom.startSpawning();
          
          const fishes = currentRoom.generateInitialFish();
          const players = currentRoom.getPlayersInfo();
          
          const feathers = [];
          for (let i = 0; i < 6; i++) {
            feathers.push({
              pos: i + 1,
              feathercount: 5,
              values: [10, 50, 100, 500, 1000]
            });
          }

          currentRoom.sendToPlayer(ws, {
            message: {
              result: true,
              sprites: fishes,
              players: players,
              feathers: feathers,
              sceneid: currentRoom.sceneId,
              scenestate: currentRoom.sceneState,
              scenetime: currentRoom.sceneETime,
              isimmob: false,
              coinrate: 100,
              max: config.max,
              min: config.min
            },
            succ: true,
            errinfo: "ok",
            type: "enterroom"
          });

          currentRoom.broadcast({
            message: {
              type: 1,
              player: {
                uid: currentPlayer.uid,
                ws: 0,
                pos: currentPlayer.pos,
                gunid: currentPlayer.gunId,
                gunnum: currentPlayer.gunNum,
                reward_rate: currentPlayer.rewardRate,
                score: currentPlayer.score,
                isvistor: currentPlayer.isVisitor
              }
            },
            succ: true,
            errinfo: "ok",
            type: "broadplayer"
          }, ws);
        }
        break;

      case 'fire':
        if (!currentPlayer || !currentRoom) return;
        
        currentRoom.broadcastAll({
          message: {
            type: 3,
            player: {
              uid: currentPlayer.uid,
              ws: 0,
              pos: currentPlayer.pos,
              gunid: currentPlayer.gunId,
              gunnum: currentPlayer.gunNum,
              reward_rate: currentPlayer.rewardRate,
              score: currentPlayer.score,
              isvistor: currentPlayer.isVisitor
            }
          },
          succ: true,
          errinfo: "ok",
          type: "broadplayer"
        });
        break;

      case 'hit':
        if (!currentPlayer || !currentRoom) return;

        const bulletId = msg.fblist?.[0]?.bulletid || msg.bulletid || 0;
        const fishIds = msg.fblist?.[0]?.fishids || msg.fishids || [];
        const fishpids = msg.fblist?.[0]?.fishpids || msg.fishpids || [];
        
        const allbet = currentPlayer.rewardRate / 100;
        
        if (allbet * 100 > currentPlayer.score) {
          currentRoom.sendToPlayer(ws, {
            responseEvent: "error",
            responseType: "",
            serverResponse: "invalid balance"
          });
          return;
        }
        
        const bankSum = allbet / 100 * currentRoom.rtpPercent;
        currentRoom.bank += bankSum;
        currentPlayer.score -= Math.round(allbet * 100);

        let totalWin = 0;
        const totalWinsArr = [];
        let isBombId = 0;
        let isBomb = 0;
        let isBombWin = 0;
        let payRate = 0;

        for (let i = 0; i < fishpids.length; i++) {
          const fishType = fishpids[i];
          if (fishType === 25) {
            isBombId = fishIds[i];
            isBomb = 1;
            isBombWin = Math.floor(Math.random() * (FISH_DAMAGE[fishType] || 100)) + 1;
            totalWinsArr.push({ uid: isBombId, score: 0, rate: 0, ext: 0 });
          }
        }

        for (let i = 0; i < fishpids.length; i++) {
          const fishType = fishpids[i];
          const fishUid = fishIds[i];
          
          const paytable = FISH_PAYTABLE[fishType] || [0];
          if (paytable.length > 1) {
            payRate = Math.floor(Math.random() * (paytable[1] - paytable[0] + 1)) + paytable[0];
          } else {
            payRate = paytable[0];
          }

          const damage = FISH_DAMAGE[fishType] || 10;
          let isWin = Math.floor(Math.random() * damage) + 1;
          
          if (isBomb && isBombWin === 1 && fishUid !== isBombId) {
            isWin = 1;
          }

          if (isWin === 1 && totalWin + (payRate * allbet) <= currentRoom.bank && payRate > 0) {
            totalWin += payRate * allbet;
            totalWinsArr.push({
              uid: fishUid,
              score: Math.round(payRate * allbet * 100),
              rate: payRate,
              ext: 0
            });
            currentRoom.fish.delete(fishUid);
          }
        }

        if (totalWin > 0) {
          currentRoom.bank -= totalWin;
          currentPlayer.score += Math.round(totalWin * 100);
          
          currentRoom.sendToPlayer(ws, {
            message: {
              bulletid: bulletId.toString(),
              pos: currentPlayer.pos,
              fishes: totalWinsArr,
              rate: 1
            },
            succ: true,
            errinfo: "ok",
            type: "hitsprites"
          });

          const caughtUids = totalWinsArr.filter(f => f.score > 0).map(f => f.uid);
          if (caughtUids.length > 0) {
            currentRoom.broadcastAll({
              message: { sprites: caughtUids },
              succ: true,
              errinfo: "ok",
              type: "decreasesprites"
            });
          }
        }

        currentRoom.sendToPlayer(ws, {
          payRate: payRate,
          isBomb: isBomb,
          message: { money: 0 },
          succ: true,
          errinfo: "ok",
          type: "userinfo"
        });

        currentRoom.sendToPlayer(ws, {
          message: {
            type: 3,
            player: {
              uid: currentPlayer.uid,
              ws: 0,
              pos: currentPlayer.pos,
              gunid: currentPlayer.gunId,
              gunnum: currentPlayer.gunNum,
              reward_rate: currentPlayer.rewardRate,
              score: currentPlayer.score,
              isvistor: currentPlayer.isVisitor
            }
          },
          succ: true,
          errinfo: "ok",
          type: "broadplayer"
        });
        break;

      case 'changerate':
        if (!currentPlayer || !currentRoom) return;
        
        let newRate = msg.rewardrate || currentPlayer.rewardRate;
        if (newRate < currentRoom.roomConfig.min) newRate = currentRoom.roomConfig.min;
        if (newRate > currentRoom.roomConfig.max) newRate = currentRoom.roomConfig.max;
        currentPlayer.rewardRate = newRate;

        currentRoom.sendToPlayer(ws, {
          type: "changerate",
          message: { rewardrate: newRate }
        });

        currentRoom.sendToPlayer(ws, {
          message: {
            type: 3,
            player: {
              uid: currentPlayer.uid,
              ws: 0,
              pos: currentPlayer.pos,
              gunid: currentPlayer.gunId,
              gunnum: currentPlayer.gunNum,
              reward_rate: currentPlayer.rewardRate,
              score: currentPlayer.score,
              isvistor: currentPlayer.isVisitor
            }
          },
          succ: true,
          errinfo: "ok",
          type: "broadplayer"
        });
        break;

      case 'changelocking':
        if (!currentPlayer || !currentRoom) return;
        
        currentRoom.sendToPlayer(ws, {
          message: {
            pos: currentPlayer.pos,
            fishid: msg.fishid || 0
          },
          succ: true,
          errinfo: "ok",
          type: "changelock"
        });
        break;

      case 'changbackstage':
        if (!currentPlayer || !currentRoom) return;
        
        currentRoom.sendToPlayer(ws, {
          message: {
            type: 3,
            player: {
              uid: currentPlayer.uid,
              ws: 0,
              pos: currentPlayer.pos,
              gunid: currentPlayer.gunId,
              gunnum: currentPlayer.gunNum,
              reward_rate: currentPlayer.rewardRate,
              score: currentPlayer.score,
              isvistor: currentPlayer.isVisitor
            }
          },
          succ: true,
          errinfo: "ok",
          type: "broadplayer"
        });
        
        currentRoom.sendToPlayer(ws, {
          message: {
            sceneid: currentRoom.sceneId,
            state: currentRoom.sceneState,
            servtime: curTime
          },
          succ: true,
          errinfo: "ok",
          type: "changescene"
        });
        break;

      default:
        console.log('Unknown message type:', type);
    }
  }

  ws.on('close', () => {
    console.log('WebSocket disconnected');
    if (currentRoom && currentPlayer) {
      currentRoom.removePlayer(ws);
    }
  });

  ws.on('error', (error) => {
    console.error('WebSocket error:', error.message);
  });
});

const PORT = 5000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Multiplayer game server running on port ${PORT}`);
  console.log(`WebSocket endpoint: ws://0.0.0.0:${PORT}/websocket`);
});
