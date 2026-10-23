/**
 * Classic Pong – HTTP + WebSocket server
 */

const WebSocket = require('ws');
const http = require('http');
const path = require('path');
const fs = require('fs');
const { URL } = require('url');

const { PongGame } = require('./game');

const PORT = process.env.PORT || 8080;
const TICK_MS = 16;

const lobbies = new Map();
let playerIdCounter = 0;

function generatePin() {
  return String(Math.floor(1000 + Math.random() * 9000));
}

function sendTo(client, type, data) {
  if (client && client.readyState === WebSocket.OPEN) {
    client.send(JSON.stringify({ type, data }));
  }
}

function broadcastToLobby(pin, message) {
  const lobby = lobbies.get(pin);
  if (!lobby) return;
  const msg = typeof message === 'string' ? message : JSON.stringify(message);
  lobby.clients.forEach((ws) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(msg);
  });
}

function getLobbyList() {
  return [...lobbies.entries()].map(([pin, lobby]) => ({
    pin,
    mode: lobby.game.mode,
    playerCount: lobby.game.paddleCount(),
    spectatorCount: Math.max(
      0,
      Object.values(lobby.game.players).filter((p) => p.isSpectator).length
    ),
    clientCount: lobby.clients.size + (lobby.controllerPlayers?.size || 0),
    gameState: lobby.game.gameState,
    aiEnabled: !!lobby.game.aiEnabled,
    aiDifficulty: lobby.game.aiDifficulty || null,
    createdAt: lobby.createdAt,
  }));
}

function getOpenLobbyList() {
  return getLobbyList().filter((l) => l.gameState === 'waiting');
}

function createLobbyEntry(pin, mode = 'classic', opts = {}) {
  const game = new PongGame(mode);
  if (opts.ai) {
    game.enableAi(opts.aiDifficulty || 'medium');
  }
  const entry = {
    game,
    clients: new Set(),
    controllerPlayers: new Map(),
    createdAt: Date.now(),
    tickInterval: null,
  };
  lobbies.set(pin, entry);
  return entry;
}

function createLobbyWithOptions({ pin: reqPin, mode: reqMode, ai, aiDifficulty } = {}) {
  let pin = reqPin ? String(reqPin).trim().slice(0, 8) : generatePin();
  if (!reqPin) {
    let attempts = 0;
    while (lobbies.has(pin) && attempts < 20) {
      pin = generatePin();
      attempts++;
    }
  }
  if (lobbies.has(pin)) {
    return { error: 'PIN eksisterer allerede', pin, conflict: true };
  }
  const mode = reqMode === 'arcade' ? 'arcade' : 'classic';
  createLobbyEntry(pin, mode, { ai: !!ai, aiDifficulty });
  return {
    pin,
    mode,
    aiEnabled: !!ai,
    aiDifficulty: ai ? aiDifficulty || 'medium' : null,
  };
}

function endLobby(pin) {
  const lobby = lobbies.get(pin);
  if (!lobby) return false;
  stopLobbyTick(lobby);
  lobby.clients.forEach((ws) => {
    sendTo(ws, 'lobbyEnded', { pin });
  });
  lobbies.delete(pin);
  return true;
}

function startLobbyTick(pin) {
  const lobby = lobbies.get(pin);
  if (!lobby || lobby.tickInterval) return;
  lobby.tickInterval = setInterval(() => {
    const lb = lobbies.get(pin);
    if (!lb || lb.game.gameState !== 'playing') {
      if (lb?.game.gameState === 'finished') {
        broadcastToLobby(pin, { type: 'state', data: lb.game.getState() });
      }
      stopLobbyTick(lb);
      return;
    }
    lb.game.tick();
    broadcastToLobby(pin, { type: 'state', data: lb.game.getState() });
    if (lb.game.gameState === 'finished') {
      stopLobbyTick(lb);
    }
  }, TICK_MS);
}

function stopLobbyTick(lobby) {
  if (lobby?.tickInterval) {
    clearInterval(lobby.tickInterval);
    lobby.tickInterval = null;
  }
}

function applyPaddleInput(pin, playerId, direction) {
  const lobby = lobbies.get(pin);
  if (!lobby) return false;
  if (lobby.game.gameState !== 'playing') return false;
  return lobby.game.setPaddleInput(playerId, direction);
}

