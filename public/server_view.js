const socket = io();  // <-- global `io` from /socket.io/socket.io.js
let debugNoFog = true;
let map = [];
let entities = {};
let myId = null;
let seen
let lightMask
let fovMask
let entityVisuals = {};
let _nextEntityUID = 1;
let typeIndex = {}; 
let currentplayer
let drawMapToggle = false
let lastMessageSend = 0
let lastMessageReceived = 0
function initFog(height, width){
  seen    = Array.from({length:height}, ()=>Array(width).fill(false));
  fovMask = Array.from({length:height}, ()=>Array(width).fill(false));
  lightMask = Array.from({length: height},()=>Array(width).fill(false));
}
function renderOverlay(cell, cls, text, styles) {
  const ov = document.createElement('div');
  ov.className = cls;
  ov.textContent = text;
  Object.assign(ov.style, styles);
  cell.appendChild(ov);
}
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
function getEntitiesAt(x, y) {
  return Object.entries(entities).filter(([id,e]) => e.x === x && e.y === y).map(([id,e])=>({...e, id}));
}
// --- Dynamic CSS injection ---
const game = document.getElementById('game');
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
socket.emit('alldata');
socket.on('alldata', data => { 
console.log(data)
entities = data.entities
map = data.map
initFog(32, 32)
drawMap()
})