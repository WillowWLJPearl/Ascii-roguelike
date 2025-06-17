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
    assembleVisibleMaps()

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
  sendOnlyTo(socket.id, "mapData", {map: {seen: entities[newplayer].seen, fovMask : entities[newplayer].fovMask, map: entities[newplayer].visibleMap}, width: 40, height: 20})

  sendOnlyTo(socket.id, 'clientPlayer', newplayer)
  
  sendOnlyTo(socket.id, "entityData", {list: entitiesInFovOf(entities[newplayer]), changed: newplayer})



  // broadcast join to others
 // socket.broadcast.emit('playerJoined', { id: socket.id, x, y, dir: 'down' });

 socket.on('wait', data => {
  TickManager(map)
  })
  socket.on('move', data => {
    assembleVisibleMaps()
    moveEntity(data.currentplayer, data.dx, data.dy, 40, 20)
    updateClientMapNEntityData(data.currentplayer)
    TickManager(map)
  });

    socket.on('turn', data => {
    assembleVisibleMaps()
    if(entities[data.currentplayer].dir !== data.dir) {
      turnEntity(data.currentplayer, data.dir)
      TickManager(map)
    }
  });

  socket.on('disconnect', () => {
    console.log('➖ client left:', socket.id);
    socket.broadcast.emit('playerLeft', socket.id);
  });
});

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

updateClientMapNEntityData(uid)

}

function updateClientMapNEntityData(uid) {
      const mapHeight = map.length;
  const mapWidth = map[0]?.length || 0;

  sendOnlyTo(getEntityData(uid, 'socketId'), "entityData", {list: entitiesInFovOf(entities[uid]), changed: uid})
sendOnlyTo(getEntityData(uid, 'socketId'), 'mapData',{map: {lightMask: entities[uid].lightMask, seen: entities[uid].seen, fovMask : entities[uid].fovMask, map: entities[uid].visibleMap}, width: mapWidth, height: mapHeight} )

}
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




function Tick(currentMap) {
  getUIDsByType('player').forEach(p => {
          const height = currentMap.length;
  const width = currentMap[0]?.length || 0;
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

  
  if (p) {
    assembleVisibleMaps()
   updateClientMapNEntityData(p)
  }
});
});
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
generateMap(20, 40)


  generateMapContentsCircular(map, roomCarverPopulator);
  generateMapContentsCircular(map, TorchPlacer);
    })();

server.listen(8000, '0.0.0.0', () => {
  console.log('▶ listening on http://localhost:8000');
});
