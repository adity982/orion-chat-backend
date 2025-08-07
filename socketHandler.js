// socketHandler.js
const jwt = require('jsonwebtoken');
const { createClient } = require('redis');
const Message = require('./models/Message');

// Initialize Redis client
const redisClient = createClient({
    url: `redis://${process.env.REDIS_HOST}:${process.env.REDIS_PORT}`
});
redisClient.on('error', (err) => console.log('Redis Client Error', err));

const initializeSocket = async (io) => {
    await redisClient.connect();
    console.log("Redis Client Connected for Socket Handling.");

    // Middleware for authenticating socket connections with JWT
    io.use((socket, next) => {
        const token = socket.handshake.auth.token;
        if (!token) {
            return next(new Error('Authentication error: Token not provided'));
        }
        jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
            if (err) {
                return next(new Error('Authentication error: Invalid token'));
            }
            socket.userId = decoded.user.id; // Attach user ID to the socket
            next();
        });
    });

    io.on('connection', async (socket) => {
        // === USER CONNECTED ===
        console.log(`User connected: ${socket.userId} with socket ID: ${socket.id}`);

        // Store user's socket ID in Redis. Key: userId, Value: socket.id
        await redisClient.set(socket.userId, socket.id);

        // Let other users know this user is online
        socket.broadcast.emit('user_connected', { userId: socket.userId });
        
        // ===================================================================
        // === START: NEW CODE ADDED ===
        // This listens for a request from a client to get the current online user list.
        socket.on('get_online_users', async () => {
            try {
                const onlineUserIds = await redisClient.keys('*');
                // We remove the current user from the list they receive
                const otherUserIds = onlineUserIds.filter(id => id !== socket.userId);
                // Send the list back to only the requesting client
                socket.emit('online_users_list', otherUserIds);
            } catch (error) {
                console.error("Error fetching online users:", error);
            }
        });
        // === END: NEW CODE ADDED ===
        // ===================================================================

        // === HANDLE PRIVATE MESSAGES ===
        socket.on('private_message', async ({ recipientId, content }) => {
            try {
                // Find recipient's socket ID from Redis
                const recipientSocketId = await redisClient.get(recipientId);

                if (recipientSocketId) {
                    // Save the message to MongoDB
                    const message = new Message({
                        sender: socket.userId,
                        recipient: recipientId,
                        content: content
                    });
                    await message.save();

                    // Emit the new message to the recipient
                    io.to(recipientSocketId).emit('new_message', {
                        sender: socket.userId,
                        content: message.content,
                        timestamp: message.createdAt
                    });
                } else {
                    console.log(`User ${recipientId} is not online.`);
                    // Optionally, you can still save the message for offline delivery later
                }
            } catch (error) {
                console.error("Error handling private message:", error);
            }
        });

        // === USER DISCONNECTED ===
        socket.on('disconnect', async () => {
            console.log(`User disconnected: ${socket.userId}`);
            
            // Remove the user from Redis
            await redisClient.del(socket.userId);

            // Let other users know this user is offline
            socket.broadcast.emit('user_disconnected', { userId: socket.userId });
        });
    });
};

module.exports = initializeSocket;