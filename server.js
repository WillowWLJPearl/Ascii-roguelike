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
function moveEntity(uid, dx, dy) {
  const e = entities[uid];
  if (!e) return false;

  // 1) compute raw new local coords, and chunk‐offsets
  const rawX = e.x + dx;
  const rawY = e.y + dy;

  // how many chunks to move in each axis?
  const deltaCX = Math.floor(rawX / chunkWidth);
  const deltaCY = Math.floor(rawY / chunkHeight);

  // wrap into [0..chunkWidth) and [0..chunkHeight)
  const nx = ((rawX % chunkWidth) + chunkWidth) % chunkWidth;
  const ny = ((rawY % chunkHeight) + chunkHeight) % chunkHeight;

  // target chunk coords
  const targetCX = e.cx + deltaCX;
  const targetCY = e.cy + deltaCY;

  // 2) grab (or generate) that chunk
  const chunk = getChunkByMapId(e.map, targetCX, targetCY);
  const cell  = chunk.data[ny][nx];

  // 3) tile‐based blockage (uncomment if you want base '#' to block)
  // if (blockBases.includes(cell.base)) return false;

  // 4) map‐overlay statuses/types
  if (cell.top.some(s => blockStatuses.includes(s))) return false;
  if (cell.br .some(t => blockTypes   .includes(t))) return false;

  // 5) entity‐based blockage
  const blockingHere = Object.values(entities).some(other =>
    other.map === e.map &&
    other.cx  === targetCX &&
    other.cy  === targetCY &&
    other.x   === nx &&
    other.y   === ny &&
    blockTypes.includes(other.type)
  );
  if (blockingHere) return false;

  // 6) all clear — commit new position
  e.cx = targetCX;
  e.cy = targetCY;
  e.x  = nx;
  e.y  = ny;

  console.log(e.cx, e.cy)
  assembleVisibleMaps();
  return true;
}



