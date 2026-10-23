/**
 * Klassisk Pong + Arcade (WIDE / NUDGE / SMASH) + CPU-modstander.
 */

const COURT_W = 800;
const COURT_H = 450;
const PADDLE_W = 12;
const PADDLE_H = 72;
const PADDLE_MARGIN = 24;
const BALL_R = 8;
const PADDLE_SPEED = 380;
const BALL_SPEED = 320;
const BALL_SPEED_MAX = 560;
const WIN_SCORE = 11;

const WIDE_SCALE = 1.7;
const WIDE_MS = 2800;
const WIDE_CD_MS = 8000;
const NUDGE_CD_MS = 4500;
const SMASH_CD_MS = 7000;
const SMASH_MULT = 1.55;

const AI_ID = 'ai_cpu';

const AI_CFG = {
  easy: { deadzone: 28, error: 52, reactionMs: 220, predict: false, powers: false },
  medium: { deadzone: 14, error: 22, reactionMs: 110, predict: true, powers: false },
  hard: { deadzone: 6, error: 6, reactionMs: 40, predict: true, powers: true },
};

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

class PongGame {
  constructor(mode = 'classic') {
    this.mode = mode === 'arcade' ? 'arcade' : 'classic';
    this.players = {};
    this.leftPlayerId = null;
    this.rightPlayerId = null;
    this.scoreLeft = 0;
    this.scoreRight = 0;
    this.gameState = 'waiting';
    this.winnerSide = null;
    this.winnerName = null;
    this._lastTs = 0;
    this.aiEnabled = false;
    this.aiDifficulty = 'medium';
    this._aiNextThink = 0;
    this._aiOffset = 0;
    this._resetBall(1);
    this.leftY = (COURT_H - PADDLE_H) / 2;
    this.rightY = (COURT_H - PADDLE_H) / 2;
    this.leftDir = 0;
    this.rightDir = 0;
    this._initPowers();
  }

  _initPowers() {
    this.powers = {
      left: {
        wideUntil: 0,
        wideReadyAt: 0,
        nudgeReadyAt: 0,
        smashReadyAt: 0,
        smashArmed: false,
      },
      right: {
        wideUntil: 0,
        wideReadyAt: 0,
        nudgeReadyAt: 0,
        smashReadyAt: 0,
        smashArmed: false,
      },
    };
  }

  setMode(mode) {
    if (this.gameState === 'playing') return false;
    this.mode = mode === 'arcade' ? 'arcade' : 'classic';
    return true;
  }

  enableAi(difficulty = 'medium') {
    if (this.gameState === 'playing') return false;
    if (this.rightPlayerId && this.rightPlayerId !== AI_ID) return false;
    const d = AI_CFG[difficulty] ? difficulty : 'medium';
    this.aiEnabled = true;
    this.aiDifficulty = d;
    this._aiNextThink = 0;
    this._aiOffset = 0;
    if (!this.players[AI_ID]) {
      this.rightPlayerId = AI_ID;
      this.players[AI_ID] = {
        id: AI_ID,
        name: `CPU (${d})`,
        side: 'right',
        isSpectator: false,
        isAi: true,
      };
    } else {
      this.players[AI_ID].name = `CPU (${d})`;
      this.rightPlayerId = AI_ID;
    }
    return true;
  }

  disableAi() {
    if (!this.aiEnabled && !this.players[AI_ID]) return false;
    if (this.gameState === 'playing') return false;
    if (this.players[AI_ID]) {
      delete this.players[AI_ID];
      if (this.rightPlayerId === AI_ID) {
        this.rightPlayerId = null;
        this.rightDir = 0;
      }
    }
    this.aiEnabled = false;
    return true;
  }

  _paddleHeight(side, now = Date.now()) {
    if (this.mode !== 'arcade') return PADDLE_H;
    const p = this.powers[side];
    return now < p.wideUntil ? Math.round(PADDLE_H * WIDE_SCALE) : PADDLE_H;
  }

  _resetBall(dirX = 1) {
    const angle = (Math.random() * 0.6 - 0.3) * Math.PI;
    this.ball = {
      x: COURT_W / 2,
      y: COURT_H / 2,
      vx: Math.cos(angle) * BALL_SPEED * dirX,
      vy: Math.sin(angle) * BALL_SPEED,
    };
  }

