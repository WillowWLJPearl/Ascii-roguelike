// src/entities.js
const { state } = require('./state');
const storage = require('../storage');
const { shiftMask, VisibleMapBase } = require('./utils');
const { getChunkByMapId, calculateRelativeChunk } = require('./maps');
const { assembleVisibleMaps } = require('./vision');

// add near top with other exports
function findEntityByAccountId(accountId) {
  for (const [uid, e] of Object.entries(state.entities)) {
    if (e.meta?.accountId === accountId) return uid;
  }
  return null;
}
function attachSocket(uid, socketId) {
  if (!state.entities[uid]) return;
  state.entities[uid].meta.socketId = socketId;
}
function detachSocket(uid) {
  if (!state.entities[uid]) return;
  state.entities[uid].meta.socketId = null;
}

function setEntityData(id, key, value) {
  if (!state.entities[id]) return;
  state.entities[id].meta[key] = value;
}
function getEntityData(id, key) {
  return state.entities[id]?.meta[key];
}

function addEntity(type, x, y, char, color, overlays, name, map='overworld', chunkx=0, chunky=0, maxHealth=2, maxStamina=5, persist=true) {
  const uid = `${type}-${state.nextEntityUID++}`;
  const H = state.chunkHeight, W = state.chunkWidth;

  const initialSeenMatrix = Array.from({ length: H }, () => Array(W).fill(false));
  const seen = { [map]: { map: { chunks: [ { x: chunkx, y: chunky, data: initialSeenMatrix } ] } } };

  state.entities[uid] = {
    uid,
    visibleMap: VisibleMapBase(W, H),
    stamina: { maxStamina, currentStamina: maxStamina },
    inventory: [],
    traits: [],
    slots: { hotbar: 4 },
    health: { maxHealth, currentHealth: maxHealth },
    seen,
    fovMask:   Array.from({length:H}, ()=>Array(W).fill(false)),
    lightMask: Array.from({length:H}, ()=>Array(W).fill(false)),
    FOV_RADIUS: 6,
    type, x, y, cy: chunky, cx: chunkx, map, char, color,
    name: name || type,
    top: overlays.top?.slice()||[],
    bl:  overlays.bl ?.slice()||[],
    br:  overlays.br ?.slice()||[],
    dir: 'down',
    meta: {}
  };
  (state.typeIndex[type] ||= []).push(uid);
    if (persist) {
        const storage = require('../storage');
        storage.queueSaveEntity(uid, state.entities[uid]);
    }
    return uid;
}


function moveEntityTile(uid, dx, dy) {
    const e = state.entities[uid];
    if (!e) return false;

    const W = state.chunkWidth;
    const H = state.chunkHeight;

    const rawX = e.x + dx;
    const rawY = e.y + dy;

    const deltaCX = Math.floor(rawX / W);
    const deltaCY = Math.floor(rawY / H);

    const nx = ((rawX % W) + W) % W;
    const ny = ((rawY % H) + H) % H;

    const targetCX = e.cx + deltaCX;
    const targetCY = e.cy + deltaCY;

    const chunk = getChunkByMapId(e.map, targetCX, targetCY);
    const cell  = chunk.data[ny][nx];

    // Tile collision, same as you already had:
    // if (state.blockBases.includes(cell.base)) return false;
    if (cell.top.some(s => state.blockStatuses.includes(s))) return false;
    if (cell.br .some(t => state.blockTypes   .includes(t))) return false;

    const blockingHere = Object.values(state.entities).some(other =>
        other.map === e.map && other.cx === targetCX && other.cy === targetCY &&
        other.x === nx && other.y === ny &&
        state.blockTypes.includes(other.type)
    );
    if (blockingHere) return false;

    e.cx = targetCX; e.cy = targetCY; e.x = nx; e.y = ny;
    e.lightMask = shiftMask(e.lightMask, dx, dy);

    assembleVisibleMaps();
    return true;
}