function applyControllerAction(pinStr, playerId, action, params) {
  const lobby = lobbies.get(pinStr);
  if (!lobby) return { status: 404, body: { ok: false, error: 'Lobby ikke fundet' } };
  if (!lobby.controllerPlayers?.has(playerId)) {
    return { status: 403, body: { ok: false, error: 'Ugyldig controller' } };
  }

  const resolvedAction = String(action || params?.action || '').toLowerCase();
  if (resolvedAction === 'move') {
    const direction = params?.direction || params?.dir;
    if (!['UP', 'DOWN', 'up', 'down'].includes(direction)) {
      return { status: 400, body: { ok: false, error: 'direction skal være UP eller DOWN' } };
    }
    applyPaddleInput(pinStr, playerId, direction);
  } else if (resolvedAction === 'stop') {
    applyPaddleInput(pinStr, playerId, 'stop');
  } else if (
    resolvedAction === 'wide' ||
    resolvedAction === 'nudge' ||
    resolvedAction === 'smash' ||
    resolvedAction === 'power'
  ) {
    const power =
      resolvedAction === 'power'
        ? String(params?.power || params?.name || '').toLowerCase()
        : resolvedAction;
    if (!['wide', 'nudge', 'smash'].includes(power)) {
      return { status: 400, body: { ok: false, error: 'power skal være wide, nudge eller smash' } };
    }
    if (lobby.game.mode !== 'arcade') {
      return { status: 400, body: { ok: false, error: 'Kun i Arcade-mode' } };
    }
    const ok = lobby.game.usePower(playerId, power);
    if (!ok) {
      return { status: 429, body: { ok: false, error: 'Power på cooldown eller ugyldig' } };
    }
    broadcastToLobby(pinStr, { type: 'state', data: lobby.game.getState() });
  } else {
    return { status: 400, body: { ok: false, error: 'Ukendt action' } };
  }

  return { status: 200, body: { ok: true } };
}

function handleAdminApi(req, res) {
  const parsed = new URL(req.url, `http://localhost:${PORT}`);
  const pathname = parsed.pathname;

  res.setHeader('Content-Type', 'application/json');

  if (pathname === '/api/admin/lobbies' && req.method === 'GET') {
    res.writeHead(200);
    res.end(JSON.stringify({ lobbies: getLobbyList() }));
    return;
  }

  if (pathname === '/api/admin/lobbies' && req.method === 'POST') {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => {
      try {
        const created = createLobbyWithOptions(JSON.parse(body || '{}'));
        if (created.error) {
          res.writeHead(created.conflict ? 409 : 400);
          res.end(JSON.stringify({ error: created.error, pin: created.pin }));
          return;
        }
        res.writeHead(201);
        res.end(JSON.stringify(created));
      } catch (e) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: 'Ugyldig forespørgsel' }));
      }
    });
    return;
  }

  const deleteMatch = pathname.match(/^\/api\/admin\/lobbies\/([^/]+)$/);
  if (deleteMatch && req.method === 'DELETE') {
    const pin = deleteMatch[1];
    if (endLobby(pin)) {
      res.writeHead(200);
      res.end(JSON.stringify({ success: true, pin }));
    } else {
      res.writeHead(404);
      res.end(JSON.stringify({ error: 'Lobby ikke fundet', pin }));
    }
    return;
  }

  res.writeHead(404);
  res.end(JSON.stringify({ error: 'Not found' }));
}