  addPlayer(id, name) {
    if (id === AI_ID) return this.players[AI_ID] || null;
    const existing = this.players[id];
    if (existing) return existing;

    let side = null;
    let isSpectator = false;
    if (!this.leftPlayerId) {
      side = 'left';
      this.leftPlayerId = id;
    } else if (!this.rightPlayerId) {
      side = 'right';
      this.rightPlayerId = id;
    } else {
      isSpectator = true;
    }

    const player = {
      id,
      name: name || `Spiller ${Object.keys(this.players).length + 1}`,
      side,
      isSpectator,
      isAi: false,
    };
    this.players[id] = player;
    return player;
  }

  removePlayer(id) {
    if (id === AI_ID) {
      this.disableAi();
      return;
    }
    const p = this.players[id];
    if (!p) return;
    if (this.leftPlayerId === id) {
      this.leftPlayerId = null;
      this.leftDir = 0;
    }
    if (this.rightPlayerId === id) {
      this.rightPlayerId = null;
      this.rightDir = 0;
    }
    delete this.players[id];
    if (this.gameState === 'playing' && !p.isSpectator) {
      this.gameState = 'finished';
      this.winnerSide = null;
      this.winnerName = null;
    }
  }

  setPaddleInput(playerId, direction) {
    if (playerId === AI_ID) return false;
    const p = this.players[playerId];
    if (!p || p.isSpectator || !p.side) return false;
    const d = String(direction || '').toLowerCase();
    let dir = 0;
    if (d === 'up') dir = -1;
    else if (d === 'down') dir = 1;
    else dir = 0;
    if (p.side === 'left') this.leftDir = dir;
    else this.rightDir = dir;
    return true;
  }

  usePower(playerId, power) {
    if (this.mode !== 'arcade' || this.gameState !== 'playing') return false;
    const p = this.players[playerId];
    if (!p || p.isSpectator || !p.side) return false;
    const now = Date.now();
    const side = p.side;
    const pow = this.powers[side];
    const key = String(power || '').toLowerCase();

    if (key === 'wide' || key === 'power_wide' || key === '1') {
      if (now < pow.wideReadyAt) return false;
      pow.wideUntil = now + WIDE_MS;
      pow.wideReadyAt = now + WIDE_CD_MS;
      const h = this._paddleHeight(side, now);
      if (side === 'left') this.leftY = clamp(this.leftY, 0, COURT_H - h);
      else this.rightY = clamp(this.rightY, 0, COURT_H - h);
      return true;
    }

    if (key === 'nudge' || key === 'power_nudge' || key === '3') {
      if (now < pow.nudgeReadyAt) return false;
      const h = this._paddleHeight(side, now);
      const target = this.ball.y - h / 2;
      if (side === 'left') this.leftY = clamp(target, 0, COURT_H - h);
      else this.rightY = clamp(target, 0, COURT_H - h);
      pow.nudgeReadyAt = now + NUDGE_CD_MS;
      return true;
    }

    if (key === 'smash' || key === 'power_smash' || key === '4') {
      if (now < pow.smashReadyAt || pow.smashArmed) return false;
      pow.smashArmed = true;
      pow.smashReadyAt = now + SMASH_CD_MS;
      return true;
    }

    return false;
  }

  start() {
    if (this.gameState === 'playing') return false;
    if (!this.leftPlayerId || !this.rightPlayerId) return false;
    this.scoreLeft = 0;
    this.scoreRight = 0;
    this.winnerSide = null;
    this.winnerName = null;
    this.leftY = (COURT_H - PADDLE_H) / 2;
    this.rightY = (COURT_H - PADDLE_H) / 2;
    this.leftDir = 0;
    this.rightDir = 0;
    this._initPowers();
    this._aiNextThink = 0;
    this._resetBall(Math.random() < 0.5 ? -1 : 1);
    this.gameState = 'playing';
    this._lastTs = Date.now();
    return true;
  }

