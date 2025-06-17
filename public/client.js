// client.js
const socket = io();  // <-- global `io` from /socket.io/socket.io.js
let debugNoFog = false;
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
/*
function eq(a,b) { return JSON.stringify(a) === JSON.stringify(b); }

// call this instead of drawMap()/drawViewport() directly
function diffAndRender( map, seen, fovMask, lightMask, entities ) {
  const h = map.length, w = map[0].length;
  // 1) map diff:
  if (prevMap) {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const oldCell = prevMap[y][x];
        const newCell =   map[y][x];
        // compare base, color or overlays:
        if (oldCell.base   !== newCell.base ||
            oldCell.color  !== newCell.color ||
            !eq(oldCell.top, newCell.top) ||
            !eq(oldCell.bl,  newCell.bl)  ||
            !eq(oldCell.br,  newCell.br) ) {
          updateCell(x,y);
        }
      }
    }
  } else {
    // first time, just draw everything
    drawMap();
  }

  // 2) entities diff:
  if (prevEntities) {
    // removed entities
    for (let id in prevEntities) {
      if (!(id in entities)) {
        document.getElementById(`entity-${id}`)?.remove();
      }
    }
    // added or moved entities
    for (let id in entities) {
      const e = entities[id];
      const old = prevEntities[id];
      if (!old) {
        // brand new
        addEntity(e.type, e.x, e.y, e.char, e.color, { top:e.top, bl:e.bl, br:e.br }, e.name);
      } else {
        // existed before → did it move?
        if (old.x !== e.x || old.y !== e.y) {
          // clear old spot
          updateCell(old.x, old.y);
          document.getElementById(`entity-${id}`)?.remove();
          // draw at new
          renderEntity(id);
        }
        // did its overlays or color change?
        if (!eq(old.top, e.top) || !eq(old.bl, e.bl) || !eq(old.br, e.br) || old.color !== e.color) {
          renderEntity(id, true);
        }
      }
    }
  } else {
    // first time
    Object.keys(entities).forEach(id => renderEntity(id));
  }

  // 3) store current as “previous”
  prevMap       = JSON.parse(JSON.stringify(map));
  prevSeen      = JSON.parse(JSON.stringify(seen));
  prevFovMask   = JSON.parse(JSON.stringify(fovMask));
  prevLightMask = JSON.parse(JSON.stringify(lightMask));
  prevEntities  = JSON.parse(JSON.stringify(entities));
}
*/
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

function setDirectionAt(x, y, dir) {
Object.entries(entities).forEach(([id, e]) => {
  if(e.x === x && e.y === y) {
    e.dir = dir
    renderEntity(id, true)
  }
})
}
function drawViewport(rendermap = false){
  const p = entities[currentplayer];
 // if(rendermap) {
  if(!drawMapToggle) {
  drawRegion(p.x-8, p.y-6, 17, 13);
  } else {
    drawMap()
  }
 // } else {
 //   diffAndRender(map, seen, fovMask, lightMask, entities)
 // }
}
function getUIDsByType(type){
  return typeIndex[type]||[];
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
function getActivePlayer(){
  // first‐spawned player is “active”
  return getUIDsByType('player')[0]||null;
}
function renderOverlay(cell, cls, text, styles) {
  const ov = document.createElement('div');
  ov.className = cls;
  ov.textContent = text;
  Object.assign(ov.style, styles);
  cell.appendChild(ov);
}
function getEntitiesAt(x, y) {
  return Object.entries(entities).filter(([id,e]) => e.x === x && e.y === y).map(([id,e])=>({...e, id}));
}
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
// when the server tells us “here’s your spawn”
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
// when others join
socket.on('playerJoined', ({ id, x, y, dir }) => {
  addEntity('player', x, y, '@', '#4f4', {}, `P#${id}`);
  setDirectionAt(x, y, dir);
});
function initFog(height, width){
  seen    = Array.from({length:height}, ()=>Array(width).fill(false));
  fovMask = Array.from({length:height}, ()=>Array(width).fill(false));
  lightMask = Array.from({length: height},()=>Array(width).fill(false));
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
socket.on('mapData', data => { 
initFog(data.height, data.width)
if(data.map?.lightMask) {
lightMask = data.map.lightMask
}
  seen = data.map.seen
  fovMask = data.map.fovMask
map = data.map.map

drawViewport(true)
})
socket.on('entityData', data => { 

entities = data.list
drawViewport(true)
})

//{map: {lightMask: entities[uid].lightMask, seen: entities[uid].seen, fovMask : entities[uid].fovMask, map: entities[uid].visibleMap}, width: mapWidth, height: mapHeight}
socket.on('mapNEntityData', data => { 
  messageReceived()

entities = data.list

if(entities[currentplayer]?.lightMask) {
lightMask = entities[currentplayer].lightMask
}
  seen = entities[currentplayer].seen
  fovMask = entities[currentplayer].fovMask
map = entities[currentplayer].visibleMap

drawViewport()
})
socket.on('moveEntity', data => { 
  let changedEntity = data.changed 
  entities = data.list
    document.getElementById(changedEntity)?.remove();
     updateCell(entities[changedEntity].x, entities[changedEntity].y);

//renderEntity(changedEntity, true)
map = data.map.map
drawViewport()
})

socket.on('clientPlayer', data => { 
currentplayer = data
setInterval(checkTps, 1000);
})
function checkTps() {
lastMessageReceived++
lastMessageSend++
}
function messageSend() {
lastMessageSend = 0
lastMessageReceived= 0
}
function messageReceived() {
  console.log(`Tps: ${lastMessageReceived - lastMessageSend}`)
lastMessageReceived = 0
lastMessageSend= 0

}
// send our moves to the server
document.addEventListener('keydown', e => {
  const dirMap = {
    ArrowUp:    'up',
    ArrowDown:  'down',
    ArrowLeft:  'left',
    ArrowRight: 'right'
  };
  const dir = dirMap[e.key];
  if (!dir) return;

  const pUid = currentplayer
  if (!pUid) return;

  if (e.shiftKey) {
    socket.emit('turn', { dir, currentplayer });
    socket.emit('commitData');
    messageSend()
  } else {
    const dx = dir==='left' ? -1 : dir==='right' ? 1 : 0;
    const dy = dir==='up'   ? -1 : dir==='down'  ? 1 : 0;
    socket.emit('move', { dx, dy, currentplayer });
    socket.emit('turn', { dir, currentplayer });
    socket.emit('commitData');
    messageSend()
  }
});

document.addEventListener('keydown', e => {
  if (e.key === 'm' || e.key === 'M') {
    // do whatever “M” should do
    if(drawMapToggle) {drawMapToggle = false} else {drawMapToggle = true}
    drawViewport(true)
    return;
  }
    if (e.code === 'Space') {
    socket.emit('wait', { currentplayer });
    return;
  }
});