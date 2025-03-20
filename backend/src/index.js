const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const Redis = require('redis');

// Create Express app
const app = express();
app.use(cors());
const server = http.createServer(app);

// Set up Socket.IO
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Connect to Redis
const redisClient = Redis.createClient({
  url: process.env.REDIS_URL || 'redis://redis:6379'
});

// Handle Redis connection
(async () => {
  await redisClient.connect();
})();

redisClient.on('error', (err) => {
  console.log('Redis Client Error', err);
});

// Queue for users waiting to be matched
let waitingQueue = [];

// Map to store active connections
const activeSessions = new Map();

io.on('connection', (socket) => {
  console.log(`User connected: ${socket.id}`);
  
  // User starts looking for a chat
  socket.on('find-chat', async () => {
    console.log(`User ${socket.id} is looking for a chat`);
    
    // If someone else is waiting, create a chat session
    if (waitingQueue.length > 0) {
      const partnerId = waitingQueue.shift();
      
      // Prevent connecting to self
      if (partnerId === socket.id) {
        console.log('User tried to connect to self, adding back to queue');
        waitingQueue.push(socket.id);
        return;
      }
      
      const partnerSocket = io.sockets.sockets.get(partnerId);
      
      if (partnerSocket) {
        // Create a unique room ID
        const roomId = `room_${partnerId}_${socket.id}`;
        
        // Add users to the room
        socket.join(roomId);
        partnerSocket.join(roomId);
        
        // Store session info
        activeSessions.set(socket.id, { partnerId, roomId });
        activeSessions.set(partnerId, { partnerId: socket.id, roomId });
        
        // Notify both users
        io.to(roomId).emit('chat-started', { roomId });
        console.log(`Chat started in room: ${roomId} between ${socket.id} and ${partnerId}`);
      } else {
        // If partner socket not found, add current user to queue
        waitingQueue.push(socket.id);
      }
    } else {
      // No one waiting, add to queue
      waitingQueue.push(socket.id);
    }
  });
  
  // Handle chat messages
  socket.on('send-message', (data) => {
    const session = activeSessions.get(socket.id);
    if (session) {
      io.to(session.roomId).emit('receive-message', {
        senderId: socket.id,
        message: data.message,
        timestamp: new Date().toISOString()
      });
    }
  });
  
  // WebRTC Signaling - ICE Candidate
  socket.on('ice-candidate', (data) => {
    const session = activeSessions.get(socket.id);
    if (session && session.partnerId) {
      const partnerSocket = io.sockets.sockets.get(session.partnerId);
      if (partnerSocket) {
        partnerSocket.emit('ice-candidate', data);
      }
    }
  });
  
  // WebRTC Signaling - Session Description Protocol (SDP)
  socket.on('sdp-offer', (data) => {
    const session = activeSessions.get(socket.id);
    if (session && session.partnerId) {
      const partnerSocket = io.sockets.sockets.get(session.partnerId);
      if (partnerSocket) {
        partnerSocket.emit('sdp-offer', data);
      }
    }
  });
  
  // WebRTC Signaling - SDP Answer
  socket.on('sdp-answer', (data) => {
    const session = activeSessions.get(socket.id);
    if (session && session.partnerId) {
      const partnerSocket = io.sockets.sockets.get(session.partnerId);
      if (partnerSocket) {
        partnerSocket.emit('sdp-answer', data);
      }
    }
  });
  
  // Media controls update
  socket.on('media-controls', (data) => {
    const session = activeSessions.get(socket.id);
    if (session && session.partnerId) {
      const partnerSocket = io.sockets.sockets.get(session.partnerId);
      if (partnerSocket) {
        partnerSocket.emit('media-controls', {
          type: data.type,
          enabled: data.enabled,
          senderId: socket.id
        });
      }
    }
  });
  
  // Handle "next" request (skip current chat partner)
  socket.on('next', () => {
    const session = activeSessions.get(socket.id);
    if (session) {
      const partnerSocket = io.sockets.sockets.get(session.partnerId);
      
      // Leave current room
      socket.leave(session.roomId);
      if (partnerSocket) {
        partnerSocket.leave(session.roomId);
        // Notify partner
        partnerSocket.emit('chat-ended', { reason: 'partner-skipped' });
        // Clean up partner's session
        activeSessions.delete(session.partnerId);
      }
      
      // Clean up current user's session
      activeSessions.delete(socket.id);
      
      // Put user back in waiting queue
      waitingQueue.push(socket.id);
      socket.emit('finding-new-chat');
    }
  });
  
  // Handle disconnection
  socket.on('disconnect', () => {
    console.log(`User disconnected: ${socket.id}`);
    
    // Remove from waiting queue if there
    waitingQueue = waitingQueue.filter(id => id !== socket.id);
    
    // Notify partner if in an active session
    const session = activeSessions.get(socket.id);
    if (session) {
      const partnerSocket = io.sockets.sockets.get(session.partnerId);
      if (partnerSocket) {
        partnerSocket.emit('chat-ended', { reason: 'partner-disconnected' });
      }
      
      // Clean up sessions
      activeSessions.delete(session.partnerId);
      activeSessions.delete(socket.id);
    }
  });
});

// Root route
app.get('/', (req, res) => {
  res.send('Omegle-like POC Backend with WebRTC Support is running');
});

// Start server
const PORT = process.env.PORT || 4000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
});