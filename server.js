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
  
  if (decodedCommand.includes('fishRoomTypeInfo')) {
    res.json({
      Code: 20000,
      Message: "Success",
      Data: {
        fishRoomMod: 1,
        roomTypeInfo: {
          money: 100000,
          limit: [
            { roomtype: 0, limitBalance: 1000 },
            { roomtype: 1, limitBalance: 10000 },
            { roomtype: 2, limitBalance: 50000 }
          ]
        }
      }
    });
  } else if (decodedCommand.includes('servids')) {
    res.json({
      Code: 20000,
      Message: "Success",
      Data: {
        res: [{ servid: '1' }]
      }
    });
  } else if (command === 'init') {
    res.json({
      succ: true,
      errinfo: "ok",
      message: {
        serverTime: Date.now(),
        wsUrl: '/websocket'
      }
    });
  } else {
    res.json({ succ: true, errinfo: "ok", message: {} });
  }
});

const FISH_PAYTABLE = {
  1: [2, 3], 2: [2, 4], 3: [3, 5], 4: [4, 6], 5: [5, 8],
  6: [6, 10], 7: [8, 12], 8: [10, 15], 9: [12, 18], 10: [15, 25],
  11: [20, 30], 12: [25, 40], 13: [30, 50], 14: [40, 60], 15: [50, 80],
  16: [60, 100], 17: [80, 120], 18: [100, 150], 19: [120, 200], 20: [150, 250],
  21: [200, 300], 22: [250, 400], 23: [300, 500], 24: [400, 600], 25: [0, 0]
};

