// ASCII Roguelike Core with Layered Inspection, JSON Descriptions, and Status Display
let playerSpawned = false;
let goblinSpawned = false;
const width = 40;
const height = 20;
const game = document.getElementById('game');
let map = [];
let entities = {};
let entityVisuals = {};
const typeIndex = {}; 
let lightMask = Array.from({length: height},()=>Array(width).fill(false));
// --- Fog of War & Look Direction ---
let seen = [];      // seen[y][x] = true once ever in FOV
let  = [];   // fovMask[y][x] = true this turn if in current FOV
let debugNoFog = false;
let _nextEntityUID = 1;
let playerUIDs = []
const FOV_RADIUS = 6;  // how far the player can see

const hoverName = document.getElementById('hoverName');
const sideInfo  = document.getElementById('sideInfo');
const sideTitle = document.getElementById('sideTitle');
const sideBody  = document.getElementById('sideBody');
const nextLayerBtn = document.getElementById('nextLayer');

// --- Status/effect/type/char lookup ---
let DESCRIPTIONS = { status:{}, type:{}, char:{} };

// --- Layered inspection state ---
let inspectStack = [];
let inspectIndex = 0;
// Direction unit vectors
const DIR_VECTORS = {
  up:    [ 0, -1],
  right: [ 1,  0],
  down:  [ 0,  1],
  left:  [-1,  0],
};

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

