import path from "node:path";
import fs from "node:fs";
import http from "node:http";
import express, { Request, Response } from "express";
import cors from "cors";
import multer from "multer";
import dotenv from "dotenv";
import { Server as SocketIOServer, Socket } from "socket.io";

dotenv.config();

const app = express();
const server = http.createServer(app);

const PORT = Number(process.env.PORT || 8080);
const CORS_ORIGIN = process.env.CORS_ORIGIN || "*";
const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL || `http://localhost:${PORT}`;

const io = new SocketIOServer(server, {
  cors: {
    origin: CORS_ORIGIN,
    methods: ["GET", "POST"]
  }
});

app.use(cors({ origin: CORS_ORIGIN, credentials: true }));
app.use(express.json());

// Ensure recordings directory
const recordingsDir = path.join(process.cwd(), "recordings");
if (!fs.existsSync(recordingsDir)) {
  fs.mkdirSync(recordingsDir, { recursive: true });
}

// Static serving for recordings
app.use("/recordings", express.static(recordingsDir));

// Health endpoint
app.get("/health", (_req: Request, res: Response) => {
  res.json({ ok: true });
});

// ICE config
app.get("/config", (_req: Request, res: Response) => {
  const stunUrls = (process.env.ICE_STUN_URLS || "stun:stun.l.google.com:19302")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const iceServers: Array<Record<string, unknown>> = [];
  if (stunUrls.length > 0) {
    iceServers.push({ urls: stunUrls });
  }

  const turnUrl = process.env.TURN_URL?.trim();
  const turnUsername = process.env.TURN_USERNAME?.trim();
  const turnPassword = process.env.TURN_PASSWORD?.trim();
  if (turnUrl && turnUsername && turnPassword) {
    iceServers.push({
      urls: turnUrl,
      username: turnUsername,
      credential: turnPassword
    });
  }

  res.json({ iceServers, publicBaseUrl: PUBLIC_BASE_URL });
});

// Recording upload
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, recordingsDir);
  },
  filename: (req, file, cb) => {
    const roomId: string = (req.body?.roomId || "room").toString();
    const participant: string = (req.body?.participant || "participant").toString();
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const base = `${roomId}_${participant}_${timestamp}`;
    const ext = path.extname(file.originalname || "").toLowerCase() || ".webm";
    cb(null, `${base}${ext}`);
  }
});
const upload = multer({ storage });

app.post("/recordings", upload.single("file"), (req: Request, res: Response) => {
  const filename = (req.file?.filename || "").toString();
  if (!filename) {
    return res.status(400).json({ error: "No file uploaded" });
  }
  const url = `${PUBLIC_BASE_URL}/recordings/${filename}`;
  res.json({ ok: true, filename, url });
});

type RoomId = string;
type DisplayName = string;

const roomIdToParticipants = new Map<RoomId, Map<string, DisplayName>>();

io.on("connection", (socket: Socket) => {
  socket.on("join_room", ({ roomId, displayName }: { roomId: string; displayName: string }) => {
    if (!roomId || typeof roomId !== "string") {
      socket.emit("error_message", { message: "Invalid roomId" });
      return;
    }
    const participants = roomIdToParticipants.get(roomId) || new Map<string, DisplayName>();
    if (participants.size >= 2) {
      socket.emit("room_full", { roomId });
      return;
    }
    participants.set(socket.id, displayName || "Guest");
    roomIdToParticipants.set(roomId, participants);
    socket.join(roomId);
    socket.data.roomId = roomId;
    socket.data.displayName = displayName || "Guest";

    socket.to(roomId).emit("peer_joined", {
      socketId: socket.id,
      displayName: socket.data.displayName
    });

    socket.emit("joined_room", {
      roomId,
      peers: Array.from(participants.entries())
        .filter(([id]) => id !== socket.id)
        .map(([id, name]) => ({ socketId: id, displayName: name }))
    });
  });

  socket.on("offer", ({ roomId, sdp }: { roomId: string; sdp: RTCSessionDescriptionInit }) => {
    if (!roomId) return;
    socket.to(roomId).emit("offer", { from: socket.id, sdp });
  });

  socket.on("answer", ({ roomId, sdp }: { roomId: string; sdp: RTCSessionDescriptionInit }) => {
    if (!roomId) return;
    socket.to(roomId).emit("answer", { from: socket.id, sdp });
  });

  socket.on("ice_candidate", ({ roomId, candidate }: { roomId: string; candidate: RTCIceCandidateInit }) => {
    if (!roomId) return;
    socket.to(roomId).emit("ice_candidate", { from: socket.id, candidate });
  });

  socket.on("leave_room", ({ roomId }: { roomId: string }) => {
    if (!roomId) return;
    socket.leave(roomId);
    const participants = roomIdToParticipants.get(roomId);
    participants?.delete(socket.id);
    socket.to(roomId).emit("peer_left", { socketId: socket.id });
  });

  socket.on("disconnect", () => {
    const roomId: string | undefined = socket.data.roomId;
    if (roomId) {
      const participants = roomIdToParticipants.get(roomId);
      participants?.delete(socket.id);
      socket.to(roomId).emit("peer_left", { socketId: socket.id });
      if (participants && participants.size === 0) {
        roomIdToParticipants.delete(roomId);
      }
    }
  });
});

server.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`Signaling server listening on ${PORT}`);
});