function entitiesInFovOf(viewer) {
  let idList = entityIdsInFov(viewer)
  let newentitieslist = {}
  idList.forEach(id => {
    newentitieslist[id] = entities[id]
  })
  return newentitieslist
}
function entityIdsInFov(viewer) {
  return Object.entries(entities)
    .filter(([uid, e]) => (viewer.fovMask[e.y]?.[e.x] || viewer.lightMask[e.y]?.[e.x]))
    .map(([uid]) => uid);
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
function assembleVisibleMaps(mapId = 'overworld') {
      const mapHeight = chunkHeight
  const mapWidth = chunkWidth
 Object.entries(entities).forEach(([id, e]) => {
   let relativeMap = calculateRelativeChunk(mapId, e.cy, e.cx, e.y, e.x)
  revealFOV(id)
  for (let y=0; y < mapHeight; y++){
      for (let x=0; x < mapWidth; x++){   
        if(e.seen[y]?.[x]) {
          if(relativeMap[y]?.[x]) {
          e.visibleMap[y][x] = relativeMap[y][x]
          }
        }
      }
  }
})
}

const buffers = new Map();
// 2) handle socket connections
io.on('connection', socket => {
  console.log('➕ client connected:', socket.id);

  let available
        const mapHeight = map.length;
  const mapWidth = map[0]?.length || 0;
  for (let y=0; y < mapHeight; y++){
      for (let x=0; x < mapWidth; x++){   
        if(map[y][x].name === "Floor") {
          available = {x, y}
        }
      }
  }

  let newplayer = addEntity('player', available.x, available.y, '@', '#404', {}, 'UserRandom')
  setEntityData(newplayer, 'socketId', socket.id)

  assembleVisibleMaps()
  sendOnlyTo(socket.id, "mapData", {map: {seen: entities[newplayer].seen[entities[newplayer].map], fovMask : entities[newplayer].fovMask, map: entities[newplayer].visibleMap}, width: 32, height: 32})

  sendOnlyTo(socket.id, 'clientPlayer', newplayer)
  
  sendOnlyTo(socket.id, "entityData", {list: entitiesInFovOf(entities[newplayer]), changed: newplayer})


  // broadcast join to others
 // socket.broadcast.emit('playerJoined', { id: socket.id, x, y, dir: 'down' });

 socket.on('wait', data => {
  TickManager('overworld')
  })
  socket.on('disconnect', () => {
    console.log('➖ client left:', socket.id);
    socket.broadcast.emit('playerLeft', socket.id);
  });
    socket.on('alldata', () => {
    sendOnlyTo(socket.id,'alldata', {entities, map})
  });
});
io.on('connection', socket => {
  socket.on('move', data => {
    if(moveEntity(data.currentplayer, data.dx, data.dy, 32, 32)) {
      assembleVisibleMaps()
      let buf = buffers.get(socket.id);
          if (!buf) {
      buf = { pieces: [] };
      buffers.set(socket.id, buf);
    }
    buf.pieces.push(data);
   // updateMapNEntityData(data.currentplayer, 'move', data)
   // TickManager(map)
    }
  });

    socket.on('turn', data => {
    if(entities[data.currentplayer].dir !== data.dir) {
      turnEntity(data.currentplayer, data.dir)
      assembleVisibleMaps()
      let buf = buffers.get(socket.id);
          if (!buf) {
      buf = { pieces: [] };
      buffers.set(socket.id, buf);
    }
    buf.pieces.push(data);
    //  updateMapNEntityData(data.currentplayer, 'turn', data)
    //  TickManager(map)
    }
  });
  socket.on('commitData', () => {
    const buf = buffers.get(socket.id);
    if (buf) {
      handleBatchData(buf.pieces, socket);
      buffers.delete(socket.id);
    }
  });
})
let mapData = {map: [], playermovements: 0}
function TickManager(currentMap) {
   mapData = {map: currentMap, playermovements: mapData.playermovements+1}
   playeramount = getUIDsByType('player').length
   
   if(mapData.playermovements >= playeramount) {
    mapData.playermovements = 0
    Tick(mapData.map)
   }
}
function turnEntity(uid, dir){
  const e = entities[uid]; if(!e) return;
  e.dir = dir;
  (entities[uid] ||= {}).top = [ {up:'↑',down:'↓',left:'←',right:'→'}[dir] ];
assembleVisibleMaps()

}
function handleBatchData(pieces, socket) {
pieces.forEach(data => {
  let p = data.currentplayer
//updateMapNEntityData(p, data.action, data, true)
updateMapNEntityData(p, 'lightweight', data, true)
TickManager(entities[p].map)
})
}

function updateMapNEntityData(uid, protocol = 'noAction', data, batch = false) {
      const mapHeight = map.length;
  const mapWidth = map[0]?.length || 0;

  let firstPerPlayerInstanceData = {entity: entities[uid], seenEntities: entitiesInFovOf(entities[uid])}
/*
  if(protocol === 'move') {

    if(batch && moveEntity(data.currentplayer, data.dx, data.dy, 32, 32)) return;
sendOnlyTo(getEntityData(uid, 'socketId'), "mapNEntityData", {list: entitiesInFovOf(entities[uid]), changed: uid})
  }
  if(protocol === 'turn') {

      turnEntity(data.currentplayer, data.dir)
      if(batch) return;
sendOnlyTo(getEntityData(uid, 'socketId'), "mapNEntityData", {list: entitiesInFovOf(entities[uid]), changed: uid})
  }
*/

  if(protocol === 'noAction') {
    sendOnlyTo(getEntityData(uid, 'socketId'), "entityData", {list: entitiesInFovOf(entities[uid]), changed: uid})
sendOnlyTo(getEntityData(uid, 'socketId'), 'mapData',{map: {lightMask: entities[uid].lightMask, seen: entities[uid].seen[entities[uid].map], fovMask : entities[uid].fovMask, map: entities[uid].visibleMap}, width: mapWidth, height: mapHeight} )
  } else
    if(protocol ==='lightweight') {
    sendOnlyTo(getEntityData(uid, 'socketId'), "mapNEntityData", {list: entitiesInFovOf(entities[uid]), changed: uid})
  }
}
function getPlayerBySocket(socketId) {
  return Object.entries(entities).filter(([id, e]) => getEntityData(id, 'socketId') === socketId)[0]
}
function sendOnlyTo(sockId, channel, payload) {
  if (sockId) {
    io.to(sockId).emit(channel, payload);
  }
}
let maps = {}
//let map = []
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
const chunkHeight = 32
const chunkWidth = 32

function addEntity(type,x,y,char,color,overlays,name,map='overworld',chunkx=0,chunky=0){
  let visibleMap = VisibleMapBase(chunkWidth, chunkHeight)
  const uid = `${type}-${_nextEntityUID++}`;
  const initialSeenMatrix = Array.from(
    { length: chunkHeight },
    () => Array(chunkWidth).fill(false)
  );
  const seen = {};
  seen[map] = {
    map: {
      chunks: [
        { x: chunkx, y: chunky, data: initialSeenMatrix }
      ]
    }
  };

  entities[uid] = {
    visibleMap,
  seen,
  fovMask : Array.from({length:chunkHeight}, ()=>Array(chunkWidth).fill(false)),
  lightMask : Array.from({length: chunkHeight},()=>Array(chunkWidth).fill(false)),
  FOV_RADIUS: 6,
    type,
    x, y,
    cy: chunky, cx: chunkx,
    map,
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
function generateProceduralMap(id, height, width, chunk) {
  let data = []
  for (let y = 0; y < height; y++) {
    const row = [];
    for (let x = 0; x < width; x++) {
      row.push({
        base: '.',
        top: [], bl: [], br: [],
        color: (x === 0 || y === 0 || x === width - 1 || y === height - 1) ? '#444' : '#111',
        name: 'Floor',
        meta: {}
      });
    }
    data.push(row);
  }
  if(!maps){
     maps = {}
  }
    if(!maps[id]){
     maps[id] = {map:{}, type: id}
  }
      if(!maps[id].map.chunks){
    maps[id].map = {chunks: []};
  }
  let chunks = maps[id].map.chunks
  chunks.push({x: chunk.x, y: chunk.y, data})
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
function generateSeenArray(uid, mapId, cx, cy) {
  const entity = entities[uid];
  if (!entity.seen[mapId]) {
    entity.seen[mapId] = { map: { chunks: [] } };
  }
  entity.seen[mapId].map.chunks.push({
    x: cx,
    y: cy,
    data: Array.from({ length: chunkHeight }, () =>
      Array(chunkWidth).fill(false)
    )
  });
}
function getSeenArrayOfChunk(uid, mapId, cx, cy) {
  const entity = entities[uid];
  if (!entity.seen[mapId]) {
    // no entry for this mapId yet? make it and the one chunk
    generateSeenArray(uid, mapId, cx, cy);
  }
  const chunkEntry = entity.seen[mapId].map.chunks
    .find(sc => sc.x === cx && sc.y === cy);

  if (!chunkEntry) {
    // we’ve seen _that_ mapId but not this chunk yet
    generateSeenArray(uid, mapId, cx, cy);
    return entity.seen[mapId].map.chunks
      .find(sc => sc.x === cx && sc.y === cy);
  }
  return chunkEntry;
}
function setMergeSeenArray(uid, mapId, cy, cx, array) {
  let seen = entities[uid]
  seen[mapId].map.chunks.find(sc => 
    sc.x === cx && sc.y === cy ) =
assembleBoolMap(array, seen[mapId].map.chunks.find(sc => 
    sc.x === cx && sc.y === cy ) )
}
function revealFOV(playerUid) {
  if (!playerUid || !entities[playerUid]) return;
  clearFovMask(playerUid);
  const height = chunkHeight
  const width = chunkWidth
  const p   = entities[playerUid];
  const px  = p.x, py = p.y, dir = p.dir;

  // always see your own tile
let currentSeenChunk = getSeenArrayOfChunk(playerUid, p.map, p.cx, p.cy);
currentSeenChunk.data[py][px] = true;
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
        currentSeenChunk.data[cy][cx] = true;
        if (!blocked) {
          entities[playerUid].fovMask[cy][cx] = true;
        }
        const cell = calculateRelativeChunk('overworld',p.cy, p.cx, p.y,p.x)[cy][cx];
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
function getChunkByMapId(mapId, cx, cy) {
  const mapObj = maps[mapId];
  if (!mapObj) throw new Error(`map "${mapId}" not found`);
  let chunk = mapObj.map.chunks.find(c => c.x === cx && c.y === cy);
  if (!chunk) {
    // generateProceduralMap will push a new chunk into maps[mapId].map.chunks
    generateProceduralMap(mapId, chunkHeight, chunkWidth, { x: cx, y: cy });
    chunk = mapObj.map.chunks.find(c => c.x === cx && c.y === cy);
    if (!chunk) throw new Error(`failed to generate chunk ${cx},${cy}`);
  }
  return chunk;      // chunk.data is your 2D array of tiles
}

// _2_ build a CH×CW “view” centered on the world‐cell at (cy, cx, y, x)
function calculateRelativeChunk(mapId, cy, cx, y, x) {
  const halfH = Math.floor(chunkHeight / 2);
  const halfW = Math.floor(chunkWidth  / 2);

  // world‐coords of our focal cell
  const worldCenterY = cy * chunkHeight + y;
  const worldCenterX = cx * chunkWidth  + x;

  // prepare empty CH×CW array
  const rel = Array.from({ length: chunkHeight }, () =>
    Array(chunkWidth).fill(null)
  );

  for (let ry = 0; ry < chunkHeight; ry++) {
    for (let rx = 0; rx < chunkWidth; rx++) {
      // translate back to world coords
      const worldY = worldCenterY - halfH + ry;
      const worldX = worldCenterX - halfW + rx;

      // which chunk does that live in?
      // Math.floor handles negative coords correctly
      const nCY = Math.floor(worldY / chunkHeight);
      const nCX = Math.floor(worldX / chunkWidth);

      // local coords in that chunk
      let localY = worldY - nCY * chunkHeight;
      let localX = worldX - nCX * chunkWidth;

      // pull (or generate) the neighbour chunk
      const neighbor = getChunkByMapId(mapId, nCX, nCY);

      // finally pluck the tile out
      rel[ry][rx] = neighbor.data[localY][localX];
    }
  }

  return rel;  // a chunkHeight×chunkWidth 2D array centered on (cy,cx,y,x)
}

function clearFovMask(playerUid){
        const mapHeight = chunkHeight
  const mapWidth = chunkWidth
  for(let y=0; y<mapHeight; y++){
    for(let x=0; x<mapWidth; x++){
      entities[playerUid].fovMask[y][x] = false;
    }
  }
}




function Tick(mapId) {
  getUIDsByType('player').forEach(p => {
    let pe = entities[p]
    let currentMap = calculateRelativeChunk(mapId, pe.cy, pe.cx, pe.y, pe.x)
          const height = chunkHeight
  const width = chunkWidth
    for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
     entities[p].lightMask[y][x] = false
    }
  }
  Object.entries(entities).forEach(([id, e]) => {
  // e.x, e.y, e.char, e.meta, etc.
if (e.type === "torch" && !(getEntityData(id, "burnedOut")) && entities[p].seen[e.y]?.[e.x]) {
  // have we ever seen this tile?
  const seenHere = !!entities[p].seen[e.y]?.[e.x];

  // fetch last‐frame value (default to false)
  const wasDim = getEntityData(id, "isDim") || false;

  // if it’s been seen, flip it; otherwise force off
  const isDimNow = seenHere ? !wasDim : false;
  setEntityData(id, "isDim", isDimNow);

  // only light when “on”

    entities[p].lightMask[e.y][e.x] = true;
    for (let {dx, dy} of deltas4) {
      const nx = e.x + dx, ny = e.y + dy;
      if (nx < 0||nx>=width||ny<0||ny>=height) continue;
      entities[p].lightMask[ny][nx] = true;
      entities[p].seen[ny][nx] = true;
      entities[p].visibleMap[ny][nx] = currentMap[ny][nx];
      if (isDimNow) {
      for (let {dx: ddx, dy: ddy} of deltas4) {
        const nnx = nx + ddx, nny = ny + ddy;
        if (nnx < 0||nnx>=width||nny<0||nny>=height) continue;
        entities[p].lightMask[nny][nnx] = true;
        entities[p].seen[nny][nnx] = true;
        entities[p].visibleMap[nny][nnx] = currentMap[nny][nnx];
      }
    }
  }
}

  
});


  if (p) {
    assembleVisibleMaps()
   updateMapNEntityData(p)
  }
});
}
function getChunkOfPlayer(uid) {
entities[uid]
}
const deltas4 = [
  { dx:  1, dy:  0 },  // east
  { dx: -1, dy:  0 },  // west
  { dx:  0, dy:  1 },  // south
  { dx:  0, dy: -1 }   // north
];

function getCellContents(currentMap, x, y) {
  if (!currentMap[y] || !currentMap[y][x]) return null;  // Defensive: map or cell missing
  const cell = currentMap[y][x];
  // Find entities at this location
  const ents = Object.entries(entities)
    .filter(([id, e]) => e.x === x && e.y === y)
    .map(([id, e]) => ({
      id,
      char: e.char,
      type: (e.br && e.br.length ? e.br : null),
      currentHealth: (e.bl && e.bl.length >= 1 ? e.bl[0] : null),
      maxHealth: (e.bl && e.bl.length >= 3 ? e.bl[2] : null),
      overlays: { top: e.top, bl: e.bl, br: e.br }
    }));
  return {
    cellBase: cell.base,
    cellType: cell.name || null,
    overlays: { top: cell.top, bl: cell.bl, br: cell.br },
    entities: ents
  };
}

function countCellsByType(typeName) {
  let count = 0;
  for (let y = 0; y < map.length; y++) {
    for (let x = 0; x < map[0].length; x++) {
      if (map[y][x].name === typeName) count++;
    }
  }
  return count;
}
function countCellsByChar(char) {
  let count = 0;
  for (let y = 0; y < map.length; y++) {
    for (let x = 0; x < map[0].length; x++) {
      if (map[y][x].base === char) count++;
    }
  }
  return count;
}
function getTotalCells() {
  return map.length * (map[0]?.length || 0);
}


function generateMapContentsCircular(currentMap, cb) {
      const height = currentMap.length;
  const width = currentMap[0]?.length || 0;

  const cx = Math.floor(width / 2);
  const cy = Math.floor(height / 2);
  const maxR = Math.ceil(Math.sqrt(cx*cx + cy*cy));
  let visited = Array.from({length: height}, () => Array(width).fill(false));

  for (let r = 0; r <= maxR; r++) {
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (!visited[y][x]) {
          const dist = Math.round(Math.sqrt((x - cx) ** 2 + (y - cy) ** 2));
          if (dist === r) {
            cb(currentMap, x, y, currentMap[y][x]);
            visited[y][x] = true;
          }
        }
      }
    }
  }
}
function setCellColor(currentMap, x, y, color) {
  if (!currentMap[y] || !currentMap[y][x]) return;
  currentMap[y][x].color = color;
  updateCell(x, y);
}
function getUIDsByType(type){
  return typeIndex[type]||[];
}
function roomCarverPopulator(currentMap) {
  // 1. Fill with walls
  
      const height = currentMap.length;
  const width = currentMap[0]?.length || 0;


  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    if(currentMap[y][x].base !== "#") {
    currentMap[y][x].base = "#*";
    currentMap[y][x].name = "Wall";
    currentMap[y][x].br = ["W"];
    setCellColor(x, y, "#222");
    }
  }

  // 2. Carve rooms and record their centers
  let rooms = [];
  for (let i = 0; i < 12; i++) {
    let rw = Math.floor(Math.random() * 4) + 3; // width 3-6
    let rh = Math.floor(Math.random() * 4) + 3; // height 3-6
    let rx = Math.floor(Math.random() * (width - rw - 2)) + 1;
    let ry = Math.floor(Math.random() * (height - rh - 2)) + 1;
    // Carve room
    for (let y = ry; y < ry + rh; y++) for (let x = rx; x < rx + rw; x++) {
      currentMap[y][x].base = ".";
      currentMap[y][x].name = "Floor";
      currentMap[y][x].br = [];
      setCellColor(x, y, "#111");
    }
    // Record center
    rooms.push({x: Math.floor(rx + rw / 2), y: Math.floor(ry + rh / 2)});
  }

  // 3. Connect each room center to the next (single-tile corridor, L-shaped)
  for (let i = 1; i < rooms.length; i++) {
    let x0 = rooms[i-1].x, y0 = rooms[i-1].y;
    let x1 = rooms[i].x, y1 = rooms[i].y;
    // horizontal path first, then vertical
    for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) {
      if (currentMap[y0][x].base === "#*") {
        currentMap[y0][x].base = ".";
        currentMap[y0][x].name = "Corridor";
        currentMap[y0][x].br = [];
        setCellColor(x, y0, "#111");
      }
    }
    for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++) {
      if (currentMap[y][x1].base === "#*") {
        currentMap[y][x1].base = ".";
        currentMap[y][x1].name = "Corridor";
        currentMap[y][x1].br = [];
        setCellColor(x1, y, "#111");
      }
    }
  }

  const playerRoom = rooms[0];
  const goblinRoom = rooms[rooms.length - 1];
