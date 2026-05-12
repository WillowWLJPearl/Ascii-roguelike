// storage.js
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');

const DATA_DIR   = path.join(__dirname, 'data');
const MAP_DIR    = m => path.join(DATA_DIR, 'maps', m);
const CHUNK_DIR  = m => path.join(MAP_DIR(m), 'chunks');
const CHUNK_FILE = (m,cx,cy) => path.join(CHUNK_DIR(m), `${cx}_${cy}.json`);
const META_FILE  = m => path.join(MAP_DIR(m), 'meta.json');
const ENT_DIR    = path.join(DATA_DIR, 'entities');
const ENT_FILE   = id => path.join(ENT_DIR, `${id}.json`);

function ensureDirSync(p)  { if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive:true }); }
async function ensureDir(p){ await fsp.mkdir(p, { recursive:true }); }

const { compressCellGrid, decompressCellGrid } = require('./cellStorage');


function writeJSONSync(file, obj) {
  ensureDirSync(path.dirname(file));
  fs.writeFileSync(file, JSON.stringify(obj));
}
async function writeJSON(file, obj) {
  await ensureDir(path.dirname(file));
  await fsp.writeFile(file, JSON.stringify(obj));
}

function readJSONSync(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (e) { if (e.code === 'ENOENT') return null; throw e; }
}
async function readJSON(file) {
  try { return JSON.parse(await fsp.readFile(file, 'utf8')); }
  catch (e) { if (e.code === 'ENOENT') return null; throw e; }
}

/* --- chunk APIs (sync reads, either save mode) --- */
function loadChunkSync(mapId, cx, cy) {
    ensureDirSync(CHUNK_DIR(mapId));
    const file = CHUNK_FILE(mapId, cx, cy);
    if (!fs.existsSync(file)) return null;

    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));

    // New format: { version: 'cells+refs', x, y, meta, cells: {templates, grid} }
    if (raw && raw.version === 'cells+refs' && raw.cells) {
        const data = decompressCellGrid(raw.cells);
        return { x: raw.x ?? cx, y: raw.y ?? cy, data, meta: raw.meta || {} };
    }

    // Legacy: raw is directly the chunk { x, y, data, meta }
    if (Array.isArray(raw.data)) {
        return raw;
    }

    // Really old: raw is just the 2D data array
    if (Array.isArray(raw)) {
        return { x: cx, y: cy, data: raw, meta: {} };
    }

    throw new Error('Unknown chunk format in ' + file);
}

function saveChunkSync(mapId, cx, cy, dataOrChunk) {
    ensureDirSync(CHUNK_DIR(mapId));
    const file = CHUNK_FILE(mapId, cx, cy);

    // Accept either {x,y,data,meta} or just data 2D array
    let data, meta;
    if (Array.isArray(dataOrChunk)) {
        data = dataOrChunk;
        meta = {};
    } else {
        data = dataOrChunk.data;
        meta = dataOrChunk.meta || {};
    }

    const cells = compressCellGrid(data);

    const payload = {
        version: 'cells+refs',
        x: cx,
        y: cy,
        meta,
        cells,
    };

    fs.writeFileSync(file, JSON.stringify(payload));
}

function ENTITY_FILE(mapId) {
  return path.join(MAP_DIR(mapId), `entities.json`);
}

function saveEntitiesSync(mapId, list) {
  fs.mkdirSync(MAP_DIR(mapId), { recursive: true });
  fs.writeFileSync(ENTITY_FILE(mapId), JSON.stringify(list, null, 2));
};

function loadEntitiesSync(mapId) {
  try {
    const raw = fs.readFileSync(ENTITY_FILE(mapId), 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
};

/* --- map meta (time, etc.) --- */
function loadMapMetaSync(mapId) {
  const meta = readJSONSync(META_FILE(mapId));
  return meta || { time: 0 };
}
function saveMapMetaSync(mapId, meta) {
  writeJSONSync(META_FILE(mapId), meta);
}

/* --- entities --- */
function saveEntitySync(uid, entity) {
  writeJSONSync(ENT_FILE(uid), entity);
}
function deleteEntitySync(uid) {
  try { fs.unlinkSync(ENT_FILE(uid)); } catch (_) {}
}
function loadAllEntitiesSync() {
  ensureDirSync(ENT_DIR);
  return fs.readdirSync(ENT_DIR)
    .filter(f => f.endsWith('.json'))
    .map(f => {
      const uid = f.slice(0, -5);
      const ent = readJSONSync(path.join(ENT_DIR, f));
      return [uid, ent];
    })
    .filter(([, ent]) => !!ent);
}

/* --- light write-behind queues (debounced) --- */
const pendingEntity = new Map();
function queueSaveEntity(uid, entity, ms = 200) {
  if (pendingEntity.has(uid)) clearTimeout(pendingEntity.get(uid));
  pendingEntity.set(uid, setTimeout(() => {
    saveEntitySync(uid, entity);
    pendingEntity.delete(uid);
  }, ms));
}

const pendingChunk = new Map();
function chunkKey(mapId, cx, cy) { return `${mapId}:${cx},${cy}`; }
function queueSaveChunk(mapId, cx, cy, data, ms = 200) {
  const k = chunkKey(mapId, cx, cy);
  if (pendingChunk.has(k)) clearTimeout(pendingChunk.get(k));
  pendingChunk.set(k, setTimeout(() => {
    saveChunkSync(mapId, cx, cy, data);
    pendingChunk.delete(k);
  }, ms));
}

module.exports = {
  // chunks
  loadChunkSync, saveChunkSync, queueSaveChunk,
  // map meta
  loadMapMetaSync, saveMapMetaSync,
  // entities
  saveEntitySync, deleteEntitySync, loadAllEntitiesSync, queueSaveEntity,

  saveEntitiesSync, loadEntitiesSync
};
