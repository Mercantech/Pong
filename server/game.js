/**
 * Classic Pong – server-authoritative 2-player lobby game
 */

const WIN_SCORE = 11;

const COURT_W = 800;
const COURT_H = 600;
const PADDLE_W = 12;
const PADDLE_H = 100;
const PADDLE_MARGIN = 24;
const PADDLE_SPEED = 420;
const BALL_R = 8;
const BALL_SPEED = 320;

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function createPlayer(id, name, side) {
  const isSpectator = side === 'spectator';
  const paddleY = (COURT_H - PADDLE_H) / 2;
  return {
    id,
    name,
    side,
    isSpectator,
    paddleY,
    velocity: 0,
  };
}

function resetBall(towardLeft = false) {
  const angle = (Math.random() * 0.6 - 0.3) * Math.PI;
  const dir = towardLeft ? Math.PI : 0;
  const vx = Math.cos(angle + dir) * BALL_SPEED;
  const vy = Math.sin(angle + dir) * BALL_SPEED;
  const sign = Math.random() > 0.5 ? 1 : -1;
  return {
    x: COURT_W / 2,
    y: COURT_H / 2,
    vx: vx || (towardLeft ? -BALL_SPEED : BALL_SPEED),
    vy: vy * sign * 0.5 || sign * BALL_SPEED * 0.35,
  };
}

class PongGame {
  constructor() {
    this.players = new Map();
    this.leftPlayerId = null;
    this.rightPlayerId = null;
    this.gameState = 'waiting';
    this.scoreLeft = 0;
    this.scoreRight = 0;
    this.winnerSide = null;
    this.winnerName = null;
    this.ball = resetBall(Math.random() > 0.5);
    this._lastTick = Date.now();
    this.serveLeft = true;
  }

  _paddlePlayerCount() {
    let n = 0;
    if (this.leftPlayerId) n++;
    if (this.rightPlayerId) n++;
    return n;
  }

  _assignSide() {
    if (!this.leftPlayerId) return 'left';
    if (!this.rightPlayerId) return 'right';
    return 'spectator';
  }

  addPlayer(id, name) {
    const side = this._assignSide();
    const displayName = name ? String(name).trim().slice(0, 20) : `Spiller ${this.players.size + 1}`;
    const p = createPlayer(id, displayName, side);
    this.players.set(id, p);
    if (side === 'left') this.leftPlayerId = id;
    else if (side === 'right') this.rightPlayerId = id;
    return p;
  }

  removePlayer(id) {
    const p = this.players.get(id);
    if (!p) return;
    if (this.leftPlayerId === id) this.leftPlayerId = null;
    if (this.rightPlayerId === id) this.rightPlayerId = null;
    this.players.delete(id);
    if (this.gameState === 'playing') {
      this._checkWinByForfeit();
    }
  }

  getPlayerSide(id) {
    const p = this.players.get(id);
    return p ? p.side : null;
  }

  setPaddleInput(id, direction) {
    const p = this.players.get(id);
    if (!p || p.isSpectator) return false;
    if (direction === 'UP' || direction === 'up') {
      p.velocity = -PADDLE_SPEED;
    } else if (direction === 'DOWN' || direction === 'down') {
      p.velocity = PADDLE_SPEED;
    } else if (direction === 'stop' || direction === 'STOP') {
      p.velocity = 0;
    } else {
      return false;
    }
    return true;
  }

  start() {
    if (this._paddlePlayerCount() < 2) return false;
    this.reset(false);
    this.gameState = 'playing';
    this._lastTick = Date.now();
    return true;
  }

  reset(clearPlayers = true) {
    this.scoreLeft = 0;
    this.scoreRight = 0;
    this.winnerSide = null;
    this.winnerName = null;
    this.gameState = 'waiting';
    this.serveLeft = Math.random() > 0.5;
    this.ball = resetBall(!this.serveLeft);
    if (clearPlayers) {
      for (const p of this.players.values()) {
        p.paddleY = (COURT_H - PADDLE_H) / 2;
        p.velocity = 0;
      }
    } else {
      for (const p of this.players.values()) {
        p.paddleY = (COURT_H - PADDLE_H) / 2;
        p.velocity = 0;
      }
    }
  }

  _checkWinByForfeit() {
    if (this._paddlePlayerCount() < 2 && this.gameState === 'playing') {
      this.gameState = 'finished';
      if (this.leftPlayerId && !this.rightPlayerId) {
        this.winnerSide = 'left';
        this.winnerName = this.players.get(this.leftPlayerId)?.name || 'Venstre';
      } else if (this.rightPlayerId && !this.leftPlayerId) {
        this.winnerSide = 'right';
        this.winnerName = this.players.get(this.rightPlayerId)?.name || 'Højre';
      }
    }
  }

