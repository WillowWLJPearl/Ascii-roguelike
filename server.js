// server.js
const path    = require('path');
const express = require('express');
const http    = require('http');
const { Server } = require('socket.io');

const app    = express();
const server = http.createServer(app);
const io     = new Server(server);
let _nextEntityUID = 1;
let typeIndex = {}; 
// 1) serve everything in /public as static files
app.use(express.static(path.join(__dirname, 'public')));

function setEntityData(id, key, value) {
  if (!entities[id]) return;
  entities[id].meta[key] = value;
}
function getEntityData(id, key) {
  return entities[id]?.meta[key];
}
const blockBases    = ['#'];
const blockStatuses = ['S'];
const blockTypes    = ['W'];
function moveEntity(uid, dx, dy, width, height) {
  const e = entities[uid];
  if (!e) return;
  const nx = e.x + dx, ny = e.y + dy;

  // 1) out of bounds?
  if (nx < 0 || nx >= width || ny < 0 || ny >= height) return;

  // 2) tile‐based blockage
  const cell = map[ny][nx];
  if (blockBases.includes(cell.base)) return;

  // 3) map‐overlay statuses (e.g. S, …)
  if (cell.top.some(s => blockStatuses.includes(s))) return;

  // 4) map‐overlay types (e.g. W, …)
  if (cell.br.some(t => blockTypes.includes(t))) return;

  // 5) entity‐based blockage (if you ever want e.g. two creatures can't stack)
  const blockingHere = Object.values(entities).some(other =>
    other.x === nx && other.y === ny && blockTypes.includes(other.type)
  );
  if (blockingHere) return;

  e.x = nx;
  e.y = ny;
    
  // — if we get here it’s free to move —
  // restore the old floor cell
sendOnlyTo(getEntityData(uid, 'socketId'), 'moveEntity',{list: entities, changed: uid, map: {seen: entities[uid].seen, fovMask : entities[uid].fovMask, map: entities[uid].visibleMap}})
}

function isInFovOf(entity) {
 Object.entries(entities).forEach(([id, e]) => {
  if(e.fovMask[entity.y]?.[entity.x]) {
    return {id, e}
  }
 })
}
function assembleBoolMap(newmapinfo, mainmap) {
      const mapHeight = mainmap.length;
  const mapWidth = mainmap[0]?.length || 0;
  for (let y=0; y < mapHeight; y++){
      for (let x=0; x < mapWidth; x++){   
        if(newmapinfo[y]?.[x]) {
          mainmap[x][y] = newmapinfo[x][y]
        }
      }
  }
  return mainmap
}
function generateEdgeTile(x, y) {
  return {
    char: '',
    name: 'void',
    type: ''
  }
}


function getMapCell(currentMap, x, y) {
  if (y >= 0 && y < currentMap.length && x >= 0 && x < currentMap[0].length) {
    return currentMap[y][x];  // real tile
  } else {
    const key = `${x},${y}`;
    if (!generatedEdges[key]) {
      generatedEdges[key] = generateEdgeTile(x, y);
    }
    return generatedEdges[key];
  }
}
function assembleVisibleMaps() {
      const mapHeight = map.length;
  const mapWidth = map[0]?.length || 0;
 Object.entries(entities).forEach(([id, e]) => {
  revealFOV(id)
  for (let y=0; y < mapHeight; y++){
      for (let x=0; x < mapWidth; x++){   
        if(e.seen[y]?.[x]) {
          if(map[y]?.[x]) {
          e.visibleMap[y][x] = map[y][x]
          }
        }
      }
  }
})
}
// 2) handle socket connections
io.on('connection', socket => {
  console.log('➕ client connected:', socket.id);

  let newplayer = addEntity('player', 3, 3, '@', '#404', {}, 'UserRandom')
  setEntityData(newplayer, 'socketId', socket.id)

  assembleVisibleMaps()
  sendOnlyTo(socket.id, "mapData", {map: {seen: entities[newplayer].seen, fovMask : entities[newplayer].fovMask, map: entities[newplayer].visibleMap}, width: 40, height: 20})

  sendOnlyTo(socket.id, 'clientPlayer', newplayer)
  
  sendOnlyTo(socket.id, "entityData", {list: entities, changed: newplayer})



  // broadcast join to others
 // socket.broadcast.emit('playerJoined', { id: socket.id, x, y, dir: 'down' });

  socket.on('move', data => {
    assembleVisibleMaps()
    moveEntity(data.currentplayer, data.dx, data.dy, 40, 20)
  });

  socket.on('disconnect', () => {
    console.log('➖ client left:', socket.id);
    socket.broadcast.emit('playerLeft', socket.id);
  });
});

