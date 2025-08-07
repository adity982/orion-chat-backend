// server.js
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
require('dotenv').config();
const cors = require('cors'); // <-- 1. IMPORT IT HERE

const connectDB = require('./db');
const initializeSocket = require('./socketHandler');
const authRoutes = require('./auth');

// Initialize App
const app = express();
const server = http.createServer(app);

// This is the Socket.IO specific CORS for its own connections. Keep it.
const io = new Server(server, {
  cors: {
    origin: "http://localhost:5173",
    methods: ["GET", "POST"]
  }
});

// Connect to Database
connectDB();

// ===================================================================
// === USE THE CORS MIDDLEWARE FOR ALL EXPRESS API ROUTES ===
// This will handle the preflight requests correctly.
app.use(cors({
    origin: "http://localhost:5173" 
}));
// ===================================================================


// Middlewares
app.use(express.json()); // Allows us to accept JSON in request body

// Define Routes
app.use('/api/auth', authRoutes);

// Initialize Socket.IO Handler
initializeSocket(io);

// Start Server
const PORT = process.env.PORT || 3002;
server.listen(PORT, () => console.log(`Server started on port ${PORT}`));