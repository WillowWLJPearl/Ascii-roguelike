// server.js
const path    = require('path');
const express = require('express');
const http    = require('http');
const { Server } = require('socket.io');

const app    = express();
const server = http.createServer(app);
const io     = new Server(server);

// 1) serve everything in /public as static files
app.use(express.static(path.join(__dirname, 'public')));

// 2) handle socket connections
io.on('connection', socket => {
  console.log('➕ client connected:', socket.id);

  // Example: immediately spawn them at a random floor tile
  const x = Math.floor(Math.random() * 40);
  const y = Math.floor(Math.random() * 20);
  socket.emit('spawn', { id: socket.id, x, y, dir: 'down' });

  // broadcast join to others
  socket.broadcast.emit('playerJoined', { id: socket.id, x, y, dir: 'down' });

  socket.on('move', ({ dx, dy }) => {
    // you’d update your server-side state here...
    socket.broadcast.emit('playerMoved', { id: socket.id, dx, dy });
  });

  socket.on('disconnect', () => {
    console.log('➖ client left:', socket.id);
    socket.broadcast.emit('playerLeft', socket.id);
  });
});



server.listen(8000, () => {
  console.log('▶ listening on http://localhost:8000');
});