const FISH_DAMAGE = {
  1: [3], 2: [3], 3: [4], 4: [4], 5: [5],
  6: [5], 7: [6], 8: [7], 9: [8], 10: [10],
  11: [12], 12: [15], 13: [18], 14: [20], 15: [25],
  16: [30], 17: [35], 18: [40], 19: [50], 20: [60],
  21: [70], 22: [80], 23: [90], 24: [100], 25: [5]
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
      uid: playerData.uid || Date.now() + Math.floor(Math.random() * 10000),
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

  broadcast(data, excludeWs = null) {
    const message = JSON.stringify(data);
    const messageBuffer = Buffer.from(message, 'utf8');
    this.players.forEach((player, ws) => {
      if (ws !== excludeWs && ws.readyState === WebSocket.OPEN) {
        ws.send(messageBuffer);
      }
    });
  }

  broadcastAll(data) {
    const message = JSON.stringify(data);
    const messageBuffer = Buffer.from(message, 'utf8');
    this.players.forEach((player, ws) => {
      if (ws.readyState === WebSocket.OPEN) {
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
    this.sceneBTime = Date.now();
    this.sceneETime = Date.now() + 80000;
    
    this.broadcastAll({
      message: {
        sceneid: this.sceneId,
        state: 0,
        servtime: Date.now()
      },
      succ: true,
      errinfo: "ok",
      type: "changescene"
    });
  }

  spawnFish() {
    const curTime = Date.now();
    const fishCount = Math.floor(Math.random() * 5) + 3;
    const fishList = [];
    
    for (let i = 0; i < fishCount; i++) {
      const fishType = Math.floor(Math.random() * 24) + 1;
      const routeId = Math.floor(Math.random() * 110) + 1;
      const paytable = FISH_PAYTABLE[fishType] || [2, 5];
      const rate = paytable.length > 1 
        ? Math.floor(Math.random() * (paytable[1] - paytable[0] + 1)) + paytable[0]
        : paytable[0];
      
      const fish = {
        id: this.fishUidCounter,
        uid: this.fishUidCounter++,
        classid: 5,
        fishid: fishType,
        born_time: curTime,
        routeid: routeId,
        dead_time: curTime + 60000,
        offsettype: 0,
        offsetx: 0,
        offsety: 0,
        offsetr: 0,
        rate: rate,
        ext: 0
      };
      this.fish.set(fish.uid, fish);
      fishList.push(fish);

      setTimeout(() => {
        if (this.fish.has(fish.uid)) {
          this.fish.delete(fish.uid);
          this.broadcastAll({
            message: { sprites: [fish.uid] },
            succ: true,
            errinfo: "ok",
            type: "decreasesprites"
          });
        }
      }, 60000);
    }

    this.broadcastAll({
      message: { sprites: fishList },
      succ: true,
      errinfo: "ok",
      type: "increasesprites"
    });
  }

  getPlayersInfo() {
    const players = [];
    this.players.forEach(p => {
      players.push({
        uid: p.uid,
        ws: 0,
        pos: p.pos,
        gunid: p.gunId,
        gunnum: p.gunNum,
        reward_rate: p.rewardRate,
        score: p.score,
        isvistor: p.isVisitor
      });
    });
    return players;
  }

  getFishList() {
    return Array.from(this.fish.values());
  }

  handleFire(ws, msg) {
    const player = this.players.get(ws);
    if (!player) return;

    this.broadcastAll({
      message: {
        type: 3,
        player: {
          uid: player.uid,
          ws: 0,
          pos: player.pos,
          gunid: player.gunId,
          gunnum: player.gunNum,
          reward_rate: player.rewardRate,
          score: player.score,
          isvistor: player.isVisitor
        }
      },
      succ: true,
      errinfo: "ok",
      type: "broadplayer"
    });
  }

  handleHit(ws, msg) {
    const player = this.players.get(ws);
    if (!player) return;

    const bulletId = msg.fblist?.[0]?.bulletid || msg.bulletid || 0;
    const fishIds = msg.fblist?.[0]?.fishids || msg.fishids || [];
    const fishTypes = msg.fblist?.[0]?.fishpids || msg.fishpids || [];
    
    const allbet = player.rewardRate / 100;
    
    if (allbet * 100 > player.score) {
      this.sendToPlayer(ws, {
        message: { error: "invalid balance" },
        succ: false,
        errinfo: "balance_error",
        type: "error"
      });
      return;
    }
    
    const bankSum = allbet / 100 * this.rtpPercent;
    this.bank += bankSum;
    player.score -= Math.round(allbet * 100);
    
    let totalWin = 0;
    const winResults = [];
    let isBomb = 0;
    let isBombId = 0;
    let isBombWin = 0;
    let payRate = 0;

    for (let i = 0; i < fishTypes.length; i++) {
      if (fishTypes[i] === 25) {
        isBombId = fishIds[i];
        isBomb = 1;
        const damage = FISH_DAMAGE[25] || [5];
        isBombWin = Math.floor(Math.random() * damage[0]) + 1 === 1 ? 1 : 0;
        winResults.push({ uid: isBombId, score: 0, rate: 0, ext: 0 });
      }
    }

    for (let i = 0; i < fishIds.length; i++) {
      const fishUid = fishIds[i];
      const fishType = fishTypes[i] || 1;
      
      if (!this.fish.has(fishUid)) continue;
      
      const fish = this.fish.get(fishUid);
      const paytable = FISH_PAYTABLE[fishType] || [2, 5];
      const payRate = paytable.length > 1 
        ? Math.floor(Math.random() * (paytable[1] - paytable[0] + 1)) + paytable[0]
        : paytable[0];

      const damage = FISH_DAMAGE[fishType] || [5];
      let isWin = Math.floor(Math.random() * damage[0]) + 1 === 1;
      
      if (isBomb && isBombWin === 1 && fishUid !== isBombId) {
        isWin = true;
      }

      const potentialWin = payRate * allbet;
      
      if (isWin && totalWin + potentialWin <= this.bank) {
        totalWin += potentialWin;
        winResults.push({
          uid: fishUid,
          score: Math.round(potentialWin * 100),
          rate: payRate,
          ext: 0
        });
        this.fish.delete(fishUid);
        payRate = payRate;
      }
    }

    if (totalWin > 0) {
      this.bank -= totalWin;
      player.score += Math.round(totalWin * 100);

      this.sendToPlayer(ws, {
        message: {
          bulletid: bulletId.toString(),
          pos: player.pos,
          fishes: winResults,
          rate: 1
        },
        succ: true,
        errinfo: "ok",
        type: "hitsprites"
      });

      const caughtUids = winResults.filter(f => f.score > 0).map(f => f.uid);
      if (caughtUids.length > 0) {
        this.broadcastAll({
          message: { sprites: caughtUids },
          succ: true,
          errinfo: "ok",
          type: "decreasesprites"
        });
      }
    }

    this.sendToPlayer(ws, {
      payRate: winResults.length > 0 ? winResults[0].rate : 0,
      isBomb: isBomb,
      message: { money: 0 },
      succ: true,
      errinfo: "ok",
      type: "userinfo"
    });

    this.broadcastAll({
      message: {
        type: 3,
        player: {
          uid: player.uid,
          ws: 0,
          pos: player.pos,
          gunid: player.gunId,
          gunnum: player.gunNum,
          reward_rate: player.rewardRate,
          score: player.score,
          isvistor: player.isVisitor
        }
      },
      succ: true,
      errinfo: "ok",
      type: "broadplayer"
    });
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
      console.error('Error parsing message:', e, 'Data:', data.toString().substring(0, 100));
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
        let playerNickname = msg.nickname || 'Player';
        if (fullMessage.cookie) {
          const match = fullMessage.cookie.match(/playerNickname=([^;]+)/);
          if (match) playerNickname = decodeURIComponent(match[1]);
        }
        
        currentRoom = roomManager.getDefaultRoom();
        currentPlayer = currentRoom.addPlayer(ws, {
          uid: fullMessage.sessionId || Date.now(),
          nickname: playerNickname,
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

      case 'fishRoomTypeInfo':
        const balance = currentPlayer ? currentPlayer.score : 100000;
        currentRoom?.sendToPlayer(ws, {
          Code: 20000,
          Message: "Success",
          Data: {
            roomTypeInfo: {
              money: balance,
              limit: [
                { roomtype: 0, limitBalance: 1000 },
                { roomtype: 1, limitBalance: 10000 },
                { roomtype: 2, limitBalance: 50000 }
              ]
            },
            fishRoomMod: 1
          }
        });
        break;

      case 'quickenterroom':
        const roomType = msg.roomtype || 0;
        currentRoom = roomManager.getRoom(roomType);
        
        if (!currentPlayer) {
          currentPlayer = currentRoom.addPlayer(ws, {
            uid: fullMessage.sessionId || Date.now(),
            score: 100000
          });
        }
        
        if (currentPlayer) {
          currentPlayer.rewardRate = currentRoom.roomConfig.defaultBet;
          currentRoom.startSpawning();
          
          const players = currentRoom.getPlayersInfo();
          const fishList = currentRoom.getFishList();
          const feathers = generateFeathers();
          
          currentRoom.sendToPlayer(ws, {
            message: {
              result: 1,
              roompos: 3,
              scenestate: 5,
              sceneid: currentRoom.sceneId,
              scene_etime: currentRoom.sceneETime,
              scene_btime: currentRoom.sceneBTime,
              players: players,
              sprites: fishList,
              bullets: [],
              min: currentRoom.roomConfig.min,
              max: currentRoom.roomConfig.max,
              coinrate: 1000,
              bombs: [],
              feathers: feathers
            },
            succ: true,
            errinfo: "ok",
            type: "quickenterroom"
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

      case 'enterroom':
        if (currentRoom && currentPlayer) {
          currentRoom.startSpawning();
          
          const players = currentRoom.getPlayersInfo();
          const fishList = currentRoom.getFishList();
          
          currentRoom.sendToPlayer(ws, {
            message: {
              result: 1,
              roompos: 3,
              scenestate: 5,
              sceneid: currentRoom.sceneId,
              scene_etime: currentRoom.sceneETime,
              scene_btime: currentRoom.sceneBTime,
              players: players,
              sprites: fishList,
              bullets: [],
              min: currentRoom.roomConfig.min,
              max: currentRoom.roomConfig.max,
              coinrate: 1000,
              bombs: [],
              feathers: []
            },
            succ: true,
            errinfo: "ok",
            type: "enterroom"
          });
        }
        break;

      case 'fire':
        if (currentRoom) {
          currentRoom.handleFire(ws, msg);
        }
        break;

      case 'hit':
        if (currentRoom) {
          currentRoom.handleHit(ws, msg);
        }
        break;

      case 'changerate':
        if (currentPlayer && currentRoom) {
          const newRate = msg.rewardrate || msg.rate || 1;
          currentPlayer.rewardRate = Math.max(
            currentRoom.roomConfig.min,
            Math.min(currentRoom.roomConfig.max, newRate)
          );
          
          currentRoom.sendToPlayer(ws, {
            type: "changerate",
            message: { rewardrate: currentPlayer.rewardRate }
          });
          
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
        }
        break;

      case 'changelocking':
        if (currentPlayer && currentRoom) {
          currentRoom.sendToPlayer(ws, {
            message: { pos: currentPlayer.pos, fishid: msg.fishid },
            succ: true,
            errinfo: "ok",
            type: "changelock"
          });
          
          currentRoom.broadcast({
            message: { pos: currentPlayer.pos, fishid: msg.fishid },
            succ: true,
            errinfo: "ok",
            type: "changelock"
          }, ws);
        }
        break;

      case 'changbackstage':
        if (currentPlayer && currentRoom) {
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
          
          currentRoom.sendToPlayer(ws, {
            message: {
              sceneid: currentRoom.sceneId,
              state: 0,
              servtime: curTime
            },
            succ: true,
            errinfo: "ok",
            type: "changescene"
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
        console.log('Unknown message type:', type, msg);
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

function generateFeathers() {
  const feathers = [];
  for (let i = 0; i < 50; i++) {
    feathers.push({
      k: Math.floor(Math.random() * 10000) + 1,
      v: Math.floor(Math.random() * 4) + 1
    });
  }
  return feathers;
}

const PORT = process.env.PORT || 5000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Multiplayer game server running on port ${PORT}`);
  console.log(`WebSocket endpoint: ws://0.0.0.0:${PORT}/websocket`);
});
