## VideoCalling (WebRTC 1:1 Prototype)

Self-hosted 1:1 video calling app using WebRTC with client-side mixed recording (canvas + audio mix) uploaded to the server.

### Stack
- Frontend: React + Vite + TypeScript
- Signaling: Node.js + Express + Socket.IO (TypeScript)
- Recording: MediaRecorder in-browser; uploads to server
- ICE: STUN/TURN provided by server `/config`

### Features
- Join by room ID (2 participants max)
- Camera/mic controls, screen share
- 1:1 WebRTC via Socket.IO signaling
- Start/Stop recording: mixed local+remote video into a single MP4/WebM
- Upload recordings to server and serve statically

### Dev Setup
1. Create `.env` files from examples:
   - `server/.env` (copy `server/.env.example`)
   - `client/.env` (copy `client/.env.example`)
2. Install dependencies:
   - Server:
     ```bash
     cd server
     npm install
     npm run dev
     ```
   - Client:
     ```bash
     cd client
     npm install
     npm run dev
     ```
3. Open the client URL (e.g., `http://localhost:5173`), enter a room ID, and share the URL with a second participant.

### Environment
- Server (`server/.env`):
  - `PORT=8080`
  - `CORS_ORIGIN=http://localhost:5173`
  - `ICE_STUN_URLS=stun:stun.l.google.com:19302`
  - `TURN_URL=` (optional, e.g. `turn:your.turn.domain:3478`)
  - `TURN_USERNAME=`
  - `TURN_PASSWORD=`
  - `PUBLIC_BASE_URL=http://localhost:8080`
- Client (`client/.env`):
  - `VITE_SERVER_URL=http://localhost:8080`

### Notes
- This prototype mixes video via `<canvas>` and audio via `AudioContext` into a single MediaStream for consistent recordings.
- TURN is recommended in production (e.g., `coturn` on TCP 443 with TLS).
- Recording uploads are stored under `server/recordings/` and served via `/recordings/...`.

### Scripts
- Server:
  - `npm run dev` — ts-node-dev
  - `npm run build && npm start` — production
- Client:
  - `npm run dev` — Vite
  - `npm run build && npm run preview`