function moveEntity(uid, dx, dy) {
    const e = state.entities[uid];
    if (!e) return false;

    if (!isBitWorld(e.map)) {
        // old behavior
        return moveEntityTile(uid, dx, dy);
    }

    // bit-world: arrow press = add motion, not instant teleport
    ensureBitProps(e);

    // Interpret dx/dy as direction, give a one-tile impulse in bits
    const speedBits = BITS_PER_TILE; // one tile per tick if applied once

    e.velXBits += dx * speedBits * e.speed;
    e.velYBits += dy * speedBits * e.speed;
    if(e.velXBits > 2.56) {
        e.velXBits = 2.56
    } else if (e.velYBits > 2.56) {
        e.velYBits = 2.56
    }
    if(e.velXBits < -2.56) {
        e.velXBits = -2.56
    } else if (e.velYBits < -2.56) {
        e.velYBits = -2.56
    }
    console.log(e.velXBits, e.velYBits);

    // We don't move immediately; Tick() will apply the motion.
    return true;
}


function turnEntity(uid, dir) {
  const e = state.entities[uid]; if (!e) return;
  e.dir = dir;
  e.top = [ {up:'↑',down:'↓',left:'←',right:'→'}[dir] ];
  storage.queueSaveEntity(uid, e);
  assembleVisibleMaps();
}

function getUIDsByType(type) {
  return state.typeIndex[type] || [];
}

function getEntityUUIDsAt(mapId, cx, cy, x, y) {
  return Object.entries(state.entities)
    .filter(([uid, e]) => e.map === mapId && e.cx === cx && e.cy === cy && e.x === x && e.y === y)
    .map(([uid]) => uid);
}

function projectEntityForClient(e, rx, ry, viewerUid) {
    const isSelf = e.uid === viewerUid;

    const base = {
        uid:   e.uid,
        type:  e.type,
        name:  e.name,
        char:  e.char,
        color: e.color,
        dir:   e.dir,
        overlays: { top: e.top, bl: e.bl, br: e.br },
        health:  e.health,
        stamina: e.stamina,

        // tile position in the viewer's 32×32 window
        x: rx,
        y: ry,

        map: e.map,

        visibleMap: isSelf ? e.visibleMap : undefined,
        fovMask:    isSelf ? e.fovMask    : undefined,
        lightMask:  isSelf ? e.lightMask  : undefined,
        seen:       isSelf && e.seen && e.seen[e.map] ? { [e.map]: e.seen[e.map] } : undefined,

        inventory:  isSelf ? e.inventory : undefined,
        slots:      isSelf ? e.slots     : undefined,

        viewRedacted: !isSelf
    };

    // ✅ NEW: expose sub-tile bit offset inside current tile (0..1)
    if (isBitWorld(e.map)) {
        const B = BITS_PER_TILE;
        ensureBitProps(e); // make sure e.bitX / e.bitY exist

        const localBitX = e.bitX - e.x * B; // 0..B-1 within that tile
        const localBitY = e.bitY - e.y * B;

        base.bitOffsetX = localBitX / B; // 0..1
        base.bitOffsetY = localBitY / B;
    }

    return base;
}



function entityIdsInFov(viewer) {
  const ids = [];
  const W = state.chunkWidth, H = state.chunkHeight;
  const halfW = Math.floor(W / 2), halfH = Math.floor(H / 2);

  const vwx = viewer.cx * W + viewer.x;
  const vwy = viewer.cy * H + viewer.y;

  for (const [uid, e] of Object.entries(state.entities)) {
    if (uid === viewer.uid) continue;
    const ewx = e.cx * W + e.x;
    const ewy = e.cy * H + e.y;
    const dx = ewx - vwx, dy = ewy - vwy;
    const rx = dx + halfW, ry = dy + halfH;

    if (
      rx >= 0 && rx < W &&
      ry >= 0 && ry < H &&
      (viewer.fovMask[ry]?.[rx] || viewer.lightMask[ry]?.[rx])
    ) ids.push(uid);
  }
  return ids;
}

function entitiesInFovOf(viewer) {
  const list = {};
  for (const uid of entityIdsInFov(viewer)) list[uid] = state.entities[uid];
  return list;
}

