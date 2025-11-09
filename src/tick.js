// src/tick.js
const { state } = require('./state');
const storage = require('../storage');
const { getSeenArrayOfChunk, markGlobalSeen } = require('./vision');
const { calculateRelativeChunk } = require('./maps');
const { deltas4 } = require('./constants');
const { ChunkgenPicker, generateMapContentsCircularForChunk } = require('./worldgen');

let mapData = { map: '', playermovements: 0 };

function TickManager(currentMapId) {
  mapData = { map: currentMapId, playermovements: mapData.playermovements + 1 };
  const playerCount = (state.typeIndex['player'] || []).length;
  if (mapData.playermovements >= playerCount) {
    mapData.playermovements = 0;
    Tick(mapData.map);
  }
}

function increaseTime(mapId = 'overworld')  {
  Object.values(state.entities).forEach(e => {
    if (e.map === mapId) {
      state.maps[mapId].time += 1;
     
      storage.saveMapMetaSync(mapId, { time: state.maps[mapId].time });
    }
  });
}

function ChunkTickPicker(mapID, uid) {
  if (state.maps[mapID].time == null && mapID === 'overworld') {
    state.maps[mapID].time = 0;
    setInterval(increaseTime, 3600);
  }

  // Example: day/night toggling of FOV / light
  if (mapID === 'overworld' && Math.floor(state.maps[mapID].time/1000) % 2 === 0) {
    const e = state.entities[uid];
    if (e?.map === mapID) {
      e.FOV_RADIUS = 12;
      e.lightMask = Array.from({ length: state.chunkHeight }, () =>
        Array(state.chunkWidth).fill(true)
      );
    }
  }

  // dungeon entrance transition
  if (mapID === 'overworld') {
    const e = state.entities[uid]; if (!e) return;
    const chunk = require('./maps').getChunkByMapId(mapID, e.cx, e.cy, false);
    const cell = chunk.data[e.y][e.x];
    if (cell?.br?.includes('s') && cell.name === 'Basic Dungeon Entrance') {
      const dungeonId = cell.structure_id;
      const mapKey = 'basic_dungeon' + dungeonId;

      if (!state.maps[mapKey]) {
        generateMapContentsCircularForChunk(mapKey, 0, 0, ChunkgenPicker(mapKey), false);
      }
      const dmap = state.maps[mapKey];
      e.map = dmap.type;
      e.cy = 0; e.cx = 0;

      const data = dmap.map.chunks[0].data;
      for (let y=0;y<data.length;y++) for (let x=0;x<data[0].length;x++) {
        if (data[y][x].br?.includes('g')) { e.x = x; e.y = y; }
      }

      const io = require('./sockets').ioRef();
      const { trueMappingWithSeenMapping } = require('./maps');
      const { assembleVisibleMaps } = require('./vision');
      assembleVisibleMaps();

      io.to(e.meta.socketId).emit('mapData', {
        map: {
          seen: e.seen[e.map],
          trueMapping: trueMappingWithSeenMapping(e.seen, state.maps, e.map),
          fovMask: e.fovMask,
          map: e.visibleMap
        },
        width: state.chunkWidth,
        height: state.chunkHeight
      });
    }
  }

  const { assembleVisibleMaps } = require('./vision');
  assembleVisibleMaps();
  updateMapNEntityData(uid, 'lightweight');
}

function Tick(mapId) {
  const W = state.chunkWidth, H = state.chunkHeight;

  (state.typeIndex['player'] || []).forEach(uid => {
    const p = state.entities[uid];
    if (!p) return;

    const viewMap = calculateRelativeChunk(mapId, p.cy, p.cx, p.y, p.x);

    // reset light
    for (let y=0; y<H; y++) for (let x=0; x<W; x++) p.lightMask[y][x] = false;

    // dim/flicker torches this player has seen
    for (const [eid, e] of Object.entries(state.entities)) {
        // in your tick for each entity e
        if (typeof e._tick === 'function') e._tick(e);

        if (e.type !== 'torch' || e.meta?.burnedOut) continue;

      const seenChunk = getSeenArrayOfChunk(uid, mapId, e.cx, e.cy);
      if (!seenChunk.data[e.y][e.x]) continue;

      const wasDim = !!e.meta.isDim;
      const isDimNow = !wasDim;
      e.meta.isDim = isDimNow;

      const worldDX = (e.cx*W + e.x) - (p.cx*W + p.x);
      const worldDY = (e.cy*H + e.y) - (p.cy*H + p.y);

      const cx = Math.floor(W/2), cy = Math.floor(H/2);
      const tx = cx + worldDX, ty = cy + worldDY;
      if (tx < 0 || tx >= W || ty < 0 || ty >= H) continue;

      p.lightMask[ty][tx] = true;
      markGlobalSeen(uid, worldDX, worldDY);
      p.visibleMap[ty][tx] = viewMap[ty][tx];

      for (const {dx,dy} of deltas4) {
        const nx = tx+dx, ny = ty+dy;
        if (nx<0||nx>=W||ny<0||ny>=H) continue;
        p.lightMask[ny][nx] = true;
        markGlobalSeen(uid, worldDX+dx, worldDY+dy);
        p.visibleMap[ny][nx] = viewMap[ny][nx];

        if (isDimNow) {
          for (const {dx:ddx,dy:ddy} of deltas4) {
            const nnx = nx+ddx, nny = ny+ddy;
            if (nnx<0||nnx>=W||nny<0||nny>=H) continue;
            p.lightMask[nny][nnx] = true;
            markGlobalSeen(uid, worldDX+dx+ddx, worldDY+dy+ddy);
            p.visibleMap[nny][nnx] = viewMap[nny][nnx];
          }
        }
      }
    }

    ChunkTickPicker(mapId, uid);

    const io = require('./sockets').ioRef();
    io.to(p.meta.socketId).emit('mapData', {
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

// lightweight sender + revealFOV + assemble are orchestrated here
function updateMapNEntityData(uid, protocol='noAction') {
  const e = state.entities[uid];
  if (!e) return;
  const io = require('./sockets').ioRef();
  const { revealFOV, assembleVisibleMaps } = require('./vision');
  const { trueMappingWithSeenMapping } = require('./maps');
  const { entitiesInFovDetailed } = require('./entities');

  revealFOV(uid);
  assembleVisibleMaps();

  if (protocol === 'noAction') {
    io.to(e.meta.socketId).emit('entityData', { list: entitiesInFovDetailed(uid), changed: uid });
    io.to(e.meta.socketId).emit('mapData', {
      map: {
        lightMask: e.lightMask,
        trueMapping: trueMappingWithSeenMapping(e.seen, state.maps, e.map),
        seen: e.seen[e.map],
        fovMask: e.fovMask,
        map: e.visibleMap
      },
      width: state.chunkWidth, height: state.chunkHeight
    });
  } else if (protocol === 'lightweight') {
    io.to(e.meta.socketId).emit('mapNEntityData', { list: entitiesInFovDetailed(uid), changed: uid });
  }
}

setInterval(() => {
  Tick('overworld');
}, 50);

module.exports = { TickManager, Tick, updateMapNEntityData, ChunkTickPicker, increaseTime };
