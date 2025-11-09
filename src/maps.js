// src/maps.js
const { state } = require('./state');
const storage = require('../storage');

// generating accessor with a 4th boolean arg (default true)
function getChunkByMapId(mapId, cx, cy, generate = true) {
    if (typeof mapId !== 'string') {
        mapId = String(mapId); // be tolerant; prevents path.join crashes
    }

    if (!state.maps[mapId]) {
        state.maps[mapId] = { map: { chunks: [] }, type: mapId, time: 0 };
    }

    // 1) in-memory
    let chunk = state.maps[mapId].map.chunks.find(c => c.x === cx && c.y === cy);
    if (chunk) return chunk;

    // 2) on disk
    const diskData = storage.loadChunkSync(mapId, cx, cy);
    if (diskData) {
        chunk = { x: cx, y: cy, data: diskData, meta: diskData.meta || {} };
        state.maps[mapId].map.chunks.push(chunk);
        return chunk;
    }

    // 3) not found
    if (!generate) return null; // <-- IMPORTANT: callers like vision pass false

    // 4) create empty and worldgen once
    const H = state.chunkHeight, W = state.chunkWidth;
    const data = Array.from({ length: H }, () =>
        Array.from({ length: W }, () => ({
            base: '.', top: [], bl: [], br: [],
            color: '#111', name: 'Floor', meta: {}
        }))
    );

    chunk = { x: cx, y: cy, data, meta: { generated: false } };
    state.maps[mapId].map.chunks.push(chunk);

    // one-time worldgen
    const { generateMapContentsCircularForChunk, ChunkgenPicker } = require('./worldgen');
    generateMapContentsCircularForChunk(mapId, cx, cy, ChunkgenPicker(mapId));
    chunk.meta.generated = true;

    storage.saveChunkSync(mapId, cx, cy, chunk.data);
    return chunk;
}




function calculateRelativeChunk(mapId, cy, cx, y, x, createIfMissing = false) {
    const H = state.chunkHeight, W = state.chunkWidth;
    const halfH = Math.floor(H / 2);
    const halfW = Math.floor(W / 2);

    const worldCenterY = cy * H + y;
    const worldCenterX = cx * W + x;

    const rel = Array.from({ length: H }, () =>
        Array.from({ length: W }, () => ({
            base: '', top: [], bl: [], br: [],
            color: '#111', name: 'Darkness', meta: {}
        }))
    );

    for (let ry = 0; ry < H; ry++) {
        for (let rx = 0; rx < W; rx++) {
            const wy = worldCenterY - halfH + ry;
            const wx = worldCenterX - halfW + rx;

            const nCY = Math.floor(wy / H);
            const nCX = Math.floor(wx / W);

            const lY = ((wy % H) + H) % H;
            const lX = ((wx % W) + W) % W;

            const neighbor = getChunkByMapId(mapId, nCX, nCY, createIfMissing);
            if (!neighbor) continue; // leave Darkness if chunk isn’t loaded
            rel[ry][rx] = neighbor.data[lY][lX];
        }
    }
    return rel;
}


function trueMappingWithSeenMapping(seenMapping, fullMaps, mapId) {
  const seenChunks = seenMapping[mapId]?.map?.chunks || [];
  const fullChunks = fullMaps[mapId]?.map?.chunks || [];
  const maskedOut = { map: { chunks: [] } };

  for (const fullChunk of fullChunks) {
    const { x: cx, y: cy, data } = fullChunk;
    const seenEntry = seenChunks.find(sc => sc.x === cx && sc.y === cy);
    const seenData  = seenEntry?.data;

    const masked = data.map((row, yy) =>
      row.map((cell, xx) => (seenData && seenData[yy]?.[xx]) ? cell : false)
    );

    maskedOut.map.chunks.push({ x: cx, y: cy, data: masked });
  }
  return maskedOut;
}

module.exports = {
  getChunkByMapId,
  calculateRelativeChunk,
  trueMappingWithSeenMapping,
};