function handleControllerApi(req, res) {
  const parsed = new URL(req.url, `http://localhost:${PORT}`);
  const pathname = parsed.pathname;
  res.setHeader('Content-Type', 'application/json');

  if (pathname === '/api/controller/join' && req.method === 'POST') {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => {
      try {
        const { pin, name, deviceId } = JSON.parse(body || '{}');
        const pinStr = String(pin || '').trim();
        const lobby = lobbies.get(pinStr);
        if (!lobby) {
          res.writeHead(404);
          res.end(JSON.stringify({ ok: false, error: 'Ugyldig eller ukendt PIN' }));
          return;
        }

        const playerId = `player_${++playerIdCounter}`;
        const displayName = name ? String(name).trim().slice(0, 20) : `Arduino ${playerIdCounter}`;
        const player = lobby.game.addPlayer(playerId, displayName);
        if (!lobby.controllerPlayers) lobby.controllerPlayers = new Map();
        lobby.controllerPlayers.set(playerId, {
          name: displayName,
          deviceId: deviceId ? String(deviceId).trim().slice(0, 40) : null,
          side: player.side,
        });
        broadcastToLobby(pinStr, { type: 'state', data: lobby.game.getState() });
        res.writeHead(200);
        res.end(JSON.stringify({ ok: true, playerId, name: displayName, side: player.side }));
      } catch (e) {
        res.writeHead(400);
        res.end(JSON.stringify({ ok: false, error: 'Ugyldig forespørgsel' }));
      }
    });
    return;
  }

  if (pathname === '/api/controller/heartbeat' && req.method === 'POST') {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => {
      try {
        const { pin, playerId } = JSON.parse(body || '{}');
        const pinStr = String(pin || '').trim();
        const lobby = lobbies.get(pinStr);
        if (!lobby) {
          res.writeHead(404);
          res.end(JSON.stringify({ ok: false, error: 'Lobby ikke fundet' }));
          return;
        }
        if (playerId && !lobby.controllerPlayers?.has(playerId)) {
          res.writeHead(403);
          res.end(JSON.stringify({ ok: false, error: 'Ugyldig controller' }));
          return;
        }
        res.writeHead(200);
        res.end(JSON.stringify({ ok: true }));
      } catch (e) {
        res.writeHead(400);
        res.end(JSON.stringify({ ok: false, error: 'Ugyldig forespørgsel' }));
      }
    });
    return;
  }

  if (pathname === '/api/controller/action' && req.method === 'POST') {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => {
      try {
        const { pin, playerId, action, params } = JSON.parse(body || '{}');
        const pinStr = String(pin || '').trim();
        const result = applyControllerAction(pinStr, playerId, action, params || {});
        res.writeHead(result.status);
        res.end(JSON.stringify(result.body));
      } catch (e) {
        res.writeHead(400);
        res.end(JSON.stringify({ ok: false, error: 'Ugyldig forespørgsel' }));
      }
    });
    return;
  }

  res.writeHead(404);
  res.end(JSON.stringify({ ok: false, error: 'Not found' }));
}

function setCorsHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function handlePublicLobbyApi(req, res) {
  const parsed = new URL(req.url, `http://localhost:${PORT}`);
  const pathname = parsed.pathname;
  res.setHeader('Content-Type', 'application/json');

  if (pathname === '/api/lobbies' && req.method === 'GET') {
    res.writeHead(200);
    res.end(JSON.stringify({ lobbies: getOpenLobbyList() }));
    return;
  }

  if (pathname === '/api/lobbies' && req.method === 'POST') {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => {
      try {
        const created = createLobbyWithOptions(JSON.parse(body || '{}'));
        if (created.error) {
          res.writeHead(created.conflict ? 409 : 400);
          res.end(JSON.stringify({ error: created.error, pin: created.pin }));
          return;
        }
        res.writeHead(201);
        res.end(JSON.stringify(created));
      } catch (e) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: 'Ugyldig forespørgsel' }));
      }
    });
    return;
  }

  res.writeHead(404);
  res.end(JSON.stringify({ error: 'Not found' }));
}

function attachClientToLobby(ws, pin, name) {
  const lobby = lobbies.get(pin);
  if (!lobby) {
    sendTo(ws, 'error', { message: 'Ugyldig eller ukendt PIN' });
    return false;
  }
  const playerId = `player_${++playerIdCounter}`;
  ws.playerId = playerId;
  ws.lobbyPin = pin;
  const player = lobby.game.addPlayer(playerId, name || null);
  lobby.clients.add(ws);
  sendTo(ws, 'joined', { playerId, pin, side: player.side, state: lobby.game.getState() });
  broadcastToLobby(pin, { type: 'state', data: lobby.game.getState() });
  return true;
}

const server = http.createServer((req, res) => {
  setCorsHeaders(res);

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.url && req.url.startsWith('/api/admin/')) {
    handleAdminApi(req, res);
    return;
  }

  if (req.url && (req.url.split('?')[0] === '/api/lobbies' || req.url.startsWith('/api/lobbies?'))) {
    handlePublicLobbyApi(req, res);
    return;
  }

  if (req.url && req.url.startsWith('/api/controller/')) {
    handleControllerApi(req, res);
    return;
  }

  const healthPath = (req.url || '').split('?')[0];
  if (healthPath === '/api/health' && req.method === 'GET') {
    res.setHeader('Content-Type', 'application/json');
    res.writeHead(200);
    res.end(JSON.stringify({ ok: true, service: 'pong' }));
    return;
  }

  let rawUrl = req.url || '/';
  const q = rawUrl.indexOf('?');
  if (q !== -1) rawUrl = rawUrl.slice(0, q);
  let filePath = rawUrl === '/' || rawUrl === '' ? '/index.html' : rawUrl;
  filePath = path.join(__dirname, '..', 'public', filePath);

  const ext = path.extname(filePath);
  const contentTypes = {
    '.html': 'text/html',
    '.css': 'text/css',
    '.js': 'application/javascript',
    '.ico': 'image/x-icon',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
  };

  fs.readFile(filePath, (err, data) => {
    if (err) {
      if (err.code === 'ENOENT') {
        res.writeHead(404);
        res.end('Not found');
      } else {
        res.writeHead(500);
        res.end('Server error');
      }
      return;
    }
    const headers = { 'Content-Type': contentTypes[ext] || 'text/plain' };
    if (ext === '.html') {
      headers['Cache-Control'] = 'no-cache';
    } else if (ext === '.css' || ext === '.js') {
      headers['Cache-Control'] = 'public, max-age=60';
    }
    res.writeHead(200, headers);
    res.end(data);
  });
});

