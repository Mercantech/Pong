# Pong

Klassisk 2-spiller Pong med PIN-lobby, WebSocket og Arduino controller-API — Mercantec Games-mønster (som Tetris/Bomberman).

## Kør lokalt

```bash
cd server
npm install
npm start
```

Åbn [http://localhost:8080](http://localhost:8080).

### Docker

```bash
docker compose -f docker-compose.yml -f docker-compose.local.yml up --build
```

Port **8080** mappes lokalt. Produktion: service `pong` på `dokploy-network` (Traefik **PathPrefix `/Pong`** + **StripPrefix** — containeren ser `/`).

## Health

`GET /api/health` → `{ "ok": true, "service": "pong" }`

## Controller API (Oplà / Arduino)

Samme kontrakt som Tetris:

| Endpoint | Body |
|----------|------|
| `POST /api/controller/join` | `{ "pin", "name?", "deviceId?" }` → `{ "ok", "playerId", "side" }` |
| `POST /api/controller/heartbeat` | `{ "pin", "playerId", "deviceId?" }` |
| `POST /api/controller/action` | `{ "pin", "playerId", "action", "params?" }` |

Actions:

- `"move"` + `params.direction`: `"UP"` \| `"DOWN"`
- `"stop"` — nulstil paddle-hastighed
- **Arcade:** `"wide"` · `"nudge"` · `"smash"` (ignoreres i Classic)

### Modes

- **Classic** — ren paddle-duel (default)
- **Arcade** — vælges ved opret lobby: **WIDE** (højere paddle), **NUDGE** (snap til bold), **SMASH** (næste hit hurtigere)

### Firmware

Sæt **`GAME_MODE_PONG`** på Oplà-controlleren.

Touch/pad:

| Pad | Classic / begge | Arcade |
|-----|-----------------|--------|
| **TOUCH0** | OP (UP) | OP |
| **TOUCH2** | NED (DOWN) | NED |
| **TOUCH1** | — | **WIDE** |
| **TOUCH3** | — | **NUDGE** |
| **TOUCH4** | — | **SMASH** |

Base URL inkl. path: **`https://…/Pong/`** (med trailing slash i SPA; API-kald: `/Pong/api/controller/...` via reverse proxy).

## WebSocket

- `joinLobby` — `{ pin, name? }`
- `createLobby` — `{ pin? }` (valgfri fast PIN)
- `start` / `reset`
- `paddle` — `{ direction: "up" \| "down" \| "stop" }`
- `power` — `{ power: "wide" \| "nudge" \| "smash" }` (Arcade)
- `setMode` — `{ mode: "classic" \| "arcade" }` (før start)
- Server broadcaster `state` med score, bold, paddles (+ `powers` i Arcade)

## Spilregler

- Første til **11** point vinder.
- Server-autoritativ fysik; bold nulstilles efter point.
- Max **2** paddle-spillere per lobby; flere joins bliver **tilskuere**.
- Arcade-powers har cooldown; SMASH lades til næste paddle-hit.

## Admin

`/admin.html` — opret/list/slet lobbies (`/api/admin/lobbies`).

## Filstruktur

```
Pong/
  Dockerfile
  docker-compose.yml
  docker-compose.local.yml
  server/
  public/
```