  reset(keepPlayers = true) {
    this.scoreLeft = 0;
    this.scoreRight = 0;
    this.winnerSide = null;
    this.winnerName = null;
    this.gameState = 'waiting';
    this.leftY = (COURT_H - PADDLE_H) / 2;
    this.rightY = (COURT_H - PADDLE_H) / 2;
    this.leftDir = 0;
    this.rightDir = 0;
    this._initPowers();
    this._resetBall(1);
    if (!keepPlayers) {
      const aiWas = this.aiEnabled;
      const aiDiff = this.aiDifficulty;
      this.players = {};
      this.leftPlayerId = null;
      this.rightPlayerId = null;
      this.aiEnabled = false;
      if (aiWas) this.enableAi(aiDiff);
    }
  }

  _predictBallY(targetX) {
    let x = this.ball.x;
    let y = this.ball.y;
    let vx = this.ball.vx;
    let vy = this.ball.vy;
    if (vx <= 0) return this.ball.y;
    let guard = 0;
    while (x < targetX && guard++ < 400) {
      const dt = 0.012;
      x += vx * dt;
      y += vy * dt;
      if (y - BALL_R <= 0) {
        y = BALL_R;
        vy = Math.abs(vy);
      } else if (y + BALL_R >= COURT_H) {
        y = COURT_H - BALL_R;
        vy = -Math.abs(vy);
      }
    }
    return y;
  }

  _updateAi(now) {
    if (!this.aiEnabled || this.rightPlayerId !== AI_ID) return;
    const cfg = AI_CFG[this.aiDifficulty] || AI_CFG.medium;
    const rightH = this._paddleHeight('right', now);
    const center = this.rightY + rightH / 2;

    if (now < this._aiNextThink) return;
    this._aiNextThink = now + cfg.reactionMs;
    this._aiOffset = (Math.random() - 0.5) * 2 * cfg.error;

    const rightX = COURT_W - PADDLE_MARGIN - PADDLE_W;
    let targetY;
    if (this.ball.vx > 0) {
      targetY = cfg.predict ? this._predictBallY(rightX) : this.ball.y;
    } else {
      targetY = COURT_H / 2;
    }
    targetY += this._aiOffset;

    if (center < targetY - cfg.deadzone) this.rightDir = 1;
    else if (center > targetY + cfg.deadzone) this.rightDir = -1;
    else this.rightDir = 0;

    if (cfg.powers && this.mode === 'arcade' && this.ball.vx > 0) {
      const dist = rightX - this.ball.x;
      if (dist < 220 && Math.random() < 0.04) this.usePower(AI_ID, 'smash');
      if (dist < 160 && Math.abs(center - targetY) > 40 && Math.random() < 0.03) {
        this.usePower(AI_ID, 'nudge');
      }
      if (Math.random() < 0.008) this.usePower(AI_ID, 'wide');
    }
  }

  tick() {
    if (this.gameState !== 'playing') return;
    const now = Date.now();
    const dt = Math.min(0.05, (now - this._lastTs) / 1000);
    this._lastTs = now;

    this._updateAi(now);

    const leftH = this._paddleHeight('left', now);
    const rightH = this._paddleHeight('right', now);

    this.leftY = clamp(this.leftY + this.leftDir * PADDLE_SPEED * dt, 0, COURT_H - leftH);
    this.rightY = clamp(this.rightY + this.rightDir * PADDLE_SPEED * dt, 0, COURT_H - rightH);

    this.ball.x += this.ball.vx * dt;
    this.ball.y += this.ball.vy * dt;

    if (this.ball.y - BALL_R <= 0) {
      this.ball.y = BALL_R;
      this.ball.vy = Math.abs(this.ball.vy);
    } else if (this.ball.y + BALL_R >= COURT_H) {
      this.ball.y = COURT_H - BALL_R;
      this.ball.vy = -Math.abs(this.ball.vy);
    }

    const leftX = PADDLE_MARGIN;
    if (
      this.ball.vx < 0 &&
      this.ball.x - BALL_R <= leftX + PADDLE_W &&
      this.ball.x + BALL_R >= leftX &&
      this.ball.y + BALL_R >= this.leftY &&
      this.ball.y - BALL_R <= this.leftY + leftH
    ) {
      this.ball.x = leftX + PADDLE_W + BALL_R;
      this._bounceFromPaddle('left', leftH, now);
    }

    const rightX = COURT_W - PADDLE_MARGIN - PADDLE_W;
    if (
      this.ball.vx > 0 &&
      this.ball.x + BALL_R >= rightX &&
      this.ball.x - BALL_R <= rightX + PADDLE_W &&
      this.ball.y + BALL_R >= this.rightY &&
      this.ball.y - BALL_R <= this.rightY + rightH
    ) {
      this.ball.x = rightX - BALL_R;
      this._bounceFromPaddle('right', rightH, now);
    }

    if (this.ball.x + BALL_R < 0) {
      this.scoreRight += 1;
      this._afterPoint(-1);
    } else if (this.ball.x - BALL_R > COURT_W) {
      this.scoreLeft += 1;
      this._afterPoint(1);
    }
  }

