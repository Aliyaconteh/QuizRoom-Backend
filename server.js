const path = require("path");
require("dotenv").config({ path: path.join(__dirname, ".env") });

const http = require("http");
const { Server } = require("socket.io");

const app = require("./src/app/app");
const initSockets = require("./src/sockets");
const { initializeDatabase } = require("./src/database/init");
const { metricsCollector } = require("./src/utils/metricsCollector");

const server = http.createServer(app);

// Socket.IO setup with enhanced configuration
const io = new Server(server, {
  cors: {
    origin: (origin, callback) => callback(null, true),
    methods: ["GET", "POST"],
    credentials: true
  },
  transports: ["websocket", "polling"],
  pingInterval: 25000,
  pingTimeout: 60000,
  maxHttpBufferSize: 1e6,
});

// Socket.IO middleware for authentication and metrics
io.use(async (socket, next) => {
  const token = socket.handshake.auth?.token;
  const userId = socket.handshake.auth?.userId;
  
  // Store metadata for metrics
  socket.metadata = {
    userId: userId || 'anonymous',
    connectedAt: Date.now(),
    connectionId: socket.id
  };

  // Initialize metrics for this socket
  metricsCollector.initializeSocket(socket.id, {
    userId: socket.metadata.userId,
    connectedAt: socket.metadata.connectedAt
  });

  if (!token) {
    socket.isAuthenticated = false;
    return next();
  }

  try {
    // Verify token with your auth service
    const decoded = require("jsonwebtoken").verify(token, process.env.JWT_SECRET || "your-secret");
    socket.user = decoded;
    socket.isAuthenticated = true;
    socket.metadata.userId = decoded.id;
  } catch (error) {
    socket.isAuthenticated = false;
    console.error("Auth error:", error.message);
  }

  next();
});

// Initialize Sockets
initSockets(io);

// Socket disconnection handler for metrics cleanup
io.on('disconnect', (socket) => {
  metricsCollector.finalizeSocket(socket.id);
});

// Error handling middleware
io.on('error', (error) => {
  console.error("Socket.IO Error:", error);
});

// Initialize database on startup
const initializeApp = async () => {
  try {
    console.log("🔧 Initializing database...");
    await initializeDatabase();
    console.log("✅ Database initialized successfully");
  } catch (error) {
    console.error("❌ Database initialization failed:", error);
    process.exit(1);
  }
};

// Server port
const PORT = process.env.PORT || 5000;
const ENVIRONMENT = process.env.NODE_ENV || "development";

server.listen(PORT, async () => {
  await initializeApp();
  console.log(`\n🚀 KuizRoom Server Running`);
  console.log(`📡 Port: ${PORT}`);
  console.log(`🔐 Environment: ${ENVIRONMENT}`);
  console.log(`📊 Metrics Collection: ENABLED`);
  console.log(`✨ Ready for connections!\n`);
});

// Graceful shutdown
process.on("SIGTERM", () => {
  console.log("SIGTERM signal received: closing HTTP server");
  server.close(() => {
    console.log("HTTP server closed");
    process.exit(0);
  });
});

module.exports = { server, io };
