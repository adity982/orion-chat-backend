const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

// 1. Initialize Express and the HTTP server
const app = express();
const server = http.createServer(app);

// 2. Attach Socket.IO and configure CORS to allow all connections
const io = new Server(server, {
  cors: {
    origin: "*", // This is the crucial part that prevents the error
    methods: ["GET", "POST"]
  }
});

// This object will temporarily store our online users
const onlineUsers = {};

// 3. Listen for new connections
io.on('connection', (socket) => {
  console.log(`A user connected with socket ID: ${socket.id}`);

  // Listen for a user to register with their unique ID
  socket.on('register', (userId) => {
    onlineUsers[userId] = socket.id;
    console.log(`User registered: ${userId} with socket ID: ${socket.id}`);
    console.log("Current online users:", onlineUsers);
  });

  // Listen for a private message
  socket.on('private_message', ({ recipientId, content }) => {
    console.log(`Message from socket ${socket.id} to user ${recipientId}: ${content}`);
    const recipientSocketId = onlineUsers[recipientId];
    
    if (recipientSocketId) {
      const senderId = Object.keys(onlineUsers).find(key => onlineUsers[key] === socket.id);
      io.to(recipientSocketId).emit('new_message', {
        sender: senderId || 'Unknown',
        content: content,
      });
    } else {
      console.log(`User ${recipientId} is not online.`);
    }
  });

  // Clean up when a user disconnects
  socket.on('disconnect', () => {
    const disconnectedUserId = Object.keys(onlineUsers).find(key => onlineUsers[key] === socket.id);
    if (disconnectedUserId) {
      delete onlineUsers[disconnectedUserId];
      console.log(`User ${disconnectedUserId} disconnected and was removed.`);
      console.log("Current online users:", onlineUsers);
    }
  });
});

// 4. Define the port and start the server
const PORT = process.env.PORT || 3002;
server.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});