  _bounceFromPaddle(side, paddleH, now) {
    const y = side === 'left' ? this.leftY : this.rightY;
    const rel = (this.ball.y - (y + paddleH / 2)) / (paddleH / 2);
    const angle = clamp(rel, -1, 1) * (Math.PI / 3);
    let speed = Math.min(
      BALL_SPEED_MAX,
      Math.hypot(this.ball.vx, this.ball.vy) * 1.05
    );
    const pow = this.powers[side];
    if (this.mode === 'arcade' && pow.smashArmed) {
      speed = Math.min(BALL_SPEED_MAX * 1.15, speed * SMASH_MULT);
      pow.smashArmed = false;
    }
    const dir = side === 'left' ? 1 : -1;
    this.ball.vx = Math.cos(angle) * speed * dir;
    this.ball.vy = Math.sin(angle) * speed;
  }

  _afterPoint(serveDir) {
    if (this.scoreLeft >= WIN_SCORE || this.scoreRight >= WIN_SCORE) {
      this.gameState = 'finished';
      this.winnerSide = this.scoreLeft > this.scoreRight ? 'left' : 'right';
      const wid = this.winnerSide === 'left' ? this.leftPlayerId : this.rightPlayerId;
      this.winnerName = wid && this.players[wid] ? this.players[wid].name : null;
      return;
    }
    this._resetBall(serveDir);
  }

  _powerView(side, now) {
    const p = this.powers[side];
    return {
      wideActive: now < p.wideUntil,
      wideMs: Math.max(0, p.wideUntil - now),
      wideCdMs: Math.max(0, p.wideReadyAt - now),
      nudgeCdMs: Math.max(0, p.nudgeReadyAt - now),
      smashCdMs: Math.max(0, p.smashReadyAt - now),
      smashArmed: p.smashArmed,
      height: this._paddleHeight(side, now),
    };
  }

  paddleCount() {
    return (this.leftPlayerId ? 1 : 0) + (this.rightPlayerId ? 1 : 0);
  }

  getState() {
    const now = Date.now();
    const leftH = this._paddleHeight('left', now);
    const rightH = this._paddleHeight('right', now);
    return {
      mode: this.mode,
      court: { width: COURT_W, height: COURT_H },
      paddle: { width: PADDLE_W, height: PADDLE_H, margin: PADDLE_MARGIN },
      paddles: {
        left: {
          y: this.leftY,
          height: leftH,
          name: this.leftPlayerId ? this.players[this.leftPlayerId]?.name : null,
        },
        right: {
          y: this.rightY,
          height: rightH,
          name: this.rightPlayerId ? this.players[this.rightPlayerId]?.name : null,
        },
      },
      powers:
        this.mode === 'arcade'
          ? {
              left: this._powerView('left', now),
              right: this._powerView('right', now),
            }
          : null,
      ball: { ...this.ball, radius: BALL_R },
      scoreLeft: this.scoreLeft,
      scoreRight: this.scoreRight,
      winScore: WIN_SCORE,
      gameState: this.gameState,
      winnerSide: this.winnerSide,
      winnerName: this.winnerName,
      players: this.players,
      leftPlayerId: this.leftPlayerId,
      rightPlayerId: this.rightPlayerId,
      aiEnabled: this.aiEnabled,
      aiDifficulty: this.aiDifficulty,
    };
  }
}

module.exports = { PongGame, COURT_W, COURT_H, AI_ID };