function revealFOV(playerUid) {
  if (!playerUid || !entities[playerUid]) return;
  clearFovMask();

  const p   = entities[playerUid];
  const px  = p.x, py = p.y, dir = p.dir;

  // always see your own tile
  seen[py][px]    = true;
  fovMask[py][px] = true;

  // cast rays in your cone (your existing Bresenham code) …
  for (let dy = -FOV_RADIUS; dy <= FOV_RADIUS; dy++) {
    for (let dx = -FOV_RADIUS; dx <= FOV_RADIUS; dx++) {
      const tx = px+dx, ty = py+dy;
      if (tx<0||tx>=width||ty<0||ty>=height) continue;
      if (dx*dx + dy*dy > FOV_RADIUS*FOV_RADIUS) continue;
      if (!inCone(dx,dy,dir)) continue;

      const line = bresenhamLine(px,py,tx,ty);
      let blocked = false;
      for (let i = 1; i < line.length; i++) {
        const [cx,cy] = line[i];
        seen[cy][cx] = true;
        if (!blocked) {
          fovMask[cy][cx] = true;
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


function clearFovMask(){
  for(let y=0; y<height; y++){
    for(let x=0; x<width; x++){
      fovMask[y][x] = false;
    }
  }
}
// --- Dynamic CSS injection ---
(function(){
  const style = document.createElement('style');
  style.textContent = `
#game {
  display: grid;
  grid-auto-columns: 32px;
  grid-auto-rows: 32px;
}
.cell {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
}
.base, .entity {
  position: absolute;
  top: 50%; left: 50%;
  transform: translate(-50%, -50%);
  font-size: 1.2em;
}
.overlay, .entity-overlay {
  position: absolute;
  pointer-events: none;
  user-select: none;
  font-size: 0.6em;
}
#sideInfo { scrollbar-width: thin; overflow-y: auto; }
#sideBody { word-break:break-word; white-space: pre-line; }
#nextLayer { background: #333; color: #fff; border: none; border-radius: 6px; padding: 2px 8px; cursor:pointer; }
#nextLayer:hover { background: #555; }
`;
  document.head.appendChild(style);
})();

// --- 1. Load JSON info ---
async function loadDescriptions() {
  try {
    // Try to load from file, fallback to example object if fails (offline mode)
    const res = await fetch('data.json');
    if (res.ok) {
      DESCRIPTIONS = await res.json();
    } else throw 'No data.json found';
  } catch (e) {
    // Demo fallback data
    DESCRIPTIONS = {
      status: { P: 'Poisoned: Loses HP every turn.', F: 'Frozen: Cannot move.', oF:"On Fire. Burning" },
      type:   { P: 'Friendly Entity.', W: 'Wild Entity. Impossible to tame', W: "Wall. Blocks, your path"},
      char:   { "@": "Player Entity.", "S": "Snake. Can't be reasoned with." }
    };
  }
}

// --- 2. Map generation ---
function generateMap() {
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

function getEntitiesAt(x, y) {
  return Object.entries(entities).filter(([id,e]) => e.x === x && e.y === y).map(([id,e])=>({...e, id}));
}
function initFog(){
  seen    = Array.from({length:height}, ()=>Array(width).fill(false));
  fovMask = Array.from({length:height}, ()=>Array(width).fill(false));
}

// --- 3. Render one cell with hover/click for layered stack ---
function renderCell(x, y) {
  const data = map[y][x];
  const cell = document.createElement('div');
  cell.className = 'cell';
  cell.id = `cell-${x}-${y}`;
  cell.style.backgroundColor = data.color;

  // floor/base glyph
  const base = document.createElement('span');
  base.className = 'base';
  base.textContent = data.base;
  cell.appendChild(base);

  // map overlays (multiple) with offsets
  data.top.forEach((ch, i) => renderOverlay(cell, 'overlay top', ch, { top: '0', left: '50%', transform: `translateX(-50%) translateX(${i * 0.6}em)` }));
  data.bl.forEach((ch, i) => renderOverlay(cell, 'overlay bottom-left', ch, { bottom: '0', left: `${i * 0.6}em` }));
  data.br.forEach((ch, i) => renderOverlay(cell, 'overlay bottom-right', ch, { bottom: '0', right: `${i * 0.6}em` }));

  // --- Hover logic for names of all layers
  cell.addEventListener('mousemove', e => {
    if (!debugNoFog && !fovMask[y]?.[x]) return;
    let stack = [];
    // Entities at this location:
    const ents = getEntitiesAt(x, y);
    stack.push(...ents.map(ent => ({type:'entity', ...ent})));
    stack.push({type:'cell', x, y, name: data.name});
    inspectStack = stack;
    inspectIndex = 0;
    if (stack.length) {
      hoverName.textContent = stack.map(s => (s.type==='entity' ? `Entity: ${(s.name||s.id)}` : `Cell: ${s.name}`)).join(' / ');
      hoverName.style.display = 'block';
      hoverName.style.left = (e.clientX + 12) + 'px';
      hoverName.style.top  = (e.clientY - 20) + 'px';
    } else {
      hoverName.style.display = 'none';
    }
  });
  cell.addEventListener('mouseleave', e => {
    hoverName.style.display = 'none';
    inspectStack = [];
    inspectIndex = 0;
  });
  // --- Click: show info for currently selected layer
  cell.addEventListener('click', e => {
    showSideInfo(x, y);
  });
  // --- apply fog of war shading ---
const inFov   = fovMask[y][x];
const wasSeen = seen[y][x];
if (!wasSeen) {
  // never seen → pitch black
  cell.style.backgroundColor = '#000';
  cell.querySelector('.base').style.visibility = 'hidden';
  cell.querySelectorAll('.overlay').forEach(o=>o.remove());
} else if (!inFov) {
  // seen before but not in current FOV → gray out
  cell.style.filter = 'brightness(50%)';
} else {
  // in FOV right now
  cell.style.filter = '';
}
// … inside renderCell(x,y), *after* you draw everything else …
if (!debugNoFog) {
  const inFov   = (fovMask[y][x] || lightMask[y][x])
  const wasSeen = seen[y][x];
  if (!wasSeen) {
    cell.style.backgroundColor = '#000';
    cell.querySelector('.base').style.visibility = 'hidden';
    cell.querySelectorAll('.overlay').forEach(o=>o.remove());
  } else if (!inFov) {
    cell.style.filter = 'brightness(50%)';
  } else {
    cell.style.filter = '';
  }
} else {
  // when debugNoFog === true, clear any shading
  cell.style.filter = '';
  cell.style.backgroundColor = map[y][x].color;
  cell.querySelector('.base').style.visibility = 'visible';
}


  return cell;
}

// --- 4. Info panel logic ---
function showSideInfo(x, y) {
  if (!inspectStack.length) return;
  let current = inspectStack[inspectIndex];
  sideInfo.style.display = 'block';
  let html = '';
  if (current.type === 'entity') {
    // Entity info
    sideTitle.textContent = (current.name || current.id) + ` (entity)`;
    // Health from bl[0] and bl[2] (current/max) if they exist
    let hp = (current.bl && current.bl.length >= 3) ? `${current.bl[0]} / ${current.bl[2]} HP` : '';
    html += `<div><b>Char:</b> ${current.char}</div>`;
    if (hp) html += `<div><b>HP:</b> ${hp}</div>`;
    // Status effects from top overlays, show description if known
    if (current.top && current.top.length) {
      html += `<div><b>Status:</b> ${current.top.map(s => `<span>${s}${DESCRIPTIONS.status[s]?': '+DESCRIPTIONS.status[s]:''}</span>`).join('<br>')}</div>`;
    }
    // Entity type from br overlays, show description if known
    if (current.br && current.br.length) {
      html += `<div><b>Types:</b> ${current.br.map(s => `<span>${s}${DESCRIPTIONS.type[s]?': '+DESCRIPTIONS.type[s]:''}</span>`).join('<br>')}</div>`;
    }
    // Description from char
    if (DESCRIPTIONS.char[current.char]) html += `<div><b>About:</b> ${DESCRIPTIONS.char[current.char]}</div>`;
  } else {
    // Cell info
    sideTitle.textContent = `${current.name||'Cell'} (${current.x},${current.y})`;
    html += `<div><b>Type:</b> Map Cell</div>`;
    if (map[current.y][current.x].top.length) {
      html += `<div><b>Status:</b> ${map[current.y][current.x].top.map(s => `<span>${s}${DESCRIPTIONS.status[s]?': '+DESCRIPTIONS.status[s]:''}</span>`).join('<br>')}</div>`;
    }
  }
  sideBody.innerHTML = html;
}

// --- Next Layer button cycles stack ---
nextLayerBtn.onclick = () => {
  if (!inspectStack.length) return;
  inspectIndex = (inspectIndex + 1) % inspectStack.length;
  const s = inspectStack[inspectIndex];
  document.getElementById(`cell-${s.x}-${s.y}`)?.click();
};

// --- Overlay helper ---
function renderOverlay(cell, cls, text, styles) {
  const ov = document.createElement('div');
  ov.className = cls;
  ov.textContent = text;
  Object.assign(ov.style, styles);
  cell.appendChild(ov);
}

// --- Draw entire map + entities ---
function drawMap() {
  game.innerHTML = '';
  const mapHeight = map.length;
  const mapWidth = map[0]?.length || 0;
  game.style.display = 'grid';
  game.style.gridTemplateColumns = `repeat(${mapWidth}, 1fr)`;
  game.style.gridTemplateRows    = `repeat(${mapHeight}, 1fr)`;
  for (let y = 0; y < mapHeight; y++) {
    for (let x = 0; x < mapWidth; x++) {
      game.appendChild(renderCell(x, y));
    }
  }
  Object.keys(entities).forEach(id => renderEntity(id));
}

function drawRegion(x0, y0, w, h) {
  game.innerHTML = '';
  const mapHeight = map.length;
  const mapWidth = map[0]?.length || 0;
  game.style.display = 'grid';
  game.style.gridTemplateColumns = `repeat(${w}, 1fr)`;
  game.style.gridTemplateRows    = `repeat(${h}, 1fr)`;
  for (let dy = 0; dy < h; dy++) {
    for (let dx = 0; dx < w; dx++) {
      const x = ((x0 + dx) % mapWidth + mapWidth) % mapWidth;
      const y = ((y0 + dy) % mapHeight + mapHeight) % mapHeight;
      game.appendChild(renderCell(x, y));
    }
  }
  Object.keys(entities).forEach(id => {
    const e = entities[id];
    const rx = ((e.x - x0) % mapWidth + mapWidth) % mapWidth;
    const ry = ((e.y - y0) % mapHeight + mapHeight) % mapHeight;
    if (rx >= 0 && rx < w && ry >= 0 && ry < h) {
      const origX = e.x, origY = e.y;
      e.x = (x0 + rx);
      e.y = (y0 + ry);
      renderEntity(id);
      e.x = origX;
      e.y = origY;
    }
  });
}

function updateCell(x, y) {
  const cell = document.getElementById(`cell-${x}-${y}`);
  if (!cell) return;
  const data = map[y][x];
  cell.style.backgroundColor = data.color;
  const base = cell.querySelector('.base');
  base.textContent = data.base;
  base.style.visibility = 'visible';
  cell.querySelectorAll('.overlay, .entity, .entity-overlay').forEach(el => el.remove());
  data.top.forEach((ch, i) => renderOverlay(cell, 'overlay top', ch, { top: '0', left: '50%', transform: `translateX(-50%) translateX(${i * 0.6}em)` }));
  data.bl.forEach((ch, i) => renderOverlay(cell, 'overlay bottom-left', ch, { bottom: '0', left: `${i * 0.6}em` }));
  data.br.forEach((ch, i) => renderOverlay(cell, 'overlay bottom-right', ch, { bottom: '0', right: `${i * 0.6}em` }));
}

// --- Entity management ---
function addEntity(type,x,y,char,color,overlays,name){
  const uid = `${type}-${_nextEntityUID++}`;
  entities[uid] = {
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
  renderEntity(uid);
  return uid;
}
function getUIDsByType(type){
  return typeIndex[type]||[];
}
function getActivePlayer(){
  // first‐spawned player is “active”
  return getUIDsByType('player')[0]||null;
}
function setCellData(x, y, key, value) {
  if (!map[y]?.[x]) return;
  map[y][x].meta[key] = value;
}
function getCellData(x, y, key) {
  return map[y]?.[x]?.meta[key];
}

function setEntityData(id, key, value) {
  if (!entities[id]) return;
  entities[id].meta[key] = value;
}
function getEntityData(id, key) {
  return entities[id]?.meta[key];
}
// 1. Find all UID’s for entities of a given “type”:
function getUIDsByType(type) {
  return Object.keys(entities).filter(uid => entities[uid].type === type);
}

// 2. Find all UID’s at a given x,y:
function getUIDsAt(x,y) {
  return Object.entries(entities)
    .filter(([uid,e]) => e.x===x && e.y===y)
    .map(([uid]) => uid);
}
function renderEntity(uid, visualOnly=false){
  const e = entities[uid]; if(!e) return;
  const {x,y,char,color,dir} = e;
  const vis = entityVisuals[uid] || {};
  if(!debugNoFog && !(fovMask[y]?.[x] || lightMask[y]?.[x])) return;

  if(!visualOnly) updateCell(x,y);
  const cell = document.getElementById(`cell-${x}-${y}`); if(!cell) return;

  cell.style.backgroundColor = vis.color || color;
  cell.querySelector('.base').style.visibility = 'hidden';

  // main glyph
  let glyph = document.getElementById(`entity-${uid}`);
  if(!glyph){
    glyph = document.createElement('span');
    glyph.id = `entity-${uid}`;
    glyph.className = 'entity';
    cell.appendChild(glyph);
  }
  glyph.textContent = char;

  // clear previous overlays, then redraw from e & vis … (same as before)
  cell.querySelectorAll('.entity-overlay').forEach(el=>el.remove());
  const tops = vis.top || e.top, bls = vis.bl || e.bl, brs = vis.br || e.br;
  const overlay = (list, cls, styCb) => list.forEach((ch,i)=>renderOverlay(cell,cls,ch,styCb(i)));
  overlay(tops,'entity-overlay top',          i=>({top:'0',left:'50%',transform:`translateX(-50%) translateX(${i*0.6}em)`}));
  overlay(bls ,'entity-overlay bottom-left',  i=>({bottom:'0',left :`${i*0.6}em`}));
  overlay(brs ,'entity-overlay bottom-right', i=>({bottom:'0',right:`${i*0.6}em`}));
  if(dir){ const arrow = {up:'↑',down:'↓',left:'←',right:'→'}[dir];
    renderOverlay(cell,'entity-overlay top',arrow,{top:'0',left:'50%',transform:'translateX(-50%)'}); }
}
// Turn whatever entity(s) are at (x,y)
function setDirectionAt(x, y, dir) {
Object.entries(entities).forEach(([id, e]) => {
  if(e.x === x && e.y === y) {
    e.dir = dir
    renderEntity(id, true)
  }
})
}


document.getElementById('wait').addEventListener('click', () => {
  // e.g. re-run your worldgen & redraw:
    Tick()
    
});


// --- Visual-only entity overrides ---
function setEntityVisualColor(id, col) {
  entityVisuals[id] = entityVisuals[id] || {};
  entityVisuals[id].color = col;
  renderEntity(id, true);
}
function setEntityVisualOverlay(id, type, ch) {
  entityVisuals[id] = entityVisuals[id] || {};
  (entityVisuals[id][type] = entityVisuals[id][type] || []).push(ch);
  renderEntity(id, true);
}
function clearEntityVisualOverlay(id, type) {
  if (!entityVisuals[id]) return;
  entityVisuals[id][type] = [];
  renderEntity(id, true);
}

// --- Map overlays helpers ---
function setMapOverlay(x, y, type, val) {
  if (['top','bl','br'].includes(type)) {
    map[y][x][type].push(val);
    updateCell(x, y);
  }
}
function clearMapOverlay(x, y, type) {
  if (['top','bl','br'].includes(type)) {
    map[y][x][type] = [];
    updateCell(x, y);
  }
}

const blockBases    = ['#'];
const blockStatuses = ['S'];
const blockTypes    = ['W'];

function moveEntity(uid, dx, dy) {
  const e = entities[uid];
  if(e.type = 'player') {
    Tick()
  }
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

  // — if we get here it’s free to move —
  // restore the old floor cell
  updateCell(e.x, e.y);

  // remove the old sprite
  document.getElementById(`entity-${uid}`)?.remove();

  // update coords
  e.x = nx;
  e.y = ny;

  // draw at new spot
  renderEntity(uid);
}
const deltas4 = [
  { dx:  1, dy:  0 },  // east
  { dx: -1, dy:  0 },  // west
  { dx:  0, dy:  1 },  // south
  { dx:  0, dy: -1 }   // north
];
function turnEntity(uid, dir){
  const e = entities[uid]; if(!e) return;
  e.dir = dir;
  (entityVisuals[uid] ||= {}).top = [ {up:'↑',down:'↓',left:'←',right:'→'}[dir] ];
  renderEntity(uid, true);
   drawRegion(e.x - 8, e.y - 6, 17, 13);  // example viewport around player
}
function arrowChar(dir) {
  return { up:'↑', down:'↓', left:'←', right:'→' }[dir];
}

function Tick() {
    for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      lightMask[y][x] = false;
    }
  }
  Object.entries(entities).forEach(([id, e]) => {
  console.log(`Entity ${id}:`, e);
  // e.x, e.y, e.char, e.meta, etc.
  if(e.type === "goblin") {
    let directions = [
      'down',
      'up',
      'left',
      'right'
    ]
    setDirectionAt(e.x,e.y, directions[Math.floor(Math.random()*4)])
  }
if (e.type === "torch" && !(getEntityData(id, "burnedOut")) && seen[e.y]?.[e.x]) {
  // have we ever seen this tile?
  const seenHere = !!seen[e.y]?.[e.x];

  // fetch last‐frame value (default to false)
  const wasDim = getEntityData(id, "isDim") || false;

  // if it’s been seen, flip it; otherwise force off
  const isDimNow = seenHere ? !wasDim : false;
  setEntityData(id, "isDim", isDimNow);

  // only light when “on”

    lightMask[e.y][e.x] = true;
    for (let {dx, dy} of deltas4) {
      const nx = e.x + dx, ny = e.y + dy;
      if (nx < 0||nx>=width||ny<0||ny>=height) continue;
      lightMask[ny][nx] = true;
      seen[ny][nx] = true;
      if (isDimNow) {
      for (let {dx: ddx, dy: ddy} of deltas4) {
        const nnx = nx + ddx, nny = ny + ddy;
        if (nnx < 0||nnx>=width||nny<0||nny>=height) continue;
        lightMask[nny][nnx] = true;
        seen[nny][nnx] = true;
      }
    }
  }
}

    const p = getActivePlayer();
  if (p) {
    revealFOV(p);
    drawViewport();
  }
});

}


// --- Input ---
document.addEventListener('click', e => {
  if (!e.target.classList.contains('cell')) {
    sideInfo.style.display = 'none';
  }
});
// --- Input handling ---
document.addEventListener('keydown', e => {
  const dirMap = {
    ArrowUp:    'up',
    ArrowDown:  'down',
    ArrowLeft:  'left',
    ArrowRight: 'right'
  };
  const dir = dirMap[e.key];
  if (!dir) return;

  const pUid = getActivePlayer();
  if (!pUid) return;

  if (e.shiftKey) {
    turnEntity(pUid, dir);
    revealFOV(pUid);
    drawViewport();
  } else {
    const dx = dir==='left' ? -1 : dir==='right' ? 1 : 0;
    const dy = dir==='up'   ? -1 : dir==='down'  ? 1 : 0;
    moveEntity(pUid, dx, dy);
    turnEntity(pUid, dir);
    revealFOV(pUid);
    drawViewport();
  }
});
document.addEventListener('keydown', e => {
  if (e.key === 'm' || e.key === 'M') {
    // do whatever “M” should do
    drawMap()
    return;
  }
    if (e.code === 'Space') {
    Tick()
    return;
  }
});
function drawViewport(){
  const pUid = getActivePlayer(); if(!pUid) return;
  const p = entities[pUid];
  drawRegion(p.x-8, p.y-6, 17, 13);
}

function getCellContents(x, y) {
  if (!map[y] || !map[y][x]) return null;  // Defensive: map or cell missing
  const cell = map[y][x];
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


function generateMapContentsCircular(cb) {
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
            cb(x, y, map[y][x]);
            visited[y][x] = true;
          }
        }
      }
    }
  }
}
function setCellColor(x, y, color) {
  if (!map[y] || !map[y][x]) return;
  map[y][x].color = color;
  updateCell(x, y);
}

function roomCarverPopulator() {
  // 1. Fill with walls
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    if(map[y][x].base !== "#") {
    map[y][x].base = "#*";
    map[y][x].name = "Wall";
    map[y][x].br = ["W"];
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
      map[y][x].base = ".";
      map[y][x].name = "Floor";
      map[y][x].br = [];
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
      if (map[y0][x].base === "#*") {
        map[y0][x].base = ".";
        map[y0][x].name = "Corridor";
        map[y0][x].br = [];
        setCellColor(x, y0, "#111");
      }
    }
    for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++) {
      if (map[y][x1].base === "#*") {
        map[y][x1].base = ".";
        map[y][x1].name = "Corridor";
        map[y][x1].br = [];
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
    getCellContents(x - 1, y)?.cellBase,   // left
    getCellContents(x + 1, y)?.cellBase,   // right
    getCellContents(x, y - 1)?.cellBase,   // up
    getCellContents(x, y + 1)?.cellBase    // down
  ];
  const PermWallCount = neighbors.filter(c => c === "#").length;
  if (PermWallCount >= 1 && map[y][x].base !== "#") { 
    map[y][x].base = "#*";
    map[y][x].name = "Wall"
    if(!map[y][x].br.includes("W")) {
      map[y][x].br.push("W")
    }
    setCellColor(x, y, "#222")
  }
}
}


