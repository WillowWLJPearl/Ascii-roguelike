// src/worldgen.js
const { state } = require('./state');
const storage = require('../storage');
const { getChunkByMapId } = require('./maps');
const { addEntity } = require('./entities');

function setCellColor(map2d, x, y, color) {
  if (!map2d[y] || !map2d[y][x]) return;
  map2d[y][x].color = color;
}

function getCellContents(currentMap, x, y) {
  if (!currentMap[y] || !currentMap[y][x]) return null;
  const cell = currentMap[y][x];
  return { cellBase: cell.base, cellType: cell.name, overlays: { top: cell.top, bl: cell.bl, br: cell.br } };
}

function placeStructure(mapId, originWorldX, originWorldY, structTiles) {
  const Hs = structTiles.length; if (!Hs) return;
  const Ws = structTiles[0].length;

  for (let sy = 0; sy < Hs; sy++) for (let sx = 0; sx < Ws; sx++) {
    const tile = structTiles[sy][sx];
    const gx = originWorldX + sx, gy = originWorldY + sy;

    const W = state.chunkWidth, H = state.chunkHeight;
    const cX = Math.floor(gx / W), cY = Math.floor(gy / H);
    const lX = ((gx % W) + W) % W, lY = ((gy % H) + H) % H;

    const chunk = getChunkByMapId(mapId, cX, cY, true);
    chunk.data[lY][lX] = {
      base: tile.base, top: [...(tile.top||[])], bl: [...(tile.bl||[])], br: [...(tile.br||[])],
      color: tile.color, name: tile.name, meta: { ...(tile.meta || {}) },
    };
    storage.queueSaveChunk(mapId, cX, cY, chunk.data);
  }
}

function placeStructureInChunk(mapId, startCX, startCY, startLX, startLY, structTiles) {
  const W = state.chunkWidth, H = state.chunkHeight;
  const originWorldX = startCX * W + startLX;
  const originWorldY = startCY * H + startLY;
  placeStructure(mapId, originWorldX, originWorldY, structTiles);
}

// circular visit that calls cb(map2d, x, y, cell, cx, cy, mapId, stateFlag)
function generateMapContentsCircularForChunk(mapId, cx, cy, cb, stateFlag) {
  const chunk = getChunkByMapId(mapId, cx, cy);
  const currentMap = chunk.data;

  const H = currentMap.length, W = currentMap[0]?.length || 0;
  const centerX = Math.floor(W/2), centerY = Math.floor(H/2);
  const maxR    = Math.ceil(Math.sqrt(centerX*centerX + centerY*centerY));
  const visited = Array.from({ length: H }, () => Array(W).fill(false));

  for (let r = 0; r <= maxR; r++) {
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (visited[y][x]) continue;
      const dist = Math.round(Math.hypot(x - centerX, y - centerY));
      if (dist === r) {
        cb(currentMap, x, y, currentMap[y][x], cx, cy, mapId, stateFlag);
        visited[y][x] = true;
      }
    }
  }
  storage.queueSaveChunk(mapId, cx, cy, currentMap);
}

// --- your specific generators / placers ---

const woodblock = { base:'#*', name:'Wood Wall', color:'#412', br:['W'] };
const hut = [ [woodblock, woodblock, woodblock] ];
let unique_basic_dungeonID = 0;

function roomCarverPopulator(currentMap) {
  const H = currentMap.length, W = currentMap[0]?.length || 0;

  // fill with temp-walls
  for (let y=0; y<H; y++) for (let x=0; x<W; x++) {
    if (currentMap[y][x].base !== '#') {
      currentMap[y][x].base = '#*';
      currentMap[y][x].name = 'Wall';
      currentMap[y][x].br   = ['W'];
      setCellColor(currentMap, x, y, '#222');
    }
  }

  const rooms = [];
  for (let i = 0; i < 12; i++) {
    const rw = Math.floor(Math.random()*4)+3;
    const rh = Math.floor(Math.random()*4)+3;
    const rx = Math.floor(Math.random()*(W - rw - 2)) + 1;
    const ry = Math.floor(Math.random()*(H - rh - 2)) + 1;

    for (let y = ry; y < ry+rh; y++) for (let x = rx; x < rx+rw; x++) {
      currentMap[y][x].base = '.';
      currentMap[y][x].name = 'Floor';
      currentMap[y][x].br = ['g'];
      setCellColor(currentMap, x, y, '#111');
    }
    rooms.push({ x: Math.floor(rx + rw/2), y: Math.floor(ry + rh/2) });
  }

  // connect room centers with L corridors
  for (let i = 1; i < rooms.length; i++) {
    let x0 = rooms[i-1].x, y0 = rooms[i-1].y;
    let x1 = rooms[i].x,   y1 = rooms[i].y;
    for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) {
      if (currentMap[y0][x].base === '#*') {
        currentMap[y0][x].base='.'; currentMap[y0][x].name='Corridor'; currentMap[y0][x].br=[];
        setCellColor(currentMap, x, y0, '#111');
      }
    }
    for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++) {
      if (currentMap[y][x1].base === '#*') {
        currentMap[y][x1].base='.'; currentMap[y][x1].name='Corridor'; currentMap[y][x1].br=[];
        setCellColor(currentMap, x1, y, '#111');
      }
    }
  }
}

function TorchPlacer(/*currentMap, x, y, cell*/) {
  // optional: left as-is (your earlier probabilistic placer)
}

function overworldPlainsGen(currentMap, x, y, cell, cx, cy, mapId, stateFlag = true) {
  if (cell.base === '.') {
    cell.name = 'Grass'; cell.br = ['g']; cell.color = '#151';
  }
  if (Math.random() < 0.01 && stateFlag) placeStructureInChunk(mapId, cx, cy, x, y, hut);

  if (Math.random() < 0.001 && cell.base === '.' && stateFlag) {
    unique_basic_dungeonID += 1;
    cell.base = 'D'; cell.name = 'Basic Dungeon Entrance';
    cell.br = ['s']; cell.color = '#222';
    cell.structure_id = 'basic_dungeon' + unique_basic_dungeonID;
  } else if (Math.random() < 0.001 && cell.base === '.' && stateFlag) {

      // wherever you spawned chests before:
      const { spawnFromTemplate } = require('./entityFactory');

      spawnFromTemplate('chest', { map:'overworld', cx, cy, x, y }, {}, true);

  }
}

function basicDungeonContents(currentMap/*, x,y,cell,cx,cy,mapId,stateFlag*/) {
  roomCarverPopulator(currentMap);
  // TorchPlacer(...) if you want
}

function ChunkgenPicker(mapId) {
  return (mapId === 'overworld') ? overworldPlainsGen : basicDungeonContents;
}

module.exports = {
  generateMapContentsCircularForChunk,
  placeStructure, placeStructureInChunk,
  roomCarverPopulator, TorchPlacer,
  overworldPlainsGen, basicDungeonContents, ChunkgenPicker
};
