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

### Firmware

Sæt **`GAME_MODE_PONG`** på Oplà-controlleren.

Touch/pad (typisk):

| Pad | Retning |
|-----|---------|
| **TOUCH0** | OP (UP) |
| **TOUCH2** | NED (DOWN) |

Alternativt **TOUCH1** / **TOUCH3** hvis det matcher jeres board-layout.

Base URL inkl. path: **`https://…/Pong/`** (med trailing slash i SPA; API-kald: `/Pong/api/controller/...` via reverse proxy).

## WebSocket

- `joinLobby` — `{ pin, name? }`
- `createLobby` — `{ pin? }` (valgfri fast PIN)
- `start` / `reset`
- `paddle` — `{ direction: "up" \| "down" \| "stop" }`
- Server broadcaster `state` med score, bold, paddles

## Spilregler

- Første til **11** point vinder.
- Server-autoritativ fysik; bold nulstilles efter point.
- Max **2** paddle-spillere per lobby; flere joins bliver **tilskuere**.

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
