const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const express = require("express");
const http = require("node:http");
const https = require("node:https");
const { Server } = require("socket.io");

const app = express();
const TLS_KEY_PATH = process.env.TLS_KEY_PATH;
const TLS_CERT_PATH = process.env.TLS_CERT_PATH;
const server = TLS_KEY_PATH && TLS_CERT_PATH
  ? https.createServer({ key: fs.readFileSync(TLS_KEY_PATH), cert: fs.readFileSync(TLS_CERT_PATH) }, app)
  : http.createServer(app);
const io = new Server(server, {
  maxHttpBufferSize: 600_000,
  pingInterval: 20_000,
  pingTimeout: 30_000,
  allowRequest: (request, callback) => {
    const origin = request.headers.origin;
    if (!origin) return callback(null, true);
    try {
      callback(null, new URL(origin).host === request.headers.host);
    } catch {
      callback(null, false);
    }
  },
});

const ROOT = __dirname;
const PUBLIC = path.join(ROOT, "public");
const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, "data");
const DATA_FILE = path.join(DATA_DIR, "rooms.json");
const ATTACHMENT_FILE = path.join(DATA_DIR, "attachments.json");
const PORT = Number.parseInt(process.env.PORT || "3000", 10);
const HOST = process.env.HOST || "0.0.0.0";
const MAX_ROOM_EVENTS = 2_000;
const MAX_EVENT_BYTES = 500_000;
const MAX_ATTACHMENT_BYTES = 400_000;

fs.mkdirSync(DATA_DIR, { recursive: true });

let roomHistory = Object.create(null);
try {
  const saved = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
  if (saved && typeof saved === "object" && !Array.isArray(saved)) {
    roomHistory = saved;
  }
} catch (error) {
  if (error.code !== "ENOENT") {
    console.warn("Could not read saved room history; starting with empty rooms.");
  }
}

let roomAttachments = Object.create(null);
try {
  const saved = JSON.parse(fs.readFileSync(ATTACHMENT_FILE, "utf8"));
  if (saved && typeof saved === "object" && !Array.isArray(saved)) {
    roomAttachments = saved;
  }
} catch (error) {
  if (error.code !== "ENOENT") {
    console.warn("Could not read saved photo attachments; starting with empty attachments.");
  }
}

function saveHistory() {
  const temporary = `${DATA_FILE}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(roomHistory), { mode: 0o600 });
  fs.renameSync(temporary, DATA_FILE);
}

function saveAttachments() {
  const temporary = `${ATTACHMENT_FILE}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(roomAttachments), { mode: 0o600 });
  fs.renameSync(temporary, ATTACHMENT_FILE);
}

function emitRoomHistory(socket, roomId) {
  const history = roomHistory[roomId] || [];
  const chunkLimit = 350_000;
  let chunk = [];
  let chunkBytes = 0;
  for (const event of history) {
    const eventBytes = Buffer.byteLength(JSON.stringify(event), "utf8");
    if (chunk.length && chunkBytes + eventBytes > chunkLimit) {
      socket.emit("room-history", { events: chunk, complete: false });
      chunk = [];
      chunkBytes = 0;
    }
    chunk.push(event);
    chunkBytes += eventBytes;
  }
  socket.emit("room-history", { events: chunk, complete: true });
}

function cleanText(value, limit, fallback = "") {
  return typeof value === "string" ? value.trim().slice(0, limit) : fallback;
}

function validRoomId(value) {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

function listMembers(roomId) {
  const socketIds = io.sockets.adapter.rooms.get(roomId);
  if (!socketIds) return [];

  const members = new Map();
  for (const socketId of socketIds) {
    const member = io.sockets.sockets.get(socketId)?.data.member;
    if (!member) continue;
    const current = members.get(member.clientId);
    if (!current || current.joinedAt > member.joinedAt) {
      members.set(member.clientId, { ...member, socketId });
    }
  }
  return [...members.values()].map((member) => ({
    clientId: member.clientId,
    name: member.name,
    socketId: member.socketId,
  }));
}

function announcePresence(roomId) {
  io.to(roomId).emit("room-presence", listMembers(roomId));
}

app.disable("x-powered-by");
app.use((request, response, next) => {
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  response.setHeader("X-Frame-Options", "DENY");
  response.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self' https://www.youtube.com https://s.ytimg.com; style-src 'self' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: https://i.ytimg.com; media-src blob:; connect-src 'self' https: wss: stun:; frame-src https://www.youtube.com https://www.youtube-nocookie.com https://open.spotify.com; object-src 'none'; base-uri 'self'; form-action 'self'"
  );
  next();
});
app.use(express.static(PUBLIC, { extensions: ["html"] }));
app.get("/health", (_request, response) => response.json({ ok: true }));