function getPlayerBySocket(socketId) {
  return Object.entries(entities).filter(([id, e]) => getEntityData(id, 'socketId') === socketId)[0]
}
function sendOnlyTo(sockId, channel, payload) {
  if (sockId) {
    io.to(sockId).emit(channel, payload);
  }
}
let maps = []
let map = []
let entities = {};


function VisibleMapBase(width, height) {
  let visibleMap = [];
  for (let y = 0; y < height; y++) {
    const row = [];
    for (let x = 0; x < width; x++) {
      row.push({
        base:  '',
        top: [], bl: [], br: [],
        color: '#111',
        name:  'Darkness',
        meta: {}
      });
    }
    visibleMap.push(row);
  }
  return visibleMap
}
function addEntity(type,x,y,char,color,overlays,name){

    const mapHeight = map.length;
  const mapWidth = map[0]?.length || 0;
  let visibleMap = VisibleMapBase(mapWidth, mapHeight)
  const uid = `${type}-${_nextEntityUID++}`;
  entities[uid] = {
    visibleMap,
  seen    : Array.from({length:mapHeight}, ()=>Array(mapWidth).fill(false)),
  fovMask : Array.from({length:mapHeight}, ()=>Array(mapWidth).fill(false)),
  lightMask : Array.from({length: mapHeight},()=>Array(mapWidth).fill(false)),
  FOV_RADIUS: 6,
    type,
    x, y,
    char,
    color,
    name: name||type,
    top: overlays.top?.slice()||[],
    bl:  overlays.bl ?.slice()||[],
    br:  overlays.br ?.slice()||[],
    dir:'down',
    meta:{}
  };
  (typeIndex[type] ||= []).push(uid);
  return uid;
}
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

// half-angle of cone in radians (45° here)
const HALF_CONE_RAD = Math.PI / 4;
const COS_HALF_CONE = Math.cos(HALF_CONE_RAD);

// Bresenham’s line from (x0,y0) → (x1,y1)
function bresenhamLine(x0, y0, x1, y1) {
  const pts = [];
  let dx = Math.abs(x1 - x0), sx = x0 < x1 ? 1 : -1;
  let dy = -Math.abs(y1 - y0), sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  while (true) {
    pts.push([x0, y0]);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x0 += sx; }
    if (e2 <= dx) { err += dx; y0 += sy; }
  }
  return pts;
}

// returns true if the vector (dx,dy) lies within the cone of `dir`
function inCone(dx, dy, dir) {
  const [vx, vy] = DIR_VECTORS[dir];
  const dist = Math.hypot(dx, dy);
  if (dist === 0) return true;           // own tile always visible
  const nx = dx / dist, ny = dy / dist;
  const dot = nx * vx + ny * vy;
  return dot >= COS_HALF_CONE;
}
const DIR_VECTORS = {
  up:    [ 0, -1],
  right: [ 1,  0],
  down:  [ 0,  1],
  left:  [-1,  0],
};
function revealFOV(playerUid) {
  if (!playerUid || !entities[playerUid]) return;
  clearFovMask(playerUid);
  const height = map.length;
  const width = map[0]?.length || 0;
  const p   = entities[playerUid];
  const px  = p.x, py = p.y, dir = p.dir;

  // always see your own tile
  
  p.seen[py][px]    = true;
  p.fovMask[py][px] = true;
  // cast rays in your cone (your existing Bresenham code) …
  for (let dy = -p.FOV_RADIUS; dy <= p.FOV_RADIUS; dy++) {
    for (let dx = -p.FOV_RADIUS; dx <= p.FOV_RADIUS; dx++) {
      const tx = px+dx, ty = py+dy;
      if (tx<0||tx>=width||ty<0||ty>=height) continue;
      if (dx*dx + dy*dy > p.FOV_RADIUS*p.FOV_RADIUS) continue;
      if (!inCone(dx,dy,dir)) continue;

      const line = bresenhamLine(px,py,tx,ty);
      let blocked = false;
      for (let i = 1; i < line.length; i++) {
        const [cx,cy] = line[i];
        entities[playerUid].seen[cy][cx] = true;
        if (!blocked) {
          entities[playerUid].fovMask[cy][cx] = true;
        }
        const cell = map[cy][cx];
        if (
             blockBases   .includes(cell.base)
          || cell.top   .some(s => blockStatuses.includes(s))
          || cell.br    .some(t => blockTypes.includes(t))
        ) {
          blocked = true;
          break;
        }
      }
    }
  }
}


function clearFovMask(playerUid){
        const mapHeight = map.length;
  const mapWidth = map[0]?.length || 0;
  for(let y=0; y<mapHeight; y++){
    for(let x=0; x<mapWidth; x++){
      entities[playerUid].fovMask[y][x] = false;
    }
  }
}

(async ()=>{
generateMap(20, 40)

    })();

server.listen(8000, '0.0.0.0', () => {
  console.log('▶ listening on http://localhost:8000');
});