function TrapSetter(x, y, cell) {
  // Place a treasure every 5th column, not on wall

  const xneighbours = [
    getCellContents(x - 1, y)?.cellBase,   // left
    getCellContents(x + 1, y)?.cellBase,   // right
  ];
  const yneighbours = [
        getCellContents(x, y - 1)?.cellBase,   // up
    getCellContents(x, y + 1)?.cellBase    // down
  ]


  const xTempWallCount = xneighbours.filter(c => c === "#*").length;
  const yTempWallCount = yneighbours.filter(c => c === "#*").length;

  if((yneighbours === 2 || yTempWallCount === 2) && cell.base !== "#" && cell.base !== "#*" && Math.random() < 0.10) {
    cell.name = "Fire Trap"
    cell.base = "F"
    cell.br.push("T")
    setCellColor(x, y, "#511")
  }
}
function TorchPlacer(x, y, cell) {
  // Place a treasure every 5th column, not on wall

  const xneighbours = [
    getCellContents(x - 1, y)?.cellBase,   // left
    getCellContents(x + 1, y)?.cellBase   // right
  ];
  const yneighbours = [
        getCellContents(x, y - 1)?.cellBase,   // up
    getCellContents(x, y + 1)?.cellBase    // down
  ]
    const TempNeighbours = [
        getCellContents(x, y - 1)?.cellBase,   // up
    getCellContents(x, y + 1)?.cellBase,    // down
        getCellContents(x - 1, y)?.cellBase,   // left
    getCellContents(x + 1, y)?.cellBase   // right
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
function turnEntityUID(uid, dir) {
  const e = entities[uid];
  e.dir = dir;
  entityVisuals[uid] = entityVisuals[uid] || {};
  entityVisuals[uid].top = [ arrowChar(dir) ];
  renderEntity(uid, true);
}
function pushToTypeIndex(type, uid){
  (typeIndex[type] ||= []).push(uid);
}
function getUIDsByType(type){ return typeIndex[type] ?? []; }
function getActivePlayer(){ return getUIDsByType('player')[0] ?? null; }

function addEntity(type,x,y,char,color='#0a0',overlays={},name){
  const uid = `${type}-${_nextEntityUID++}`;
  entities[uid] = {
    type, x, y, char, color,
    name : name || type,
    top  : overlays.top?.slice() || [],
    bl   : overlays.bl ?.slice() || [],
    br   : overlays.br ?.slice() || [],
    dir  : 'down',
    meta : {}
  };
  pushToTypeIndex(type, uid);
  renderEntity(uid);
  return uid;
}
// --- Initialize ---
(async ()=>{
  await loadDescriptions();
  generateMap();
  initFog();
  // generate content
  generateMapContentsCircular(roomCarverPopulator);
  generateMapContentsCircular(TrapSetter);
  generateMapContentsCircular(TorchPlacer);

  // initial FOV + viewport
  const pUid = getActivePlayer();
  if(pUid){ revealFOV(pUid); drawViewport(); }
  else     drawMap();
})();