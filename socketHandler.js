// socketHandler.js
const jwt = require('jsonwebtoken');
const { createClient } = require('redis');
// We no longer need the Message model here, as the server cannot read/save encrypted messages.
// const Message = require('./models/Message'); 

// Initialize Redis client
const redisClient = createClient({
    url: `redis://${process.env.REDIS_HOST}:${process.env.REDIS_PORT}`
});
redisClient.on('error', (err) => console.log('Redis Client Error', err));

// *** NEW: In-memory store for public keys. Key: userId, Value: publicKey ***
const userPublicKeys = new Map();

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
            // IMPORTANT: The client-side code uses `decoded.user.id`. Ensure your JWT payload matches.
            socket.userId = decoded.user.id; 
            next();
        });
    });

    io.on('connection', async (socket) => {
        // === USER CONNECTED ===
        console.log(`User connected: ${socket.userId} with socket ID: ${socket.id}`);
        await redisClient.set(socket.userId, socket.id);
        
        // Let other users know this user is online (the key will be sent separately)
        socket.broadcast.emit('user_connected', { userId: socket.userId });
        
        // === HANDLE PUBLIC KEY EVENTS ===

        // 1. Listen for a user publishing their key upon connection
        socket.on('publish_key', ({ publicKey }) => {
            console.log(`Storing public key for user: ${socket.userId}`);
            userPublicKeys.set(socket.userId, publicKey);
            // Announce the new user's public key to everyone else
            socket.broadcast.emit('user_connected', { userId: socket.userId, publicKey: publicKey });
        });

        // 2. Listen for a client requesting all other online users' keys
        socket.on('get_public_keys', async ({ userIds }) => {
            const keysToSend = {};
            for (const id of userIds) {
                if (userPublicKeys.has(id)) {
                    keysToSend[id] = userPublicKeys.get(id);
                }
            }
            // Send the list of public keys back to only the requesting client
            socket.emit('public_keys_list', keysToSend);
        });

        // === GET ONLINE USERS LIST ===
        socket.on('get_online_users', async () => {
            try {
                // Fetch all keys from Redis, which represent online user IDs
                const onlineUserIds = await redisClient.keys('*');
                const otherUserIds = onlineUserIds.filter(id => id !== socket.userId);
                socket.emit('online_users_list', otherUserIds);
            } catch (error) {
                console.error("Error fetching online users:", error);
            }
        });

        // === HANDLE ENCRYPTED PRIVATE MESSAGES ===
        socket.on('private_message', async ({ recipientId, content, tempId }) => {
            try {
                const recipientSocketId = await redisClient.get(recipientId);

                if (recipientSocketId) {
                    // The server's job is just to forward the encrypted data.
                    // It CANNOT read the 'content'. We do not save it to the database.
                    const messagePayload = {
                        sender: socket.userId,
                        recipient: recipientId,
                        content: content, // This is the encrypted gibberish
                        timestamp: new Date().toISOString(),
                        tempId: tempId // Echo back the tempId so the sender can reconcile
                    };

                    // Send to the specific recipient
                    io.to(recipientSocketId).emit('new_message', messagePayload);
                    // Also send the message back to the sender so they can confirm it was sent
                    socket.emit('new_message', messagePayload);

                } else {
                    console.log(`Cannot send message: User ${recipientId} is not online.`);
                }
            } catch (error) {
                console.error("Error handling private message:", error);
            }
        });

        // === USER DISCONNECTED ===
        socket.on('disconnect', async () => {
            console.log(`User disconnected: ${socket.userId}`);
            
            // Remove the user's data from Redis and the public key map
            await redisClient.del(socket.userId);
            userPublicKeys.delete(socket.userId);

            // Let other users know this user is offline
            socket.broadcast.emit('user_disconnected', { userId: socket.userId });
        });
    });
};

module.exports = initializeSocket;