  _checkWinScore() {
    if (this.scoreLeft >= WIN_SCORE) {
      this.gameState = 'finished';
      this.winnerSide = 'left';
      this.winnerName = this.players.get(this.leftPlayerId)?.name || 'Venstre';
      return true;
    }
    if (this.scoreRight >= WIN_SCORE) {
      this.gameState = 'finished';
      this.winnerSide = 'right';
      this.winnerName = this.players.get(this.rightPlayerId)?.name || 'Højre';
      return true;
    }
    return false;
  }

  tick() {
    if (this.gameState !== 'playing') return;

    const now = Date.now();
    const dt = Math.min(0.05, (now - this._lastTick) / 1000);
    this._lastTick = now;

    for (const id of [this.leftPlayerId, this.rightPlayerId]) {
      if (!id) continue;
      const p = this.players.get(id);
      if (!p) continue;
      p.paddleY = clamp(p.paddleY + p.velocity * dt, 0, COURT_H - PADDLE_H);
    }

    let { x, y, vx, vy } = this.ball;
    x += vx * dt;
    y += vy * dt;

    if (y - BALL_R <= 0) {
      y = BALL_R;
      vy = Math.abs(vy);
    } else if (y + BALL_R >= COURT_H) {
      y = COURT_H - BALL_R;
      vy = -Math.abs(vy);
    }

    const leftX = PADDLE_MARGIN;
    const rightX = COURT_W - PADDLE_MARGIN - PADDLE_W;

    const hitPaddle = (paddleY, px) => {
      if (x - BALL_R > px + PADDLE_W || x + BALL_R < px) return false;
      const py = paddleY;
      if (y + BALL_R < py || y - BALL_R > py + PADDLE_H) return false;

      const hitPos = (y - (py + PADDLE_H / 2)) / (PADDLE_H / 2);
      const speed = Math.min(BALL_SPEED * 1.15, Math.hypot(vx, vy) * 1.05);
      vx = px < COURT_W / 2 ? Math.abs(vx) : -Math.abs(vx);
      vy = hitPos * speed * 0.85;
      const len = Math.hypot(vx, vy) || 1;
      vx = (vx / len) * speed;
      vy = (vy / len) * speed;
      x = px < COURT_W / 2 ? px + PADDLE_W + BALL_R : px - BALL_R;
      return true;
    };

    if (this.leftPlayerId) {
      const lp = this.players.get(this.leftPlayerId);
      if (lp && vx < 0) hitPaddle(lp.paddleY, leftX);
    }
    if (this.rightPlayerId) {
      const rp = this.players.get(this.rightPlayerId);
      if (rp && vx > 0) hitPaddle(rp.paddleY, rightX);
    }

    if (x + BALL_R < 0) {
      this.scoreRight += 1;
      if (!this._checkWinScore()) {
        this.serveLeft = true;
        this.ball = resetBall(false);
      }
      return;
    }
    if (x - BALL_R > COURT_W) {
      this.scoreLeft += 1;
      if (!this._checkWinScore()) {
        this.serveLeft = false;
        this.ball = resetBall(true);
      }
      return;
    }

    this.ball = { x, y, vx, vy };
  }

  getState() {
    const players = {};
    for (const [id, p] of this.players) {
      players[id] = {
        id: p.id,
        name: p.name,
        side: p.side,
        isSpectator: p.isSpectator,
        paddleY: p.paddleY,
      };
    }
    const leftP = this.leftPlayerId ? this.players.get(this.leftPlayerId) : null;
    const rightP = this.rightPlayerId ? this.players.get(this.rightPlayerId) : null;

    return {
      gameState: this.gameState,
      court: { width: COURT_W, height: COURT_H },
      paddle: { width: PADDLE_W, height: PADDLE_H, margin: PADDLE_MARGIN },
      ball: { ...this.ball, radius: BALL_R },
      scoreLeft: this.scoreLeft,
      scoreRight: this.scoreRight,
      winScore: WIN_SCORE,
      leftPlayerId: this.leftPlayerId,
      rightPlayerId: this.rightPlayerId,
      players,
      playerOrder: [...this.players.keys()],
      winnerSide: this.winnerSide,
      winnerName: this.winnerName,
      paddles: {
        left: leftP ? { y: leftP.paddleY, name: leftP.name } : null,
        right: rightP ? { y: rightP.paddleY, name: rightP.name } : null,
      },
    };
  }
}

module.exports = { PongGame, COURT_W, COURT_H };
