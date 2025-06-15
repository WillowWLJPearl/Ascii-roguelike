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
  sendOnlyTo(socket.id, "mapData", {map, width: 40, height: 20})

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
function sendOnlyTo(sockId, channel, payload) {
  if (sockId) {
    io.to(sockId).emit(channel, payload);
  }
}
let maps = []
let map = []
let entities = {};
function generateMap(height, width) {
  map = [];
  for (let y = 0; y < height; y++) {
    const row = [];
    for (let x = 0; x < width; x++) {
      row.push({
        base: (x === 0 || y === 0 || x === width - 1 || y === height - 1) ? '#' : '.',
        top: [], bl: [], br: [],
        color: (x === 0 || y === 0 || x === width - 1 || y === height - 1) ? '#444' : '#111',
        name: (x === 0 || y === 0 || x === width - 1 || y === height - 1) ? 'Barrier' : 'Floor',
        meta: {}
      });
    }
    map.push(row);
  }
}

(async ()=>{
generateMap(20, 40)

    })();

server.listen(8000, () => {
  console.log('▶ listening on http://localhost:8000');
});