io.on("connection", (socket) => {
  socket.on("join-room", (input, reply) => {
    const roomId = input?.roomId;
    const clientId = cleanText(input?.clientId, 80);
    const name = cleanText(input?.name, 28);
    if (!validRoomId(roomId) || !/^[a-zA-Z0-9-]{12,80}$/.test(clientId) || !name) {
      reply?.({ ok: false, error: "Please enter a name and a valid secret phrase." });
      return;
    }

    if (socket.data.member?.roomId) {
      const oldRoom = socket.data.member.roomId;
      socket.leave(oldRoom);
      announcePresence(oldRoom);
    }

    socket.data.member = { roomId, clientId, name, joinedAt: Date.now() };
    socket.join(roomId);
    emitRoomHistory(socket, roomId);
    reply?.({ ok: true, members: listMembers(roomId) });
    announcePresence(roomId);
  });

  socket.on("room-event", (input) => {
    const member = socket.data.member;
    if (!member || !input || typeof input.packet !== "string") return;
    if (input.packet.length > MAX_EVENT_BYTES) return;
    if (input.attachment !== undefined && (typeof input.attachment !== "string" || input.attachment.length > MAX_ATTACHMENT_BYTES)) return;

    const event = {
      id: crypto.randomUUID(),
      from: member.clientId,
      name: member.name,
      createdAt: Date.now(),
      packet: input.packet,
    };
    const events = (roomHistory[member.roomId] || []).slice(-MAX_ROOM_EVENTS + 1);
    events.push(event);
    roomHistory[member.roomId] = events;
    const retainedIds = new Set(events.map((savedEvent) => savedEvent.id));
    const attachments = roomAttachments[member.roomId];
    let attachmentsChanged = false;
    if (attachments && typeof attachments === "object") {
      for (const eventId of Object.keys(attachments)) {
        if (!retainedIds.has(eventId)) { delete attachments[eventId]; attachmentsChanged = true; }
      }
    }
    if (input.attachment) {
      if (!roomAttachments[member.roomId] || typeof roomAttachments[member.roomId] !== "object") {
        roomAttachments[member.roomId] = Object.create(null);
      }
      roomAttachments[member.roomId][event.id] = input.attachment;
      attachmentsChanged = true;
    }
    try {
      saveHistory();
      if (attachmentsChanged) saveAttachments();
    } catch (error) {
      console.error("Could not save encrypted room data:", error.message);
    }
    io.to(member.roomId).emit("room-event", event);
  });

  socket.on("get-room-attachment", (input, reply) => {
    const member = socket.data.member;
    const eventId = cleanText(input?.eventId, 80);
    if (!member || !/^[0-9a-f-]{36}$/.test(eventId)) { reply?.({ ok: false }); return; }
    const packet = roomAttachments[member.roomId]?.[eventId];
    if (typeof packet !== "string") { reply?.({ ok: false }); return; }
    reply?.({ ok: true, packet });
  });

  socket.on("call-request", (input) => {
    const member = socket.data.member;
    const callId = cleanText(input?.callId, 80);
    if (!member || !callId) return;
    socket.to(member.roomId).emit("call-incoming", {
      callId,
      from: socket.id,
      name: member.name,
    });
  });

  socket.on("call-response", (input) => {
    const member = socket.data.member;
    const target = io.sockets.sockets.get(input?.to);
    if (!member || !target || target.data.member?.roomId !== member.roomId) return;
    target.emit("call-response", {
      callId: cleanText(input.callId, 80),
      accepted: input.accepted === true,
      from: socket.id,
      name: member.name,
    });
  });

  socket.on("call-signal", (input) => {
    const member = socket.data.member;
    const target = io.sockets.sockets.get(input?.to);
    if (!member || !target || target.data.member?.roomId !== member.roomId) return;
    if (JSON.stringify(input?.data ?? {}).length > 45_000) return;
    target.emit("call-signal", {
      callId: cleanText(input.callId, 80),
      from: socket.id,
      name: member.name,
      data: input.data,
    });
  });

  socket.on("disconnect", () => {
    const roomId = socket.data.member?.roomId;
    if (roomId) announcePresence(roomId);
  });
});

server.listen(PORT, HOST, () => {
  const protocol = TLS_KEY_PATH && TLS_CERT_PATH ? "https" : "http";
  console.log(`LoveNest is ready at ${protocol}://localhost:${PORT}`);
  if (HOST === "0.0.0.0") {
    console.log("To connect another device on this Wi-Fi, open this port on your local firewall and use this computer's local IP.");
  }
});

function closeCleanly() {
  try {
    saveHistory();
  } finally {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 2_000).unref();
  }
}
process.on("SIGINT", closeCleanly);
process.on("SIGTERM", closeCleanly);