function entitiesInFovDetailed(viewerUid) {
  const viewer = state.entities[viewerUid];
  const W = state.chunkWidth, H = state.chunkHeight;
  const halfW = Math.floor(W / 2), halfH = Math.floor(H / 2);

  const vwx = viewer.cx * W + viewer.x;
  const vwy = viewer.cy * H + viewer.y;

  const visible = {};
  visible[viewerUid] = projectEntityForClient(viewer, halfW, halfH, viewerUid);

  for (const [uid, e] of Object.entries(state.entities)) {
    if (uid === viewerUid) continue;
    const ewx = e.cx * W + e.x, ewy = e.cy * H + e.y;
    const dx = ewx - vwx, dy = ewy - vwy;
    const rx = dx + halfW, ry = dy + halfH;
    const inBounds = rx >= 0 && rx < W && ry >= 0 && ry < H;
    const inFov = viewer.fovMask[ry]?.[rx];
    const lit   = viewer.lightMask[ry]?.[rx];

    if (inBounds && (inFov || lit) && viewer.map === e.map) {
      visible[uid] = projectEntityForClient(e, rx, ry, uid);
    }
  }
  return visible;
}

const { BITS_PER_TILE } = require('./constants');

function isBitWorld(mapId) {
    const m = state.maps[String(mapId)];
    if (!m) return false;
    // for now: overworld uses bits, everything else uses tiles
    return m.type === 'overworld' || mapId === 'overworld';
}

function ensureBitProps(e) {
    if (typeof e.bitX !== 'number') e.bitX = e.x * BITS_PER_TILE;
    if (typeof e.bitY !== 'number') e.bitY = e.y * BITS_PER_TILE;

    if (typeof e.velXBits !== 'number') e.velXBits = 0;
    if (typeof e.velYBits !== 'number') e.velYBits = 0;

    if (!e.hitboxBits) {
        e.hitboxBits = { w: BITS_PER_TILE, h: BITS_PER_TILE };
    }
}


function getPlayerUuidBySocket(socketId) {
  for (const [id, e] of Object.entries(state.entities)) {
    if (e.meta?.socketId === socketId) return id;
  }
  return undefined;
}
function applyBitMotionForMap(mapId) {
    const W = state.chunkWidth;
    const H = state.chunkHeight;
    const B = BITS_PER_TILE;

    const WBits = W * B;
    const HBits = H * B;

    for (const [uid, e] of Object.entries(state.entities)) {
        if (e.map !== mapId) continue;
        if (!isBitWorld(e.map)) continue;

        ensureBitProps(e);

        const vx = e.velXBits;
        const vy = e.velYBits;

        if (!vx && !vy) continue;

        let newBitX = e.bitX + vx;
        let newBitY = e.bitY + vy;

        let deltaCX = Math.floor(newBitX / WBits);
        let deltaCY = Math.floor(newBitY / HBits);

        newBitX = ((newBitX % WBits) + WBits) % WBits;
        newBitY = ((newBitY % HBits) + HBits) % HBits;

        const targetCX = e.cx + deltaCX;
        const targetCY = e.cy + deltaCY;

        const newTileX = Math.floor(newBitX / B);
        const newTileY = Math.floor(newBitY / B);

        const chunk = getChunkByMapId(e.map, targetCX, targetCY);
        const cell  = chunk.data[newTileY][newTileX];

        // reuse your tile-level blocking rules
        if (cell.top.some(s => state.blockStatuses.includes(s))) {
            e.velXBits = 0; e.velYBits = 0;
            continue;
        }
        if (cell.br.some(t => state.blockTypes.includes(t))) {
            e.velXBits = 0; e.velYBits = 0;
            continue;
        }

        const blockingHere = Object.values(state.entities).some(other =>
            other !== e &&
            other.map === e.map &&
            other.cx === targetCX && other.cy === targetCY &&
            other.x === newTileX && other.y === newTileY &&
            state.blockTypes.includes(other.type)
        );
        if (blockingHere) {
            e.velXBits = 0; e.velYBits = 0;
            continue;
        }

        // Commit
        e.cx   = targetCX;
        e.cy   = targetCY;
        e.x    = newTileX;
        e.y    = newTileY;
        e.bitX = newBitX;
        e.bitY = newBitY;

        // For now, treat one arrow as one "step" → consume the motion
        e.velXBits = 0;
        e.velYBits = 0;
    }
}


module.exports = {
    applyBitMotionForMap,
  addEntity,
  moveEntity,
  turnEntity,
  setEntityData,
  getEntityData,
  getUIDsByType,
  getEntityUUIDsAt,
  entitiesInFovDetailed,
  entitiesInFovOf,
  projectEntityForClient,
  getPlayerUuidBySocket,
  findEntityByAccountId,
  attachSocket,
  detachSocket,
};