const wss = new WebSocket.Server({
  server,
  verifyClient: () => true,
});

wss.on('connection', (ws) => {
  ws.playerId = null;
  ws.lobbyPin = null;

  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw.toString());
      const type = msg.type;

      if (type === 'createLobby') {
        const created = createLobbyWithOptions({
          pin: msg.pin,
          mode: msg.mode,
          ai: msg.ai,
          aiDifficulty: msg.aiDifficulty,
        });
        if (created.error) {
          sendTo(ws, 'error', { message: created.error });
          return;
        }
        sendTo(ws, 'lobbyCreated', created);
        return;
      }

      if (!ws.lobbyPin) {
        if (type === 'joinLobby' || type === 'join') {
          const pin = String(msg.pin || '').trim();
          const name = msg.name ? String(msg.name).trim().slice(0, 20) : null;
          attachClientToLobby(ws, pin, name);
        }
        return;
      }

      const pin = ws.lobbyPin;
      const lobby = lobbies.get(pin);
      if (!lobby) return;
      const game = lobby.game;

      switch (type) {
        case 'start':
          if (game.gameState === 'waiting' && game.start()) {
            startLobbyTick(pin);
            broadcastToLobby(pin, { type: 'state', data: game.getState() });
          }
          break;
        case 'reset':
          if (game.gameState === 'finished' || game.gameState === 'waiting') {
            stopLobbyTick(lobby);
            game.reset(true);
            broadcastToLobby(pin, { type: 'state', data: game.getState() });
          }
          break;
        case 'paddle': {
          const dir = msg.direction || msg.action || msg.data?.direction;
          if (ws.playerId && dir) {
            applyPaddleInput(pin, ws.playerId, dir);
          }
          break;
        }
        case 'setMode': {
          const mode = msg.mode === 'arcade' ? 'arcade' : 'classic';
          if (game.setMode(mode)) {
            broadcastToLobby(pin, { type: 'state', data: game.getState() });
          }
          break;
        }
        case 'enableAi': {
          if (game.gameState === 'waiting' && game.enableAi(msg.difficulty || msg.aiDifficulty || 'medium')) {
            broadcastToLobby(pin, { type: 'state', data: game.getState() });
          }
          break;
        }
        case 'disableAi': {
          if (game.gameState === 'waiting' && game.disableAi()) {
            broadcastToLobby(pin, { type: 'state', data: game.getState() });
          }
          break;
        }
        case 'power': {
          const power = msg.power || msg.name || msg.action;
          if (ws.playerId && power) {
            game.usePower(ws.playerId, power);
            broadcastToLobby(pin, { type: 'state', data: game.getState() });
          }
          break;
        }
        default:
          break;
      }
    } catch (e) {
      // ignore malformed messages
    }
  });

  ws.on('close', () => {
    if (ws.lobbyPin) {
      const lobby = lobbies.get(ws.lobbyPin);
      if (lobby) {
        lobby.clients.delete(ws);
        if (ws.playerId) lobby.game.removePlayer(ws.playerId);
        broadcastToLobby(ws.lobbyPin, { type: 'state', data: lobby.game.getState() });
        const ctrlSize = lobby.controllerPlayers?.size || 0;
        if (lobby.clients.size === 0 && ctrlSize === 0) {
          stopLobbyTick(lobby);
          lobbies.delete(ws.lobbyPin);
        }
      }
    }
  });

  ws.on('error', () => {
    if (ws.lobbyPin) {
      const lobby = lobbies.get(ws.lobbyPin);
      if (lobby) {
        lobby.clients.delete(ws);
        if (ws.playerId) lobby.game.removePlayer(ws.playerId);
        broadcastToLobby(ws.lobbyPin, { type: 'state', data: lobby.game.getState() });
      }
    }
  });
});

server.listen(PORT, () => {
  console.log(`Classic Pong: http://localhost:${PORT}`);
  console.log(`Admin: http://localhost:${PORT}/admin.html`);
});