if (getUIDsByType('player').length === 0) {
  addEntity('player', playerRoom.x, playerRoom.y, '@', '#4f4', { bl:['5','/','5'], br:['P'], top:[] }, 'Player');
}
if (getUIDsByType('goblin').length === 0) {
  addEntity('goblin', goblinRoom.x, goblinRoom.y, 'E', '#393', { bl:['2','/','2'], br:['B'], top:[] }, 'Goblin');
}
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
  const neighbors = [
    getCellContents(currentMap, x - 1, y)?.cellBase,   // left
    getCellContents(currentMap, x + 1, y)?.cellBase,   // right
    getCellContents(currentMap, x, y - 1)?.cellBase,   // up
    getCellContents(currentMap, x, y + 1)?.cellBase    // down
  ];
  const PermWallCount = neighbors.filter(c => c === "#").length;
  if (PermWallCount >= 1 && currentMap[y][x].base !== "#") { 
    currentMap[y][x].base = "#*";
    currentMap[y][x].name = "Wall"
    if(!currentMap[y][x].br.includes("W")) {
      currentMap[y][x].br.push("W")
    }
    setCellColor(x, y, "#222")
  }
}
}

function TorchPlacer(currentMap, x, y, cell) {
  // Place a treasure every 5th column, not on wall

  const xneighbours = [
    getCellContents(currentMap, x - 1, y)?.cellBase,   // left
    getCellContents(currentMap, x + 1, y)?.cellBase   // right
  ];
  const yneighbours = [
        getCellContents(currentMap, x, y - 1)?.cellBase,   // up
    getCellContents(currentMap, x, y + 1)?.cellBase    // down
  ]
    const TempNeighbours = [
        getCellContents(currentMap, x, y - 1)?.cellBase,   // up
    getCellContents(currentMap, x, y + 1)?.cellBase,    // down
        getCellContents(currentMap, x - 1, y)?.cellBase,   // left
    getCellContents(currentMap, x + 1, y)?.cellBase   // right
  ]

    const TempWallCount = xneighbours.filter(c => c === "#*").length;
  const xTempWallCount = xneighbours.filter(c => c === "#*").length;
  const yTempWallCount = yneighbours.filter(c => c === "#*").length;

  if((xTempWallCount !== 2 || yTempWallCount !== 2) && TempWallCount > 0 && cell.base !== "#" && cell.base !== "#*" && Math.random() < 0.10) {
    if(Math.random() < 0.90) {
    if(TempWallCount === 2 && Math.random() < 0.90) {
      addEntity("torch", x, y, "T", "#f0f", { bl: ['2','/','2'], br: ['O', 'L'], top: ['oF'] }, "Torch")
    } else {
      addEntity("torch", x, y, "T", "#f0f", { bl: ['2','/','2'], br: ['O', 'L'], top: ['oF'] }, "Torch")
    }
  }
  else {
    let burnedoutTorch = addEntity("torch", x, y, "T", "#202", { bl: ['1','/','2'], br: ['O', 'L'], top: [] }, "Torch")
    setEntityData(burnedoutTorch, "burnedOut", true)
  }
  }
}
(async ()=>{
generateProceduralMap('overworld', 32, 32, {x: 0, y: 0})
map = maps['overworld'].map.chunks[0].data

  //generateMapContentsCircular(map, roomCarverPopulator);
  //generateMapContentsCircular(map, TorchPlacer);
    })();

server.listen(8000, '0.0.0.0', () => {
  console.log('▶ listening on http://localhost:8000');
});
