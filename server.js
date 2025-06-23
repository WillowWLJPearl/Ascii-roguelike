// server.js
const path    = require('path');
const express = require('express');
const http    = require('http');
const { Server } = require('socket.io');

const app    = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",             // or your client’s exact URL(s)
    methods: ["GET","POST"]
  }
});
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
/**
 * Shift a H×W boolean mask by (dx,dy):
 *  - dx>0 moves everything right; dx<0 moves left
 *  - dy>0 moves everything down; dy<0 moves up
 * Newly revealed cells become false.
 */

function shiftMask(mask, dx, dy) {
  const H = mask.length;
  const W = mask[0].length;
  const out = Array.from({length: H}, () => Array(W).fill(false));

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const srcY = y + dy;
      const srcX = x + dx;
      if (srcY >= 0 && srcY < H && srcX >= 0 && srcX < W) {
        out[y][x] = mask[srcY][srcX];
      }
    }
  }
  return out;
}

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
  e.lightMask = shiftMask(e.lightMask, dx, dy);

  assembleVisibleMaps();
  return true;
}


function entitiesInFovDetailed(viewer) {
  const halfW = Math.floor(chunkWidth  / 2);
  const halfH = Math.floor(chunkHeight / 2);

  // viewer’s absolute world‐coords
  const vwx = viewer.cx * chunkWidth  + viewer.x;
  const vwy = viewer.cy * chunkHeight + viewer.y;

  const visible = {};
  for (const [uid, e] of Object.entries(entities)) {
    if (uid === viewer.uid) continue;  // don’t send the viewer itself here

    // 1) entity absolute world coords
    const ewx = e.cx * chunkWidth  + e.x;
    const ewy = e.cy * chunkHeight + e.y;

    // 2) offset in world‐space
    const dx = ewx - vwx;
    const dy = ewy - vwy;

    // 3) map into your 0…31 window
    const rx = dx + halfW;
    const ry = dy + halfH;

    // 4) test bounds & mask **true** (only include if visible or lit)
    const inBounds = rx >= 0 && rx < chunkWidth && ry >= 0 && ry < chunkHeight;
    const inFov    = viewer.fovMask[ry]?.[rx];
    const lit      = viewer.lightMask[ry]?.[rx];

    if (inBounds && (inFov || lit) && viewer.map === e.map) {
      // clone and overwrite x/y to the relative window coords
      visible[uid] = {
        ...e,
        x: rx,
        y: ry
      };
    }
  }

  return visible;
}
function entityIdsInFov(viewer) {
  const ids = [];
  const halfW = Math.floor(chunkWidth  / 2);
  const halfH = Math.floor(chunkHeight / 2);

  // viewer world coords
  const vwx = viewer.cx * chunkWidth  + viewer.x;
  const vwy = viewer.cy * chunkHeight + viewer.y;

  for (const [uid, e] of Object.entries(entities)) {
    // skip ourselves
    if (uid === viewer.uid) continue;

    // entity world coords
    const ewx = e.cx * chunkWidth  + e.x;
    const ewy = e.cy * chunkHeight + e.y;

    // relative offset from viewer
    const dx = ewx - vwx;
    const dy = ewy - vwy;

    // map into viewer.fovMask/lightMask indices
    const rx = dx + halfW;
    const ry = dy + halfH;

    // must fall inside your mask
    if (
      rx >= 0 && rx < chunkWidth &&
      ry >= 0 && ry < chunkHeight &&
      (viewer.fovMask[ry]?.[rx] || viewer.lightMask[ry]?.[rx])
    ) {
      ids.push(uid);
    }
  }
  return ids;
}

