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
  const createName = document.getElementById('create-name');
  const createPin = document.getElementById('create-pin');
  const createAi = document.getElementById('create-ai');
  const aiDifficulty = document.getElementById('ai-difficulty');
  const btnJoin = document.getElementById('btn-join');
  const btnCreateLobby = document.getElementById('btn-create-lobby');
  const btnRefresh = document.getElementById('btn-refresh-lobbies');
  const openList = document.getElementById('open-lobby-list');
  const noOpen = document.getElementById('no-open-lobbies');
  const joinError = document.getElementById('join-error');
  const statusEl = document.getElementById('status');
  const btnStart = document.getElementById('btn-start');
  const btnReset = document.getElementById('btn-reset');
  const btnToggleAi = document.getElementById('btn-toggle-ai');
  const btnLeave = document.getElementById('btn-leave');
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
  let intentionalLeave = false;
  const keysDown = new Set();

  // Smooth render interpolations
  let renderBall = null;
  let renderLeftY = null;
  let renderRightY = null;
  let lastFrame = performance.now();

  try {
    const last = localStorage.getItem('pong_last_pin');
    if (last && createPin && !createPin.value) createPin.value = last;
  } catch (_) {}

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

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/"/g, '&quot;');
  }

  async function refreshOpenLobbies() {
    if (gameScreen && !gameScreen.classList.contains('hidden')) return;
    try {
      const res = await fetch(apiUrl('/api/lobbies'));
      const data = await res.json();
      const lobbies = data.lobbies || [];
      if (!lobbies.length) {
        openList.innerHTML = '';
        noOpen?.classList.remove('hidden');
        return;
      }
      noOpen?.classList.add('hidden');
      openList.innerHTML = lobbies
        .map((l) => {
          const tags = [
            l.mode === 'arcade' ? 'ARCADE' : 'CLASSIC',
            l.aiEnabled ? `CPU ${l.aiDifficulty || ''}` : `${l.playerCount}/2`,
          ].join(' · ');
          return `<div class="open-lobby-row" data-pin="${escapeHtml(l.pin)}">
            <div class="open-lobby-meta">
              <span class="pin">${escapeHtml(l.pin)}</span>
              <span>${escapeHtml(tags)}</span>
            </div>
            <button type="button" class="btn-secondary btn-sm btn-join-open">Deltag</button>
          </div>`;
        })
        .join('');
      openList.querySelectorAll('.btn-join-open').forEach((btn) => {
        btn.addEventListener('click', () => {
          const row = btn.closest('.open-lobby-row');
          const p = row?.dataset.pin;
          if (!p) return;
          if (pinInput) pinInput.value = p;
          joinLobby(p, nameInput.value.trim() || createName?.value.trim());
        });
      });
    } catch (_) {}
  }

  function connectWs() {
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
      return;
    }
    ws = new WebSocket(wsUrl());

    ws.onopen = () => {
      statusEl.textContent = 'Forbundet';
    };

    ws.onclose = () => {
      statusEl.textContent = 'Forbindelse lukket';
      btnStart.disabled = true;
      btnReset.disabled = true;
      if (!intentionalLeave && pin) {
        setTimeout(() => {
          if (!intentionalLeave) connectWs();
        }, 1500);
      }
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

      if (msg.type === 'lobbyEnded') {
        leaveToHome('Lobbyen blev lukket');
        return;
      }

      if (msg.type === 'joined') {
        playerId = msg.data.playerId;
        mySide = msg.data.side;
        pin = msg.data.pin;
        state = msg.data.state;
        joinScreen.classList.add('hidden');
        gameScreen.classList.remove('hidden');
        seedRenderFromState();
        updateUi();
        return;
      }

      if (msg.type === 'state') {
        state = msg.data;
        updateUi();
      }
    };
  }

  function seedRenderFromState() {
    if (!state) return;
    renderBall = { ...state.ball };
    renderLeftY = state.paddles?.left?.y ?? 0;
    renderRightY = state.paddles?.right?.y ?? 0;
  }

  function joinLobby(lobbyPin, name) {
    clearError();
    intentionalLeave = false;
    pin = String(lobbyPin).trim();
    if (!pin) {
      showError('Indtast en PIN');
      return;
    }
    try {
      localStorage.setItem('pong_last_pin', pin);
    } catch (_) {}
    const payload = { type: 'joinLobby', pin, name: name || undefined };
    connectWs();
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(payload));
    } else {
      ws.addEventListener(
        'open',
        () => {
          ws.send(JSON.stringify(payload));
        },
        { once: true }
      );
    }
  }

  async function createLobby() {
    clearError();
    const name = createName?.value.trim() || nameInput.value.trim();
    const customPin = createPin?.value.trim() || '';
    const body = {
      mode: selectedMode(),
      ai: !!createAi?.checked,
      aiDifficulty: aiDifficulty?.value || 'medium',
    };
    if (customPin) body.pin = customPin;
    try {
      const res = await fetch(apiUrl('/api/lobbies'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        showError(data.error || 'Kunne ikke oprette lobby');
        return;
      }
      if (pinInput) pinInput.value = data.pin;
      if (createPin) createPin.value = data.pin;
      joinLobby(data.pin, name);
    } catch {
      showError('Netværksfejl ved oprettelse');
    }
  }

  function leaveToHome(msg) {
    intentionalLeave = true;
    if (ws) {
      ws.close();
      ws = null;
    }
    playerId = null;
    mySide = null;
    pin = null;
    state = null;
    gameScreen.classList.add('hidden');
    joinScreen.classList.remove('hidden');
    if (msg) showError(msg);
    refreshOpenLobbies();
    setTimeout(() => {
      intentionalLeave = false;
    }, 200);
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
      { key: 'NUDGE', ready: p.nudgeCdMs <= 0, active: false, cd: formatCd(p.nudgeCdMs) },
      {
        key: 'SMASH',
        ready: p.smashCdMs <= 0 && !p.smashArmed,
        armed: p.smashArmed,
        cd: p.smashArmed ? 'ladet' : formatCd(p.smashCdMs),
      },
    ];
    powerHud.innerHTML = chips
      .map((c) => {
        const cls = ['power-chip', c.ready ? 'ready' : '', c.active ? 'active' : '', c.armed ? 'armed' : '']
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
      const bits = [`PIN: ${pin}`, state.mode === 'arcade' ? 'ARCADE' : 'CLASSIC'];
      if (state.aiEnabled) bits.push(`CPU ${state.aiDifficulty || ''}`.trim());
      lobbyPinEl.textContent = bits.join(' · ');
    }

    const me = playerId ? state.players[playerId] : null;
    if (me) {
      if (me.isSpectator) {
        playerInfo.innerHTML = `<span class="spectator-badge">Tilskuer</span> · ${me.name}`;
        controlsHint.textContent = 'Du ser kampen — paddles er optaget.';
      } else {
        const sideLabel = me.side === 'left' ? 'venstre paddle' : 'højre paddle';
        playerInfo.textContent = `${me.name} · ${sideLabel}`;
        if (state.mode === 'arcade') {
          controlsHint.textContent =
            'W/S eller ↑/↓ · 1 WIDE · 3 NUDGE · 4/Space SMASH';
        } else {
          controlsHint.textContent = 'Styr: W/S eller ↑/↓';
        }
      }
    }

    const paddleCount =
      (state.leftPlayerId ? 1 : 0) + (state.rightPlayerId ? 1 : 0);
    btnStart.disabled = state.gameState !== 'waiting' || paddleCount < 2;
    btnReset.disabled = state.gameState !== 'finished';

    if (btnToggleAi) {
      const canToggle =
        state.gameState === 'waiting' &&
        me &&
        !me.isSpectator &&
        (state.aiEnabled || !state.rightPlayerId || state.players[state.rightPlayerId]?.isAi);
      btnToggleAi.classList.toggle('hidden', !canToggle);
      btnToggleAi.textContent = state.aiEnabled ? 'Fjern CPU' : 'Tilføj CPU';
    }

    overlay.classList.add('hidden');
    if (state.gameState === 'waiting') {
      overlay.classList.remove('hidden');
      overlayTitle.textContent =
        state.mode === 'arcade' ? 'Arcade — lobby' : 'Lobby';
      if (paddleCount < 2) {
        overlayText.textContent = state.aiEnabled
          ? 'CPU klar — mangler dig? Tryk Start når venstre er fyldt.'
          : 'Vent på modstander, eller tilføj CPU';
      } else {
        overlayText.textContent = state.aiEnabled
          ? `Klar vs CPU (${state.aiDifficulty}) — tryk Start`
          : 'Tryk «Start spil» når I er klar';
      }
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
      overlayText.textContent = 'Tryk «Nyt spil» for rematch';
    }

    statusEl.textContent =
      state.gameState === 'playing'
        ? state.aiEnabled
          ? 'Vs CPU'
          : state.mode === 'arcade'
            ? 'Arcade'
            : 'Spiller'
        : state.gameState === 'finished'
          ? 'Afsluttet'
          : 'Lobby';

    updatePowerHud();
  }

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  function drawFrame(now) {
    const dt = Math.min(0.05, (now - lastFrame) / 1000);
    lastFrame = now;

    if (state && renderBall) {
      const t = Math.min(1, dt * 18);
      renderBall.x = lerp(renderBall.x, state.ball.x, t);
      renderBall.y = lerp(renderBall.y, state.ball.y, t);
      renderBall.vx = state.ball.vx;
      renderBall.vy = state.ball.vy;
      const leftY = state.paddles?.left?.y ?? 0;
      const rightY = state.paddles?.right?.y ?? 0;
      renderLeftY = lerp(renderLeftY ?? leftY, leftY, Math.min(1, dt * 22));
      renderRightY = lerp(renderRightY ?? rightY, rightY, Math.min(1, dt * 22));
      draw();
    } else if (state) {
      seedRenderFromState();
      draw();
    }
    requestAnimationFrame(drawFrame);
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

    const leftY = renderLeftY ?? state.paddles?.left?.y ?? (h - leftH) / 2;
    const rightY = renderRightY ?? state.paddles?.right?.y ?? (h - rightH) / 2;
    const leftPow = state.powers?.left;
    const rightPow = state.powers?.right;

    ctx.fillStyle = leftPow?.wideActive ? '#8cf' : leftPow?.smashArmed ? '#f80' : '#fff';
    ctx.fillRect(margin, leftY, pw, leftH);
    ctx.fillStyle = rightPow?.wideActive
      ? '#8cf'
      : rightPow?.smashArmed
        ? '#f80'
        : state.aiEnabled
          ? '#9f9'
          : '#fff';
    ctx.fillRect(w - margin - pw, rightY, pw, rightH);

    const ball = renderBall || state.ball;
    const smashBall =
      (leftPow?.smashArmed && ball.vx > 0) || (rightPow?.smashArmed && ball.vx < 0);
    ctx.fillStyle = smashBall ? '#ff8c00' : '#fff';
    ctx.shadowColor = smashBall ? '#ff8c00' : '#fff';
    ctx.shadowBlur = 8;
    ctx.beginPath();
    ctx.arc(ball.x, ball.y, br, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
  }

  function handleKeyDown(e) {
    if (!state || state.gameState !== 'playing') return;
    const me = state.players[playerId];
    if (!me || me.isSpectator) return;

    if (state.mode === 'arcade' && !keysDown.has(e.key)) {
      let power = null;
      if (e.key === '1' || e.key === 'q' || e.key === 'Q') power = 'wide';
      if (e.key === '3' || e.key === 'e' || e.key === 'E') power = 'nudge';
      if (e.key === '4' || e.key === ' ' || e.key === 'r' || e.key === 'R') power = 'smash';
      if (power) {
        keysDown.add(e.key);
        sendPower(power);
        e.preventDefault();
        return;
      }
    }

    let dir = null;
    if (e.key === 'w' || e.key === 'W' || e.key === 'ArrowUp') dir = 'up';
    if (e.key === 's' || e.key === 'S' || e.key === 'ArrowDown') dir = 'down';

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

    const relevant = ['w', 'W', 's', 'S', 'ArrowUp', 'ArrowDown'];
    if (!relevant.includes(e.key)) return;
    const still = relevant.some((k) => keysDown.has(k));
    if (!still) sendPaddle('stop');
  }

  btnJoin.addEventListener('click', () => {
    joinLobby(pinInput.value, nameInput.value.trim() || createName?.value.trim());
  });
  pinInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') joinLobby(pinInput.value, nameInput.value.trim());
  });
  btnCreateLobby.addEventListener('click', createLobby);
  btnRefresh?.addEventListener('click', refreshOpenLobbies);

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

  btnToggleAi?.addEventListener('click', () => {
    if (!ws || ws.readyState !== WebSocket.OPEN || !state) return;
    if (state.aiEnabled) {
      ws.send(JSON.stringify({ type: 'disableAi' }));
    } else {
      ws.send(
        JSON.stringify({
          type: 'enableAi',
          difficulty: aiDifficulty?.value || 'medium',
        })
      );
    }
  });

  btnLeave?.addEventListener('click', () => leaveToHome());

  createAi?.addEventListener('change', () => {
    if (aiDifficulty) aiDifficulty.disabled = !createAi.checked;
  });

  document.addEventListener('keydown', handleKeyDown);
  document.addEventListener('keyup', handleKeyUp);

  refreshOpenLobbies();
  setInterval(refreshOpenLobbies, 3000);
  requestAnimationFrame(drawFrame);

  const urlPin = new URLSearchParams(location.search).get('pin');
  if (urlPin && pinInput) {
    pinInput.value = urlPin;
    joinLobby(urlPin, nameInput.value.trim());
  }
})();
