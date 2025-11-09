// src/vision.js
const { state } = require('./state');
const { DIR_VECTORS, COS_HALF_CONE } = require('./constants');
const { calculateRelativeChunk } = require('./maps');

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

function inCone(dx, dy, dir) {
  const [vx, vy] = DIR_VECTORS[dir];
  const dist = Math.hypot(dx, dy);
  if (dist === 0) return true;
  const nx = dx / dist, ny = dy / dist;
  const dot = nx * vx + ny * vy;
  return dot >= COS_HALF_CONE;
}

function getSeenArrayOfChunk(uid, mapId, cx, cy) {
  const e = state.entities[uid];
  if (!e.seen[mapId]) e.seen[mapId] = { map: { chunks: [] } };
  let entry = e.seen[mapId].map.chunks.find(sc => sc.x === cx && sc.y === cy);
  if (!entry) {
    entry = {
      x: cx, y: cy,
      data: Array.from({ length: state.chunkHeight }, () =>
        Array(state.chunkWidth).fill(false)
      )
    };
    e.seen[mapId].map.chunks.push(entry);
  }
  return entry;
}

function markGlobalSeen(uid, relX, relY) {
  const p = state.entities[uid];
  const W = state.chunkWidth, H = state.chunkHeight;

  const worldX = p.cx * W + p.x + relX;
  const worldY = p.cy * H + p.y + relY;

  const ncx = Math.floor(worldX / W);
  const ncy = Math.floor(worldY / H);
  const lx  = ((worldX % W) + W) % W;
  const ly  = ((worldY % H) + H) % H;

  const seenChunk = getSeenArrayOfChunk(uid, p.map, ncx, ncy);
  seenChunk.data[ly][lx] = true;
}

function revealFOV(playerUid) {
  const p = state.entities[playerUid];
  if (!p) return;

  const H = state.chunkHeight, W = state.chunkWidth;
  const R = p.FOV_RADIUS;

  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) p.fovMask[y][x] = false;

  const cy = Math.floor(H / 2);
  const cx = Math.floor(W / 2);

  p.fovMask[cy][cx] = true;
  markGlobalSeen(playerUid, 0, 0);

  const rel = calculateRelativeChunk(p.map, p.cy, p.cx, p.y, p.x);

  for (let dy = -R; dy <= R; dy++) {
    for (let dx = -R; dx <= R; dx++) {
      if (dx*dx + dy*dy > R*R) continue;
      if (!inCone(dx, dy, p.dir)) continue;

      const tx = cx + dx, ty = cy + dy;
      if (tx < 0 || tx >= W || ty < 0 || ty >= H) continue;

      const line = bresenhamLine(cx, cy, tx, ty);
      let blocked = false;

      for (const [lx, ly] of line) {
        markGlobalSeen(playerUid, lx - cx, ly - cy);
        if (!blocked) p.fovMask[ly][lx] = true;

        const cell = rel[ly][lx];
        if (
          state.blockBases.includes(cell.base) ||
          cell.top.some(s => state.blockStatuses.includes(s)) ||
          cell.br .some(t => state.blockTypes.includes(t))
        ) {
          blocked = true;
          break;
        }
      }
    }
  }
}

function assembleVisibleMaps() {
    const H = state.chunkHeight, W = state.chunkWidth;
    const halfH = Math.floor(H / 2);
    const halfW = Math.floor(W / 2);

    const DARK = { base:'', top:[], bl:[], br:[], color:'#111', name:'Darkness', meta:{} };

    for (const e of Object.values(state.entities)) {
        // (Optional but recommended): throttle non-players to cut load further.
        // Players every tick, others every 8 ticks.
        const rate = (e.type === 'player') ? 1 : 8;
        e._vmTick = (e._vmTick || 0) + 1;
        if ((e._vmTick % rate) !== 0) continue;

        // window around the entity; do NOT generate missing chunks here
        const rel = calculateRelativeChunk(e.map, e.cy, e.cx, e.y, e.x, /*createIfMissing*/ false);

        // reset visible map to darkness
        e.visibleMap = Array.from({ length: H }, () =>
            Array.from({ length: W }, () => DARK)
        );

        // quick index for seen mats by chunk coord
        const seenChunks = e.seen?.[e.map]?.map?.chunks || [];
        const seenIndex = new Map();
        for (const { x: scx, y: scy, data: seenMat } of seenChunks) {
            seenIndex.set(`${scx},${scy}`, seenMat);
        }

        // fill only the HxW window around the entity
        for (let ry = 0; ry < H; ry++) {
            for (let rx = 0; rx < W; rx++) {
                // world coords for this window cell
                const wy = (e.cy * H + e.y) - halfH + ry;
                const wx = (e.cx * W + e.x) - halfW + rx;

                const nCY = Math.floor(wy / H);
                const nCX = Math.floor(wx / W);
                const lY = ((wy % H) + H) % H;
                const lX = ((wx % W) + W) % W;

                const seenMat = seenIndex.get(`${nCX},${nCY}`);
                if (!seenMat || !seenMat[lY] || !seenMat[lY][lX]) {
                    // not seen → leave darkness
                    continue;
                }

                // copy from rel window if present; otherwise darkness
                const row = rel[ry];
                e.visibleMap[ry][rx] = row && row[rx] ? row[rx] : DARK;
            }
        }
    }
}

function getWorldPosition(e, relX, relY) {
  const W = state.chunkWidth, H = state.chunkHeight;
  const halfW = Math.floor(W / 2);
  const halfH = Math.floor(H / 2);

  const dX = relX - halfW;
  const dY = relY - halfH;

  const worldX = e.cx * W + e.x + dX;
  const worldY = e.cy * H + e.y + dY;

  const cx = Math.floor(worldX / W);
  const cy = Math.floor(worldY / H);

  const x = ((worldX % W) + W) % W;
  const y = ((worldY % H) + H) % H;

  return { map: e.map, worldX, worldY, cx, cy, x, y };
}

module.exports = {
  revealFOV,
  assembleVisibleMaps,
  markGlobalSeen,
  getSeenArrayOfChunk,
  getWorldPosition,
  bresenhamLine,
  inCone
};