function entitiesInFovOf(viewer) {
  const list = {};
  for (const uid of entityIdsInFov(viewer)) {
    list[uid] = entities[uid];
  }
  return list;
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
  const mapH = chunkHeight, mapW = chunkWidth;
  const halfH = Math.floor(chunkHeight/2);
  const halfW = Math.floor(chunkWidth /2);

  Object.values(entities).forEach(e => {
    // 1) build the full 32×32 window of real tiles around the player
    mapId = e.map
    const rel = calculateRelativeChunk(mapId, e.cy, e.cx, e.y, e.x);

    // 2) clear visibleMap to darkness
    e.visibleMap = VisibleMapBase(mapW, mapH);

    // 3) iterate every seen‐chunk for this entity & map
    const seenChunks = e.seen[mapId]?.map?.chunks || [];
    for (const { x: scx, y: scy, data: seenMat } of seenChunks) {
      // for each tile in that chunk
      for (let ly = 0; ly < mapH; ly++) {
        for (let lx = 0; lx < mapW; lx++) {
          if (!seenMat[ly][lx]) continue;

          // world‐coords of that seen tile
          const wy = scy*mapH + ly;
          const wx = scx*mapW + lx;

          // convert to relative window coords [0..31]
          const ry = wy - (e.cy*mapH + e.y) + halfH;
          const rx = wx - (e.cx*mapW + e.x) + halfW;

          // if it falls inside our 32×32 view, copy the real tile
          if (ry >= 0 && ry < mapH && rx >= 0 && rx < mapW) {
            e.visibleMap[ry][rx] = rel[ry][rx];
          }
        }
      }
    }
  });
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
        if(map[y][x].br.includes('g')) {
          available = {x, y}
        }
      }
  }

  let newplayer = addEntity('player', available.x, available.y, '@', '#404', {}, 'UserRandom')
  setEntityData(newplayer, 'socketId', socket.id)

  assembleVisibleMaps()
  sendOnlyTo(socket.id, "mapData", {map: {seen: entities[newplayer].seen[entities[newplayer].map],trueMapping: trueMappingWithSeenMapping(entities[newplayer].seen, maps, entities[newplayer].map), fovMask : entities[newplayer].fovMask, map: entities[newplayer].visibleMap}, width: 32, height: 32})

  sendOnlyTo(socket.id, 'clientPlayer', newplayer)
  
  sendOnlyTo(socket.id, "entityData", {list: entitiesInFovDetailed(entities[newplayer]), changed: newplayer})
  

  // broadcast join to others
 // socket.broadcast.emit('playerJoined', { id: socket.id, x, y, dir: 'down' });

  socket.on('changeName', data => {
  entities[data.uuid].name = data.name
  })
 socket.on('wait', data => {
  TickManager('overworld')
  })
  socket.on('disconnect', () => {
    console.log('➖ client left:', socket.id);
    delete entities[getPlayerUuidBySocket(socket.id)]
    
  });
    socket.on('alldata', () => {
    sendOnlyTo(socket.id,'alldata', {entities, map})
  });
});
io.on('connection', socket => {
  socket.on('move', data => {
    if(moveEntity(data.currentplayer, data.dx, data.dy, chunkHeight, chunkWidth)) {
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
      if(!entities[data.currentplayer]) return
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
   socket.on('attack', data => {
  attackHandler(data.currentplayer, data.tile, data.item)
  })
})
function getWorldPosition(e, relX, relY) {
  const halfW = Math.floor(chunkWidth  / 2);
  const halfH = Math.floor(chunkHeight / 2);

  // 1) compute offset from the entity’s tile
  const dX = relX - halfW;
  const dY = relY - halfH;

  // 2) absolute world‐tile coords
  const worldX = e.cx * chunkWidth  + e.x + dX;
  const worldY = e.cy * chunkHeight + e.y + dY;

  // 3) figure out which chunk that lives in
  const cx = Math.floor(worldX / chunkWidth);
  const cy = Math.floor(worldY / chunkHeight);

  // 4) wrap into local coords [0..chunkWidth)
  const x = ((worldX % chunkWidth)  + chunkWidth)  % chunkWidth;
  const y = ((worldY % chunkHeight) + chunkHeight) % chunkHeight;

  return {
    map:    e.map,
    worldX, worldY,
    cx,     cy,
    x,      y
  };
}
function hasItem(entity, item) {

}
function attackHandler(attacker, target, item) {
  if(item?.slot) {
    
  } else {
    item = {name: 'Fist', types: ['melee','physical'],range: 1,attackSize:1, damage: 1, effects: [{id:'self_harm', chance: 10}]}
  }
   TickManager('overworld')
   let pos = getWorldPosition(entities[attacker], target.x,target.y)
  damageHandler({mapId:entities[attacker].map,cy:pos.cy,cx:pos.cx,x:pos.x,y:pos.y}, {type: 'attack', damage: item.damage, attacker})
}
function damageHandler(target, source) {
 let tentities = getEntityUUIDsAt(target.mapId,target.cx, target.cy,target.x, target.y)
 players = []
 tentities.forEach(euuid => {
  entities[euuid].health.currentHealth -= source.damage
  if(entities[euuid].health.currentHealth <= 0) {
    deathHandler(euuid, source)
  }
  playersSeeingEntity(euuid).forEach(p => {
    players.push(p)
  })
 })
 let uniqueplayers = uniqueDicts(players)
 uniqueplayers.forEach(p => { updateMapNEntityData(p, 'lightweight') })
}
function deathHandler(euuid, source) {
if(entities[euuid].type === 'player') {
        let available
        const mapHeight = map.length;
  const mapWidth = map[0]?.length || 0;
  for (let y=0; y < mapHeight; y++){
      for (let x=0; x < mapWidth; x++){   
        if(map[y][x].br.includes('g')) {
          available = {x, y}
        }
      }
  }
   let respawnedplayer = addEntity('player', available.x, available.y, '@', '#404', {}, 'UserRandom')
  setEntityData(respawnedplayer, 'socketId', getEntityData(euuid, 'socketId'))
  sendOnlyTo(getEntityData(euuid, 'socketId'), 'clientPlayer', respawnedplayer)
  delete entities[euuid]
  assembleVisibleMaps()
  euuid = respawnedplayer
  updateMapNEntityData(euuid, 'lightweight')
} else
 if(entities[euuid].type === 'chest')
   {
    let attacker = source.attacker
    entities[euuid].inventory.forEach(i=> {
      let newItem = i
      newItem.slot = 'hotbar'
      entities[attacker].inventory.push(newItem)
    }) 
    delete entities[euuid]
} 
else {
delete entities[euuid]
}
assembleVisibleMaps()
  playersSeeingEntity(euuid).forEach(p => {
    updateMapNEntityData(p, 'lightweight')
  })
}
function itemHandler(i, target) {

}
function uniqueDicts(arr) {
  const seen = new Set();
  return arr.filter(obj => {
    const key = JSON.stringify(obj);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
let mapData = {map: [], playermovements: 0}
function TickManager(currentMap) {
   mapData = {map: currentMap, playermovements: mapData.playermovements+1}
   playeramount = getUIDsByType('player').length
   
   if(mapData.playermovements >= playeramount) {
    mapData.playermovements = 0
    Tick(mapData.map)
    
   }
}
function playersSeeingEntity(targetUid) {
  const target = entities[targetUid];
  if (!target) return [];

  const result = [];
  const halfW  = Math.floor(chunkWidth  / 2);
  const halfH  = Math.floor(chunkHeight / 2);

  // absolute world coords of the target
  const targetWX = target.cx * chunkWidth  + target.x;
  const targetWY = target.cy * chunkHeight + target.y;

  // iterate over every player
  for (const viewerUid of getUIDsByType('player')) {
    const viewer = entities[viewerUid];
    if (!viewer) continue;
    // only consider same map
    if (viewer.map !== target.map) continue;

    // absolute world coords of the viewer
    const viewerWX = viewer.cx * chunkWidth  + viewer.x;
    const viewerWY = viewer.cy * chunkHeight + viewer.y;

    // offset from viewer to target
    const dx = targetWX - viewerWX;
    const dy = targetWY - viewerWY;

    // map into the viewer’s mask-space [0..chunkWidth)
    const rx = dx + halfW;
    const ry = dy + halfH;

    // within their window?
    if (
      rx >= 0 && rx < chunkWidth &&
      ry >= 0 && ry < chunkHeight
    ) {
      const inFov  = viewer.fovMask[ry]?.[rx];
      const inLight= viewer.lightMask[ry]?.[rx];
      if (inFov || inLight) {
        result.push(viewerUid);
      }
    }
  }

  return result;
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

  let firstPerPlayerInstanceData = {entity: entities[uid], seenEntities: entitiesInFovDetailed(entities[uid])}
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
  revealFOV(uid)
  assembleVisibleMaps()
  if(protocol === 'noAction') {
    sendOnlyTo(getEntityData(uid, 'socketId'), "entityData", {list: entitiesInFovDetailed(entities[uid]), changed: uid})
sendOnlyTo(getEntityData(uid, 'socketId'), 'mapData',{map: {lightMask: entities[uid].lightMask, trueMapping: trueMappingWithSeenMapping(entities[uid].seen, maps, entities[uid].map),seen: entities[uid].seen[entities[uid].map], fovMask : entities[uid].fovMask, map: entities[uid].visibleMap}, width: mapWidth, height: mapHeight} )
  } else
    if(protocol ==='lightweight') {
    sendOnlyTo(getEntityData(uid, 'socketId'), "mapNEntityData", {list: entitiesInFovDetailed(entities[uid]), changed: uid})
  }
}
function getPlayerBySocket(socketId) {
  return Object.entries(entities).filter(([id, e]) => getEntityData(id, 'socketId') === socketId)[0]
}
function getPlayerUuidBySocket(socketId) {
  let returnitem
     Object.entries(entities).forEach(([id2, e]) => {
    if(getEntityData(id2, 'socketId') === socketId) {
     returnitem = id2
    }
   })
   return returnitem
}
function getEntityUUIDsAt(mapId, cx, cy, x, y) {
  return Object.entries(entities)
    .filter(([uid, e]) =>
      e.map === mapId &&
      e.cx  === cx    &&
      e.cy  === cy    &&
      e.x   === x     &&
      e.y   === y
    )
    .map(([uid]) => uid);
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

function addEntity(type,x,y,char,color,overlays,name,map='overworld',chunkx=0,chunky=0, maxHealth =2,maxStamina=5){
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
    stamina: {maxStamina, currentStamina: maxStamina},
    inventory: [],
    traits:[],
    slots:{hotbar:4},
    health: {maxHealth, currentHealth : maxHealth},
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
  let currentmap = [];
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
    currentmap.push(row);
  }
  return currentmap
}
function generateProceduralMap(id, height, width, chunk, state) {
  let data = []
  for (let y = 0; y < height; y++) {
    const row = [];
    for (let x = 0; x < width; x++) {
      row.push({
        base: '.',
        top: [], bl: [], br: [],
        color:  '#111',
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
generateMapContentsCircularForChunk(id, chunk.x, chunk.y, ChunkgenPicker(id), state)
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
  const p = entities[playerUid];
  const H = chunkHeight, W = chunkWidth;
  const R = p.FOV_RADIUS;

  // 1) Clear out last‐frame masks:
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      p.fovMask[y][x]   = false;
    }
  }

  // 2) Compute your “center” tile in the 32×32 window:
  const centerY = Math.floor(H / 2);
  const centerX = Math.floor(W / 2);

  // 3) You always see the center tile:
  p.fovMask[centerY][centerX] = true;
  //    and mark it seen in the global cache:
  markGlobalSeen(playerUid, 0, 0);

  // 4) Cast rays in a circle of radius R:
  for (let dy = -R; dy <= R; dy++) {
    for (let dx = -R; dx <= R; dx++) {
      // skip outside the circle
      if (dx*dx + dy*dy > R*R) continue;
      // skip outside your cone
      if (!inCone(dx, dy, p.dir)) continue;

      // target in window‐space = center + (dx,dy)
      const tx = centerX + dx;
      const ty = centerY + dy;
      if (tx < 0 || tx >= W || ty < 0 || ty >= H) continue;

      // walk the Bresenham line
      const line = bresenhamLine(centerX, centerY, tx, ty);
      let blocked = false;
      for (const [lx, ly] of line) {
        // 5) Mark as “seen” in the global cache:
        //    offset from center = (lx-centerX, ly-centerY)
        markGlobalSeen(playerUid, lx - centerX, ly - centerY);

        // 6) Add to FOV if not yet blocked
        if (!blocked) {
          p.fovMask[ly][lx] = true;
        }

        // 7) Test blockage on the actual tile
        const cell = calculateRelativeChunk(
          p.map, p.cy, p.cx, p.y, p.x
        )[ly][lx];
        if (
          blockBases.includes(cell.base) ||
          cell.top.some(s => blockStatuses.includes(s)) ||
          cell.br .some(t => blockTypes.includes(t))
        ) {
          blocked = true;
          break;
        }
      }
    }
  }
}





/**
 * Mark a single “seen” tile for entity `uid`, given window‐relative offsets.
 */
function markGlobalSeen(uid, relX, relY) {
  const p = entities[uid];
  const worldX = p.cx*chunkWidth  + p.x + relX;
  const worldY = p.cy*chunkHeight + p.y + relY;

  const ncx = Math.floor(worldX / chunkWidth);
  const ncy = Math.floor(worldY / chunkHeight);
  const lx  = ((worldX % chunkWidth)  + chunkWidth)  % chunkWidth;
  const ly  = ((worldY % chunkHeight) + chunkHeight) % chunkHeight;

  const seenChunk = getSeenArrayOfChunk(uid, p.map, ncx, ncy);
  seenChunk.data[ly][lx] = true;
}

function getChunkByMapId(mapId, cx, cy, state) {
  const mapObj = maps[mapId];
  if (!mapObj) throw new Error(`map "${mapId}" not found`);
  let chunk = mapObj.map.chunks.find(c => c.x === cx && c.y === cy);
  if (!chunk) {
    // generateProceduralMap will push a new chunk into maps[mapId].map.chunks
    generateProceduralMap(mapId, chunkHeight, chunkWidth, { x: cx, y: cy }, state);
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
  const H = chunkHeight, W = chunkWidth;

  // for each player…
  getUIDsByType('player').forEach(uid => {
    const p = entities[uid];
    if(p === undefined) return

    // 1) build the 32×32 tile window around the player
    const viewMap = calculateRelativeChunk(
      mapId, p.cy, p.cx, p.y, p.x
    );

    // 2) clear out last‐frame light
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        p.lightMask[y][x] = false;
      }
    }

    // 3) for every entity that’s a torch…
    for (const [eid, e] of Object.entries(entities)) {
      if (e.type !== 'torch' || getEntityData(eid, 'burnedOut')) continue;

      // 4) check if that torch’s tile has ever been seen (global cache)
      const seenChunk = getSeenArrayOfChunk(uid, mapId, e.cx, e.cy);
      if (!seenChunk.data[e.y][e.x]) continue;

      // 5) toggle dim state
      const wasDim  = getEntityData(eid, 'isDim') || false;
      const isDimNow= !wasDim;
      setEntityData(eid, 'isDim', isDimNow);

      // 6) compute this torch’s offset from the player *in world coords*
      const worldDX = (e.cx*W + e.x) - (p.cx*W + p.x);
      const worldDY = (e.cy*H + e.y) - (p.cy*H + p.y);

      // 7) convert that to 32×32 window coords
      const cx = Math.floor(W/2), cy = Math.floor(H/2);
      const tx = cx + worldDX, ty = cy + worldDY;
      if (tx < 0 || tx >= W || ty < 0 || ty >= H) continue;

      // 8) light the torch tile
      p.lightMask[ty][tx] = true;
      markGlobalSeen(uid, worldDX, worldDY);
      p.visibleMap[ty][tx] = viewMap[ty][tx];

      // 9) light its 4 neighbors (and mark them seen)
      for (let {dx,dy} of deltas4) {
        const nx = tx + dx, ny = ty + dy;
        if (nx < 0 || nx >= W || ny < 0 || ny >= H) continue;
        p.lightMask[ny][nx] = true;
        markGlobalSeen(uid, worldDX + dx, worldDY + dy);
        p.visibleMap[ny][nx] = viewMap[ny][nx];

        // 10) if it’s dim, light one more ring out
        if (isDimNow) {
          for (let {dx:ddx,dy:ddy} of deltas4) {
            const nnx = nx + ddx, nny = ny + ddy;
            if (nnx < 0 || nnx >= W || nny < 0 || nny >= H) continue;
            p.lightMask[nny][nnx] = true;
            markGlobalSeen(uid, worldDX + dx + ddx, worldDY + dy + ddy);
            p.visibleMap[nny][nnx] = viewMap[nny][nnx];
          }
        }
      }
    }
    
    // 11) finally, push your updated masks & visibleMap back to the player
        ChunkTickPicker(mapId, uid)
    const sock = getEntityData(uid, 'socketId');
    sendOnlyTo(sock, 'mapData', {
      map: {
        lightMask: p.lightMask,
        seen:      p.seen,
        fovMask:   p.fovMask,
        map:       p.visibleMap
      },
      width:  W,
      height: H
    });
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
function trueMappingWithSeenMapping(seenMapping, fullMaps, mapId) {
  const seenChunks = seenMapping[mapId]?.map?.chunks || [];
  const fullChunks = fullMaps[mapId]?.map?.chunks || [];

  const trueMapping = { map: { chunks: [] } };

  for (const fullChunk of fullChunks) {
    const { x: cx, y: cy, data: tileData } = fullChunk;

    // find the corresponding seen-chunk (if any)
    const seenEntry = seenChunks.find(sc => sc.x === cx && sc.y === cy);
    const seenData  = seenEntry?.data;  // a chunkHeight×chunkWidth bool array

    // build masked data
    const masked = tileData.map((row, yy) =>
      row.map((cell, xx) => {
        // only show `cell` if seenData exists *and* seenData[yy][xx] is true
        return (seenData && seenData[yy]?.[xx]) ? cell : false;
      })
    );

    trueMapping.map.chunks.push({ x: cx, y: cy, data: masked });
  }

  return trueMapping;
}

function generateMapContentsCircularForChunk(mapId, cx, cy, cb, state) {
  // 1) grab (or generate) that chunk
  const chunk = getChunkByMapId(mapId, cx, cy);
  if (!chunk || !chunk.data) {
    throw new Error(`Chunk ${cx},${cy} not found in map "${mapId}"`);
  }

  // 2) call your existing circular generator over chunk.data
  const currentMap = chunk.data;
  const height = currentMap.length;
  const width  = currentMap[0]?.length || 0;

  const centerX = Math.floor(width  / 2);
  const centerY = Math.floor(height / 2);
  const maxR    = Math.ceil(Math.sqrt(centerX*centerX + centerY*centerY));
  const visited = Array.from({ length: height }, () => Array(width).fill(false));

  for (let r = 0; r <= maxR; r++) {
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (visited[y][x]) continue;
        const dist = Math.round(Math.hypot(x - centerX, y - centerY));
        if (dist === r) {
          // invoke your populator
          cb(currentMap, x, y, currentMap[y][x], cx, cy, mapId, state);
          visited[y][x] = true;
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
      currentMap[y][x].br = ['g'];
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
function placeStructureInChunk(mapId, startCX, startCY, startLX, startLY, structTiles) {
  const Hs = structTiles.length;
  if (Hs === 0) return;
  const Ws = structTiles[0].length;

  // Compute the world‐coordinates of your origin:
  const originWorldX = startCX * chunkWidth  + startLX;
  const originWorldY = startCY * chunkHeight + startLY;
  // Now just reuse our world‐based placer:
  placeStructure(mapId, originWorldX, originWorldY, structTiles);
}
function placeStructure(mapId, originWorldX, originWorldY, structTiles) {
  const Hs = structTiles.length;
  if (Hs === 0) return;
  const Ws = structTiles[0].length;

  for (let sy = 0; sy < Hs; sy++) {
    for (let sx = 0; sx < Ws; sx++) {
      const tile = structTiles[sy][sx];
      // Compute global tile coords
      const gx = originWorldX + sx;
      const gy = originWorldY + sy;

      // Which chunk is that in?
      const cX = Math.floor(gx / chunkWidth);
      const cY = Math.floor(gy / chunkHeight);

      // Wrap into local chunk coords
      const lX = ((gx % chunkWidth) + chunkWidth) % chunkWidth;
      const lY = ((gy % chunkHeight) + chunkHeight) % chunkHeight;

      // Ensure the chunk exists (will generate if needed)
      const chunk = getChunkByMapId(mapId, cX, cY, false);

      // Finally write the tile in
      chunk.data[lY][lX] = {
        base:  tile.base,
        top:   Array.isArray(tile.top)   ? tile.top.slice()   : [],
        bl:    Array.isArray(tile.bl)    ? tile.bl.slice()    : [],
        br:    Array.isArray(tile.br)    ? tile.br.slice()    : [],
        color: tile.color,
        name:  tile.name,
        meta:  { ...(tile.meta || {}) }
      };
    }
  }
}
function getMapIdbyMap(map) {
   Object.entries(maps).forEach(([id, cmap]) => {
if(cmap === map) {
  return id
}
   })
}
const woodblock = {base:'#*', name:'Wood Wall', color: '#412', br: ['W']}
const hut = [
  [woodblock,woodblock,woodblock]
]
let unique_basic_dungeonID = 0
function overworldPlainsGen(currentMap, x, y, cell, cx, cy, mapId, state = true) {
      if (cell.base === ".") {
        cell.base = ".";
        cell.name = "Grass";
        cell.br = ['g'];
        cell.color = "#151"
      }
      if(Math.random() < 0.01 && state) {
        placeStructureInChunk(mapId, cx, cy, x, y, hut)
      //  console.log(cx, cy, x, y)
      }
      if(Math.random() < 0.001 && cell.base === "." && state) {
        unique_basic_dungeonID += 1
        cell.base = "D";
        cell.name = "Basic Dungeon Entrance";
        cell.br = ['s'];
        cell.color = "#222"
        cell.structure_id = 'basic_dungeon'+unique_basic_dungeonID
      }
        if(Math.random() < 0.001 && cell.base === "." && state) {
         let chest = addEntity('chest', x, y, 'C', '#442', {br:['S']}, 'Treasure Chest', currentMap.type, cx, cy, 2, 0)
         let sword = {slot: 'inventory', damage: 5, name:'Iron Sword', char: "S"}
         entities[chest].inventory.push(sword)
        }
}
function basicDungeonContents(currentMap, x, y, cell, cx, cy, mapId, state = true) {
roomCarverPopulator(currentMap)
//TorchPlacer(currentMap, x, y, cell)
}
function ChunkgenPicker(mapID) {
if(mapID === 'overworld') {
  return overworldPlainsGen
} else {
  return basicDungeonContents
}
}
function increaseTime(mapId = 'overworld')  {
  Object.values(entities).forEach(e => { 
    if(e.map === mapId) {
      maps[mapId].time += 1;
    }
  })
}
function ChunkTickPicker(mapID, uid) {
// initialize to 0 if it doesn’t exist (or is null/undefined)
if (maps[mapID].time == null && mapID === 'overworld') {
  maps[mapID].time = 0;
  setInterval(increaseTime, 3600);
}

if(mapID === 'overworld' && Math.floor(maps[mapID].time/1000) % 2 === 0) {
  if(entities[uid].map === mapID) {
  entities[uid].FOV_RADIUS = 12
  entities[uid].lightMask = Array.from({length: chunkHeight},()=>Array(chunkWidth).fill(true))
  }
}
if(mapID === 'overworld') {
  let entity = entities[uid]
 let chunk = getChunkByMapId(mapID, entity.cx,entity.cy, false )
if(chunk.data[entity.y][entity.x].br.includes('s')) {
  let cell = chunk.data[entity.y][entity.x]
  if(cell.name === "Basic Dungeon Entrance") {
    dunegonId = cell.structure_id
if(maps['basic_dungeon'+dunegonId] === undefined) {
     generateProceduralMap('basic_dungeon'+dunegonId, chunkHeight, chunkWidth, {y: 0, x:0})
     let currentmap = maps['basic_dungeon'+dunegonId]
      generateMapContentsCircularForChunk(currentmap.type, 0, 0, ChunkgenPicker(currentmap.type), false)
      console.log(currentmap.type)
}
let currentmap = maps['basic_dungeon'+dunegonId]
    entities[uid].map = currentmap.type
    let mapdata = currentmap.map.chunks[0].data
      for (let y=0; y < chunkHeight; y++){
      for (let x=0; x < chunkWidth; x++){   
        if(mapdata[y][x].br.includes('g')) {
          entities[uid].x = x
          entities[uid].y = y
        }
      }
  }
          entities[uid].cy = 0
        entities[uid].cx = 0
        assembleVisibleMaps(entities[uid].map)
        sendOnlyTo(getEntityData(uid, "socketId"), "mapData", {map: {seen: entities[uid].seen[entities[uid].map],trueMapping: trueMappingWithSeenMapping(entities[uid].seen, maps, entities[uid].map), fovMask : entities[uid].fovMask, map: entities[uid].visibleMap}, width: 32, height: 32})
  }
}
}
assembleVisibleMaps(mapID)
updateMapNEntityData(uid, 'lightweight')
}
(async ()=>{
generateProceduralMap('overworld', 32, 32, {x: 0, y: 0})
map = maps['overworld'].map.chunks[0].data

  generateMapContentsCircularForChunk('overworld', 0, 0, ChunkgenPicker('overworld'))
    })();

server.listen(8000, '0.0.0.0', () => {
  console.log('▶ listening on http://localhost:8000');
});
