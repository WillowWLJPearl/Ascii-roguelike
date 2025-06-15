// client.js
const socket = io();  // <-- global `io` from /socket.io/socket.io.js

let myId = null;

// when the server tells us “here’s your spawn”
socket.on('spawn', ({ id, x, y, dir }) => {
  myId = id;
  addEntity('player', x, y, '@', '#4f4', { /* … */ }, `P#${id}`);
  setDirectionAt(x, y, dir);
  drawViewport();
});

// when others join
socket.on('playerJoined', ({ id, x, y, dir }) => {
  addEntity('player', x, y, '@', '#4f4', {}, `P#${id}`);
  setDirectionAt(x, y, dir);
});

// when someone moves
socket.on('playerMoved', ({ id, dx, dy }) => {
  const uid = `player-${id}`;
  moveEntity(uid, dx, dy);
  drawViewport();
});

// when someone leaves
socket.on('playerLeft', id => {
  const uid = `player-${id}`;
  delete entities[uid];
  document.getElementById(`entity-${uid}`)?.remove();
});

// send our moves to the server
document.addEventListener('keydown', e => {
  const dirMap = {
    ArrowUp:    [0, -1],
    ArrowDown:  [0,  1],
    ArrowLeft:  [-1, 0],
    ArrowRight: [1,  0]
  };
  if (dirMap[e.key]) {
    const [dx, dy] = dirMap[e.key];
    socket.emit('move', { dx, dy });
  }
});
