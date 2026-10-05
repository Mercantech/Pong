(function () {
  const pathMatch = location.pathname.match(/^(\/Pong)(?=\/|$)/i);
  const BASE = pathMatch ? pathMatch[1] : '';

  function apiUrl(path) {
    return `${BASE}${path}`;
  }

  function wsUrl() {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${proto}//${location.host}${BASE}`;
  }

  const joinScreen = document.getElementById('join-screen');
  const gameScreen = document.getElementById('game-screen');
  const pinInput = document.getElementById('pin-input');
  const nameInput = document.getElementById('name-input');
  const btnJoin = document.getElementById('btn-join');
  const btnCreateLobby = document.getElementById('btn-create-lobby');
  const joinError = document.getElementById('join-error');
  const statusEl = document.getElementById('status');
  const btnStart = document.getElementById('btn-start');
  const btnReset = document.getElementById('btn-reset');
  const lobbyPinEl = document.getElementById('lobby-pin');
  const canvas = document.getElementById('pong-canvas');
  const ctx = canvas.getContext('2d');
  const overlay = document.getElementById('overlay');
  const overlayTitle = document.getElementById('overlay-title');
  const overlayText = document.getElementById('overlay-text');
  const scoreLeftEl = document.getElementById('score-left');
  const scoreRightEl = document.getElementById('score-right');
  const labelLeft = document.getElementById('label-left');
  const labelRight = document.getElementById('label-right');
  const playerInfo = document.getElementById('player-info');
  const controlsHint = document.getElementById('controls-hint');
  const powerHud = document.getElementById('power-hud');

  let ws = null;
  let playerId = null;
  let mySide = null;
  let pin = null;
  let state = null;
  const keysDown = new Set();

  function selectedMode() {
    const el = document.querySelector('input[name="game-mode"]:checked');
    return el && el.value === 'arcade' ? 'arcade' : 'classic';
  }

  function showError(msg) {
    joinError.textContent = msg;
    joinError.classList.remove('hidden');
  }

  function clearError() {
    joinError.textContent = '';
    joinError.classList.add('hidden');
  }

  function connectWs() {
    ws = new WebSocket(wsUrl());

    ws.onopen = () => {
      statusEl.textContent = 'Forbundet';
    };

    ws.onclose = () => {
      statusEl.textContent = 'Forbindelse lukket';
      btnStart.disabled = true;
      btnReset.disabled = true;
    };

    ws.onerror = () => {
      statusEl.textContent = 'WebSocket-fejl';
    };

    ws.onmessage = (ev) => {
      let msg;
      try {
        msg = JSON.parse(ev.data);
      } catch {
        return;
      }

      if (msg.type === 'error') {
        showError(msg.data?.message || 'Fejl');
        return;
      }

      if (msg.type === 'joined') {
        playerId = msg.data.playerId;
        mySide = msg.data.side;
        pin = msg.data.pin;
        state = msg.data.state;
        joinScreen.classList.add('hidden');
        gameScreen.classList.remove('hidden');
        lobbyPinEl.textContent = `PIN: ${pin}${
          state?.mode === 'arcade' ? ' · ARCADE' : ' · CLASSIC'
        }`;
        updateUi();
        return;
      }

      if (msg.type === 'state') {
        state = msg.data;
        updateUi();
        draw();
      }
    };
  }

  function joinLobby(lobbyPin, name) {
    clearError();
    pin = String(lobbyPin).trim();
    if (!pin) {
      showError('Indtast en PIN');
      return;
    }
    const payload = { type: 'joinLobby', pin, name: name || undefined };
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      connectWs();
      ws.addEventListener(
        'open',
        () => {
          ws.send(JSON.stringify(payload));
        },
        { once: true }
      );
    } else {
      ws.send(JSON.stringify(payload));
    }
  }

  async function createLobby() {
    clearError();
    try {
      const res = await fetch(apiUrl('/api/admin/lobbies'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: selectedMode() }),
      });
      const data = await res.json();
      if (!res.ok) {
        showError(data.error || 'Kunne ikke oprette lobby');
        return;
      }
      pinInput.value = data.pin;
      joinLobby(data.pin, nameInput.value.trim());
    } catch {
      showError('Netværksfejl ved oprettelse');
    }
  }

  function sendPaddle(direction) {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ type: 'paddle', direction }));
  }

  function sendPower(power) {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ type: 'power', power }));
  }

  function formatCd(ms) {
    if (ms <= 0) return 'klar';
    return `${(ms / 1000).toFixed(1)}s`;
  }

  function updatePowerHud() {
    if (!state || state.mode !== 'arcade' || !mySide || !state.powers?.[mySide]) {
      powerHud.classList.add('hidden');
      powerHud.innerHTML = '';
      return;
    }
    const p = state.powers[mySide];
    powerHud.classList.remove('hidden');
    const chips = [
      {
        key: 'WIDE',
        ready: p.wideCdMs <= 0,
        active: p.wideActive,
        cd: p.wideActive ? `aktiv ${formatCd(p.wideMs)}` : formatCd(p.wideCdMs),
      },
      {
        key: 'NUDGE',
        ready: p.nudgeCdMs <= 0,
        active: false,
        cd: formatCd(p.nudgeCdMs),
      },
      {
        key: 'SMASH',
        ready: p.smashCdMs <= 0 && !p.smashArmed,
        armed: p.smashArmed,
        cd: p.smashArmed ? 'ladet' : formatCd(p.smashCdMs),
      },
    ];
    powerHud.innerHTML = chips
      .map((c) => {
        const cls = [
          'power-chip',
          c.ready ? 'ready' : '',
          c.active ? 'active' : '',
          c.armed ? 'armed' : '',
        ]
          .filter(Boolean)
          .join(' ');
        return `<div class="${cls}">${c.key}<span class="cd">${c.cd}</span></div>`;
      })
      .join('');
  }

  function updateUi() {
    if (!state) return;

    scoreLeftEl.textContent = state.scoreLeft;
    scoreRightEl.textContent = state.scoreRight;

    if (state.paddles?.left?.name) {
      labelLeft.textContent = state.paddles.left.name.toUpperCase();
    }
    if (state.paddles?.right?.name) {
      labelRight.textContent = state.paddles.right.name.toUpperCase();
    }

    if (pin) {
      lobbyPinEl.textContent = `PIN: ${pin}${
        state.mode === 'arcade' ? ' · ARCADE' : ' · CLASSIC'
      }`;
    }

    const me = playerId ? state.players[playerId] : null;
    if (me) {
      if (me.isSpectator) {
        playerInfo.innerHTML = `<span class="spectator-badge">Tilskuer</span> · ${me.name}`;
        controlsHint.textContent = 'Du ser kampen — maks 2 paddle-spillere i lobbyen.';
      } else {
        const sideLabel = me.side === 'left' ? 'venstre paddle' : 'højre paddle';
        playerInfo.textContent = `${me.name} · ${sideLabel}`;
        if (state.mode === 'arcade') {
          controlsHint.textContent =
            me.side === 'left'
              ? 'W/S · 1/Q WIDE · 3/E NUDGE · 4/Space SMASH'
              : '↑/↓ · 1 WIDE · 3 NUDGE · 4/Space SMASH';
        } else if (me.side === 'left') {
          controlsHint.textContent = 'Styr: W/S eller ↑/↓';
        } else {
          controlsHint.textContent = 'Styr: ↑/↓ (højre paddle)';
        }
      }
    }

    const paddleCount =
      (state.leftPlayerId ? 1 : 0) + (state.rightPlayerId ? 1 : 0);
    btnStart.disabled = state.gameState !== 'waiting' || paddleCount < 2;
    btnReset.disabled = state.gameState !== 'finished';

    overlay.classList.add('hidden');
    if (state.gameState === 'waiting') {
      overlay.classList.remove('hidden');
      overlayTitle.textContent =
        state.mode === 'arcade' ? 'Arcade — venter' : 'Venter på start';
      overlayText.textContent =
        paddleCount < 2
          ? 'Vent på modstander (2 spillere)'
          : state.mode === 'arcade'
            ? 'WIDE · NUDGE · SMASH — tryk «Start spil»'
            : 'Tryk «Start spil» når I er klar';
    } else if (state.gameState === 'finished') {
      overlay.classList.remove('hidden');
      const won =
        (state.winnerSide === 'left' && mySide === 'left') ||
        (state.winnerSide === 'right' && mySide === 'right');
      overlayTitle.textContent = won
        ? 'Du vandt!'
        : state.winnerName
          ? `${state.winnerName} vandt`
          : 'Spillet er slut';
      overlayText.textContent = 'Tryk «Nyt spil» for at spille igen';
    }

    statusEl.textContent =
      state.gameState === 'playing'
        ? state.mode === 'arcade'
          ? 'Arcade'
          : 'Spiller'
        : state.gameState === 'finished'
          ? 'Afsluttet'
          : 'Lobby';

    updatePowerHud();
    draw();
  }

  function draw() {
    if (!state) return;
    const w = state.court.width;
    const h = state.court.height;
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    const pw = state.paddle.width;
    const margin = state.paddle.margin;
    const br = state.ball.radius;
    const leftH = state.paddles?.left?.height ?? state.paddle.height;
    const rightH = state.paddles?.right?.height ?? state.paddle.height;

    ctx.fillStyle = '#0a0a0a';
    ctx.fillRect(0, 0, w, h);

    ctx.setLineDash([8, 12]);
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(w / 2, 0);
    ctx.lineTo(w / 2, h);
    ctx.stroke();
    ctx.setLineDash([]);

    const leftY = state.paddles?.left?.y ?? (h - leftH) / 2;
    const rightY = state.paddles?.right?.y ?? (h - rightH) / 2;

    const leftPow = state.powers?.left;
    const rightPow = state.powers?.right;

    ctx.fillStyle = leftPow?.wideActive ? '#8cf' : leftPow?.smashArmed ? '#f80' : '#fff';
    ctx.fillRect(margin, leftY, pw, leftH);
    ctx.fillStyle = rightPow?.wideActive ? '#8cf' : rightPow?.smashArmed ? '#f80' : '#fff';
    ctx.fillRect(w - margin - pw, rightY, pw, rightH);

    const ball = state.ball;
    const smashBall =
      (leftPow?.smashArmed && ball.vx > 0) || (rightPow?.smashArmed && ball.vx < 0);
    ctx.fillStyle = smashBall ? '#ff8c00' : '#fff';
    ctx.beginPath();
    ctx.arc(ball.x, ball.y, br, 0, Math.PI * 2);
    ctx.fill();
  }

  function handleKeyDown(e) {
    if (!state || state.gameState !== 'playing') return;
    const me = state.players[playerId];
    if (!me || me.isSpectator) return;

    if (state.mode === 'arcade' && !keysDown.has(e.key)) {
      let power = null;
      if (e.key === '1' || e.key === 'q' || e.key === 'Q') power = 'wide';
      if (e.key === '3' || e.key === 'e' || e.key === 'E') power = 'nudge';
      if (e.key === '4' || e.key === ' ' || e.key === 'r' || e.key === 'R') {
        power = 'smash';
      }
      if (power) {
        keysDown.add(e.key);
        sendPower(power);
        e.preventDefault();
        return;
      }
    }

    let dir = null;
    if (me.side === 'left') {
      if (e.key === 'w' || e.key === 'W' || e.key === 'ArrowUp') dir = 'up';
      if (e.key === 's' || e.key === 'S' || e.key === 'ArrowDown') dir = 'down';
    } else if (me.side === 'right') {
      if (e.key === 'ArrowUp') dir = 'up';
      if (e.key === 'ArrowDown') dir = 'down';
    }

    if (dir && !keysDown.has(e.key)) {
      keysDown.add(e.key);
      sendPaddle(dir);
      e.preventDefault();
    }
  }

  function handleKeyUp(e) {
    keysDown.delete(e.key);
    if (!state || state.gameState !== 'playing') return;
    const me = state.players[playerId];
    if (!me || me.isSpectator) return;

    const leftKeys = ['w', 'W', 's', 'S', 'ArrowUp', 'ArrowDown'];
    const rightKeys = ['ArrowUp', 'ArrowDown'];
    const relevant = me.side === 'left' ? leftKeys : rightKeys;
    if (!relevant.includes(e.key)) return;

    const still = relevant.some((k) => keysDown.has(k));
    if (!still) {
      sendPaddle('stop');
    }
  }

  btnJoin.addEventListener('click', () => {
    joinLobby(pinInput.value, nameInput.value.trim());
  });

  btnCreateLobby.addEventListener('click', createLobby);

  btnStart.addEventListener('click', () => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'start' }));
    }
  });

  btnReset.addEventListener('click', () => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'reset' }));
    }
  });

  document.addEventListener('keydown', handleKeyDown);
  document.addEventListener('keyup', handleKeyUp);

  connectWs();
})();
