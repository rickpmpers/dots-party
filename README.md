# Dots Party

A mobile-first, browser-based multiplayer **Dots and Boxes** game. One player hosts a room, up to **10 total players (host + 9 friends)** join using a six-character code or QR code, and moves update live over WebSockets.

## Get started locally

Requires Node.js 20+.

```bash
npm install
npm start
```

Open `http://localhost:3000`. To play from other devices on the same Wi-Fi, open `http://YOUR_COMPUTER_LAN_IP:3000` (and allow the port through your firewall). For friends on the internet, deploy the server to a public HTTPS host with WebSocket support; **localhost and private Wi-Fi addresses will not work for remote friends**.

## Deploy online

The project is a standard Node.js HTTP + WebSocket server. Deploy it to any always-running Node host supporting WebSockets (e.g. Render Web Service, Railway, Fly.io, or a VM). Set the start command to `npm start`, set runtime to Node 20+, and expose `PORT` (automatically provided by most hosts). Use the HTTPS URL supplied by the host.

WebSockets should be proxied with `Upgrade`/`Connection` headers. Avoid purely static hosting, and avoid serverless platforms that do not maintain WebSocket connections. The server binds `0.0.0.0` and respects `PORT`.

## Rules

- 6 x 6 dots provide 25 boxes.
- Players take turns drawing a line between adjacent dots.
- Closing a fourth side claims that box and grants another turn.
- The game ends when all 25 boxes are claimed; highest score wins. Ties are supported.
- If a player disconnects on their turn, the next connected player goes. Returning players can resume with a stored browser token.

## Practical limitations

- Rooms and active games live in **server memory**; restarting the server loses games. Scale this deployment to **one instance**, unless you add Redis or another shared store and cross-instance WebSocket messaging.
- Room codes are invitation codes, **not** strong authentication. Join links should be shared only with intended players. Room creators can start new rounds.
- Currently up to **10 total players**, not 10 guests plus a host.
- The host starts a round once 2+ connected players are present. New players cannot join after the round starts (reconnects can).
- For reliable larger-scale production: add persistent rooms, edge WAF controls, and an optional host-transfer mechanism. The current server already applies per-socket message limits, per-IP room-creation limits, origin checks, and a global room cap.

## Production deployment

The live deployment uses **https://mm-game.selfserved.ai**.

1. Copy the project folder to the self-hosted machine and start the single app instance:

   ```bash
   docker compose up -d --build
   curl -fsS http://127.0.0.1:8821/health
   ```

2. In the Cloudflare Zero Trust dashboard, select the tunnel connected to your self-hosted machine, then add a **Public hostname**:

   - **Subdomain:** `mm-game`
   - **Domain:** `selfserved.ai`
   - **Type:** HTTP
   - **Service URL:** `http://127.0.0.1:8821`

Cloudflare Tunnel creates/uses an appropriate DNS route when managed through the dashboard. For this config-file-managed tunnel, add an ingress rule for `mm-game.selfserved.ai` to `http://127.0.0.1:8821` and ensure the hostname has a proxied CNAME to the tunnel UUID.

The account's wildcard Access application protects `*.selfserved.ai`. Run
`CLOUDFLARE_ACCOUNT_ID=<your-account-id> CLOUDFLARE_API_TOKEN=<token> python3 scripts/configure-public-access.py apply`
to create the more-specific
public bypass for this invitation-based game; this does not change Access on any
other hostname.

3. Visit `https://mm-game.selfserved.ai/` from a phone on mobile data. Create a room and scan the QR code from a second device. Cloudflare proxies WebSocket upgrades through the same tunnel route.

4. For this invitation-based public game, do not turn on Cloudflare Access identity login unless every guest can authenticate. Consider Cloudflare WAF/rate limits to reduce automated room creation or connection floods.

**Operational note:** Active rooms live only in memory; restarting this container ends ongoing games. Only run one replica until shared room/session state is implemented.

### Operations

```bash
docker compose ps
docker compose logs --tail 100
docker compose up -d --build
docker compose restart
```

The container binds only to Mac loopback on port 8821, runs as the unprivileged
Node user with all Linux capabilities dropped, uses a read-only filesystem, has
CPU/memory/PID limits, and restarts automatically unless deliberately stopped.

### Verified deployment state (2026-11-22)

- Unit and integration tests: 6/6 passing.
- Public HTTPS: HTTP 200 with a valid `*.selfserved.ai` certificate.
- WebSocket: public `wss://` create/join/start/move flow passed through Cloudflare.
- Capacity: 10 synchronized clients passed; player 11 was rejected as expected.
- QR: generated SVG matched the expected public join URL byte-for-byte.
- Recovery: terminating the Node process incremented the container restart count and returned to healthy automatically.
- Cloudflare: proxied tunnel CNAME plus hostname-specific public Access bypass; the wildcard Access protection for other services remains unchanged.

Re-run the public validation with:

```bash
npm run validate:deployment -- https://mm-game.selfserved.ai
```
