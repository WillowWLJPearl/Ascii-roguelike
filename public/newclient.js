

  const socket = io();
    const container    = document.getElementById('game-container');
    const mapCanvas    = document.getElementById('mapCanvas');
    const entityCanvas = document.getElementById('entityCanvas');
    const fogCanvas    = document.getElementById('fogCanvas');
    const mapCtx       = mapCanvas.getContext('2d');
    const entityCtx    = entityCanvas.getContext('2d');
    const fogCtx       = fogCanvas.getContext('2d');
    let debugNoFog = false
    const VIEW_W = 17;
const VIEW_H = 13;
let currentplayer
// your single source of truth for which atlas‐cell goes with which map‐glyph
function getEntitiesAt(x, y) {
  return Object.entries(entities).filter(([id,e]) => e.x === x && e.y === y).map(([id,e])=>({...e, id}));
}
// sprite sheet that holds every 32×32 tile you might substitute
let atlasReady = false;
const atlas = new Image();
atlas.src = '/sprites/wall2.png';
atlas.onload = () => {
  atlasReady = true;
  console.log('✅ wall2.png loaded');
  // Force a redraw of everything:
  resetCamera();
  drawBaseMap();
  drawEntities();   // make sure you redraw sprites for entities too
};
atlas.onerror = () => {
  console.error('❌ failed to load /sprites/wall.png');
};
const spriteRules = [
  // if cell.base is '#', return your wallImg (an Image)
  (cell,x,y) => cell.name === 'Stone Wall' ? [1,7] : null,
  //(cell,x,y) => cell.name === 'Grass' ? wallImg : null,
  // ...other rules...
];
const wallImg = new Image();
wallImg.src = '/sprites/grass.png';
//wallImg.onload = () => atlasReady = true;

atlas.onerror = () => {
  console.error('❌ failed to load /sprites/wall.png');
};

const cam = {
  x: 0, y: 0,
  w: 0, h: 0,
  full: false  // toggle flag
};

    let map, seen, fovMask, lightMask, entities;
    let TILE = 16;


function resetCamera() {
  const rows = map.length;
  const cols = map[0]?.length || 0;

  if (cam.full) {
    // Full-map mode: show everything
    cam.w = cols;
    cam.h = rows;
    cam.x = 0;
    cam.y = 0;

  } else {
    // Normal mode: viewport is at most VIEW_W×VIEW_H, or smaller if the map itself is smaller
    cam.w = Math.min(VIEW_W, cols);
    cam.h = Math.min(VIEW_H, rows);

if (entities && currentplayer) {
  const p = entities[currentplayer];

  let targetX = p.x - Math.ceil(cam.w / 2);
 let targetY = p.y - Math.ceil(cam.h / 2);

  // …THEN CLAMP SO WE STAY IN‐BOUNDS…
  cam.x = Math.max(0, Math.min(targetX, cols - cam.w));
  cam.y = Math.max(0, Math.min(targetY, rows - cam.h));
}
  }

  // Now figure out TILE so cam.w × cam.h fits the container
  const BW = container.clientWidth;
  const BH = container.clientHeight;
  TILE = Math.floor(Math.min(BW / cam.w, BH / cam.h));

  // Finally, set the *buffer* size (canvas.width/height) to match
  const bufW = cam.w * TILE;
  const bufH = cam.h * TILE;
  [mapCanvas, entityCanvas, fogCanvas].forEach(c => {
    c.width  = bufW;
    c.height = bufH;
  });
}



function applyCam(ctx) {
  ctx.setTransform(
    TILE, 0,
    0, TILE,
    -cam.x * TILE,
    -cam.y * TILE
  );
}
    function resizeCanvases() {
      const cols = map[0].length, rows = map.length;
      // compute TILE if you want dynamic sizing:
      TILE = Math.floor(Math.min(
        container.clientWidth / cols,
        container.clientHeight / rows
      ));
      const bw = cols * TILE, bh = rows * TILE;
      [mapCanvas, entityCanvas, fogCanvas].forEach(c => {
        c.width  = bw;
        c.height = bh;
      });
      // **NO** c.style.width/c.style.height here
      // Also remove any setTransform, or adapt your draw calls
    }

function drawBaseMap() {
  mapCtx.resetTransform();
  mapCtx.clearRect(0, 0, mapCanvas.width, mapCanvas.height);
  applyCam(mapCtx);

  mapCtx.textAlign    = 'center';
  mapCtx.textBaseline = 'middle';

  const rows = map.length;
  const cols = map[0]?.length || 0;

  for (let y = cam.y; y < cam.y + cam.h; y++) {
    for (let x = cam.x; x < cam.x + cam.w; x++) {
      // SKIP out-of-bounds
      if (y < 0 || y >= rows || x < 0 || x >= cols) continue;

      const cell = map[y][x];

      // draw floor color
      mapCtx.fillStyle = cell.color;
      mapCtx.fillRect(x, y, 1, 1);

      // ask all rules for a sprite
      let sprite = null;
      if (atlasReady) {
        for (const rule of spriteRules) {
          const r = rule(cell, x, y);
          if (r) { sprite = r; break; }
        }
      }

      if (sprite instanceof HTMLImageElement) {
        // single‐image sprite
        mapCtx.drawImage(sprite,
          x, y, 1, 1
        );
      } else if (Array.isArray(sprite)) {
        // atlas‐based sprite [sx,sy]
        const [sx,sy] = sprite;
        mapCtx.drawImage(
          atlas,
          sx * 16, sy * 16, 16, 16,
          x, y, 1, 1
        );
      } else {
        // fallback ASCII
        mapCtx.font = `0.8px monospace`;
        mapCtx.fillStyle = '#FFF';
        mapCtx.fillText(cell.base, x + 0.5, y + 0.5);
      }
    }
  }
}

function drawEntities(playerId = currentplayer) {
  entityCtx.resetTransform();
  entityCtx.clearRect(0, 0, entityCanvas.width, entityCanvas.height);
  applyCam(entityCtx);

  entityCtx.textAlign    = 'center';
  entityCtx.textBaseline = 'middle';

  for (const id in entities) {
    const e  = entities[id];
    const tx = e.x, ty = e.y;

    // 1) DRAW SPRITE OR CHARACTER at (tx,ty)
    if (atlasReady) {
      let sprite;
      for (const rule of spriteRules) {
        const r = rule({ base: e.char, top: e.top }, tx, ty);
        if (r) { sprite = r; break; }
      }
      if (sprite) {
        const [sx, sy] = sprite;
        entityCtx.drawImage(
          atlas,
          sx * TILE, sy * TILE, TILE, TILE,
          tx, ty, 1, 1
        );
      } else {
        // fallback ASCII
        entityCtx.font      = `0.8px monospace`;
        entityCtx.fillStyle = e.color;
        entityCtx.fillText(e.char, tx + 0.5, ty + 0.5);
      }
    } else {
      // fallback ASCII if atlas not ready
      entityCtx.font      = `0.8px monospace`;
      entityCtx.fillStyle = e.color;
      entityCtx.fillText(e.char, tx + 0.5, ty + 0.5);
    }

    // 2) DRAW NAME ABOVE for other players
    if (id !== playerId) {
      const nameY = ty - 0.3;
      entityCtx.font      = `0.45px monospace`;
      entityCtx.fillStyle = e.color;
      entityCtx.lineWidth   = 0.05;
      entityCtx.strokeStyle = 'black';

      entityCtx.strokeText(e.name || id, tx + 0.5, nameY);
      entityCtx.fillText  (e.name || id, tx + 0.5, nameY);
    }

    // 3) DRAW HEALTH BAR above them (if they have .health)
    if (e.health && typeof e.health.currentHealth === 'number') {
      const { currentHealth: cur, maxHealth: max } = e.health;
      const ratio = Math.max(0, Math.min(cur / max, 1));

      // bar dimensions in tile‐units
      const barW = 0.8, barH = 0.1;
      const barX = tx + 0.1;
      let barY = ty - 0.6;
      if(e.type === 'player') {barY = barY-0.1}

      // border
      entityCtx.lineWidth   = 0.02;
      entityCtx.strokeStyle = '#000';
      entityCtx.strokeRect(barX, barY, barW, barH);

      // background
      entityCtx.fillStyle = '#444';
      entityCtx.fillRect(barX, barY, barW, barH);

      // filled health
      colour = 'red'
      if(id === playerId) {colour = 'green'}
      entityCtx.fillStyle = colour
      entityCtx.fillRect(barX, barY, barW * ratio, barH);

      // text overlay
      entityCtx.font         = `0.35px monospace`;
      entityCtx.textAlign    = 'center';
      entityCtx.textBaseline = 'bottom';
      entityCtx.fillStyle    = '#fff';
      entityCtx.fillText(`${cur}/${max}`,
                         tx + 0.5,
                         barY - 0.01);
    }
  }
}






const chunkHeight = 32
const chunkWidth = 32
function drawFog() {
  if (debugNoFog) return;
  fogCtx.resetTransform();
  fogCtx.clearRect(0, 0, fogCanvas.width, fogCanvas.height);
  applyCam(fogCtx);

  // the 32×32 window is centered in visibleMap/fovMask/lightMask
  const vH = chunkHeight, vW = chunkWidth;
  const halfH = Math.floor(vH/2), halfW = Math.floor(vW/2);

  // our on-screen viewport size
  const VW = cam.w, VH = cam.h;

  // compute the top-left of the viewport *inside* the 32×32 map:
  const offsetY = halfH - Math.floor(VH/2);
  const offsetX = halfW - Math.floor(VW/2);

  for (let sy = 0; sy < VH; sy++) {
    for (let sx = 0; sx < VW; sx++) {
      // map → visibleMap/FOV coordinates
      const my = offsetY + sy-1;
      const mx = offsetX + sx-1;

      // guard in case part of your viewport extends beyond the 32×32
      if (my < 0 || my >= vH || mx < 0 || mx >= vW) {
        // If you want to treat that as "never seen", just draw full black:
        fogCtx.fillStyle = 'rgba(0,0,0,1)';
        fogCtx.fillRect(cam.x+sx, cam.y+sy, 1,1);
        continue;
      }

      // 1) have we seen it?
      const tile = map[my][mx];
      const hasSeen = tile && tile.name !== 'Darkness';

      // 2) is it lit/refreshed now?
      const inFov = fovMask[my]?.[mx];
      const lit   = lightMask[my]?.[mx];

      // 3) draw at world coords = (cam.x+sx, cam.y+sy)
      const wx = cam.x + sx;
      const wy = cam.y + sy;

      if (!hasSeen) {
        // never seen → solid black
        fogCtx.fillStyle = 'rgba(0,0,0,1)';
        fogCtx.fillRect(wx, wy, 1, 1);

      } else if (!(inFov || lit)) {
        // seen before but not right now → dim
        fogCtx.fillStyle = 'rgba(0,0,0,0.6)';
        fogCtx.fillRect(wx, wy, 1, 1);
      }
      // else: currently visible → leave clear
    }
  }
}



function renderLoop() {
  onResizeOrReset()
  drawEntities();
  drawFog();
drawOverlay()
  requestAnimationFrame(renderLoop);
}
// assuming mapCanvas is your <canvas> element
mapCanvas.addEventListener('mousedown', e => {
  // only handle left button
  if (e.button !== 0) return;
  if(hoverTile === null) return;
  if(!readyToAttack.state) return;

  // get mouse position relative to the canvas
  const rect = mapCanvas.getBoundingClientRect();
  const mx = e.clientX - rect.left;
  const my = e.clientY - rect.top;

  // convert to tile coordinates
  const tx = Math.floor(mx / TILE) + cam.x;
  const ty = Math.floor(my / TILE) + cam.y;

  socket.emit('attack', { currentplayer, item: readyToAttack.item, tile: hoverTile });
});

let readyToAttack = {state: false, item: {}}
document.addEventListener('keydown', e => {
  if (e.key.toLowerCase()==='v') {
    if(readyToAttack.state) {
      readyToAttack.state = false
        highlightPos = null;
    } else {
      readyToAttack.item = selectedHotbarItem || {}
      readyToAttack.state = true
    }
  }
});
const highlightCanvas = document.getElementById('highlightCanvas');
const hlCtx = highlightCanvas.getContext('2d');

// 1) track just the tile coords (not px/py) and build hoverText too
let hoverTile = null;
let hoverText = '';

mapCanvas.addEventListener('mousemove', e => {
  if (!readyToAttack.state) {
    hoverTile = null;
    hoverText = '';
    return;
  }
  const { tileX, tileY } = screenToTile(e);

  // bounds check
  if (
    tileX < cam.x || tileX >= cam.x + cam.w ||
    tileY < cam.y || tileY >= cam.y + cam.h
  ) {
    hoverTile = null;
    hoverText = '';
    return;
  }

  // your “attackable” condition (tweak as needed)
  const px = entities[currentplayer].x;
  const py = entities[currentplayer].y;
  // example: only highlight if the target tile is adjacent
  if (Math.abs(tileX - px) + Math.abs(tileY - py) === 1) {
    hoverTile = { x: tileX, y: tileY };
    // build whatever text you want here:
    const cell = map[tileY][tileX];
    let name
    if(!readyToAttack?.item?.name) {
      name = 'Fist'
    } else {name = readyToAttack.item.name}
    hoverText = `${name}`;
  } else {
    hoverTile = null;
    hoverText = '';
  }
});

mapCanvas.addEventListener('mouseleave', () => {
  hoverTile = null;
  hoverText = '';
});

// 2) single overlay‐draw function
function drawOverlay() {
  // clear entire highlight layer once
  hlCtx.setTransform(1,0,0,1,0,0);
  hlCtx.clearRect(0, 0, highlightCanvas.width, highlightCanvas.height);

  if (!hoverTile) return;

  // — draw red tile outline using tile coords & applyCam —
  hlCtx.save();
  applyCam(hlCtx);
  hlCtx.strokeStyle = 'red';
  hlCtx.lineWidth   = 0.05;          // in tile units
  hlCtx.strokeRect(hoverTile.x, hoverTile.y, 1, 1);
  hlCtx.restore();

  // — draw text in pixel space just above the tile —
  const dx = (hoverTile.x - cam.x) * TILE;
  const dy = (hoverTile.y - cam.y) * TILE;
  hlCtx.setTransform(1,0,0,1,0,0);
  hlCtx.font         = `${TILE * 0.5}px sans-serif`;
  hlCtx.textAlign    = 'center';
  hlCtx.textBaseline = 'bottom';
  // black shadow
  hlCtx.fillStyle    = 'rgba(0,0,0,0.7)';
  hlCtx.fillText(hoverText, dx + TILE/2 + 1, dy - 1 + 1);
  // white text
  hlCtx.fillStyle    = '#FFF';
  hlCtx.fillText(hoverText, dx + TILE/2,     dy - 1);
}



function resizeOverlay() {
  // 1) match the highlight buffer to the map buffer
  highlightCanvas.width  = mapCanvas.width;
  highlightCanvas.height = mapCanvas.height;
  // 2) match the CSS size exactly
  highlightCanvas.style.width  = mapCanvas.style.width;
  highlightCanvas.style.height = mapCanvas.style.height;
}


document.addEventListener('keydown', e => {
  if (e.key.toLowerCase()==='m') {
    cam.full = !cam.full;
    resetCamera();
    drawBaseMap();
  } else if (e.code === 'Space'){
    socket.emit('wait', { currentplayer });
  }
});
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
 socket.on('mapData', data => {
   map       = data.map.map;
   seen      = data.map.seen;
   fovMask   = data.map.fovMask;
   lightMask = data.map.lightMask;

   resetCamera()
   drawBaseMap();
   renderLoop();
 });
 // dynamic updates come in via entityData _and_ mapNEntityData
 socket.on('entityData', data => {
   entities = data.list;
 });

    socket.on('clientPlayer', data => { 
currentplayer = data
//setInterval(checkTps, 1000);
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
socket.on('mapNEntityData', data => { 
  messageReceived()

entities = data.list
entities[currentplayer].x = 16
entities[currentplayer].y = 16
  seen = entities[currentplayer].seen['overworld']
  fovMask = entities[currentplayer].fovMask
map = entities[currentplayer].visibleMap
if(entities[currentplayer]?.lightMask) {
lightMask = entities[currentplayer].lightMask
}
   resetCamera()
   drawBaseMap();
   renderLoop();

      const container = document.getElementById('game-container');
const cols = 17, rows = 13;           // our fixed viewport
const CW = container.clientWidth;
const CH = container.clientHeight;
const tile = Math.floor(Math.min(CW/cols, CH/rows));

})
window.addEventListener('resize', () => {
  if (!map) return;
  resetCamera();
  drawBaseMap();
});

/*
  Each rule returns either
    {sprite:[sx,sy]}          → draw that sprite instead of ASCII
    null / undefined          → keep default ASCII
*/


        // wait until it’s ready

// helper to blit a tile from the atlas
function blitSprite(ctx, atlasX, atlasY, destX, destY) {
  ctx.drawImage(
    atlas,
    atlasX * TILE,        // source-x in the sheet
    atlasY * TILE,        // source-y
    TILE, TILE,           // source-w/h
    destX * TILE,         // dest-x in world coords (tile space)
    destY * TILE,
    TILE, TILE            // dest-w/h (one tile)
  );
}

const cached = new Map(); // key: 'sx_sy_state', value: ImageBitmap

function getSpriteVariant(sx,sy, dim) {
  const key = `${sx}_${sy}_${dim}`;
  if (cached.has(key)) return cached.get(key);
  const off = new OffscreenCanvas(TILE, TILE);
  const ctx = off.getContext('2d');
  ctx.drawImage(atlas, sx*TILE, sy*TILE, TILE, TILE, 0,0,TILE,TILE);
  if (dim) ctx.fillStyle = 'rgba(0,0,0,0.5)', ctx.fillRect(0,0,TILE,TILE);
  const bmp = off.transferToImageBitmap();
  cached.set(key, bmp);
  return bmp;
}

// ——————————————————————————————————————
// HOVER & SIDE PANEL INTEGRATION (canvas)
// ——————————————————————————————————————

const hoverName = document.getElementById('hoverName');
const sideInfo  = document.getElementById('sideInfo');
const sideTitle = document.getElementById('sideTitle');
const sideBody  = document.getElementById('sideBody');
const nextLayer = document.getElementById('nextLayer');

let inspectStack = [], inspectIndex = 0;

// Called when user clicks on canvas
mapCanvas.addEventListener('click', e => {
  const {tileX, tileY} = screenToTile(e);
  showSideInfo(tileX, tileY);
});

// On ‘M’ you toggle full‐map but also hide the panel
mapCanvas.addEventListener('mouseleave', _ => {
  hoverName.style.display = 'none';
});

// Track movement for the hover tooltip
mapCanvas.addEventListener('mousemove', e => {
  const {tileX, tileY, clientX, clientY} = screenToTile(e);

  // If outside our camera or outside map:
  if (tileX < 0 || tileY < 0 ||
      tileY >= map.length ||
      tileX >= map[0].length ||
      (!debugNoFog && !(fovMask[tileY][tileX] || lightMask[tileY][tileX]))) {
    hoverName.style.display = 'none';
    return;
  }

  // Build what to hover over: first entities, then the cell
  const ents = getEntitiesAt(tileX, tileY);
  const names = ents.map(e => `Entity: ${e.name||e.id}`)
              .concat([`Cell: ${map[tileY][tileX].name||'?'}`]);

  hoverName.textContent = names.join(' / ');
  hoverName.style.display = 'block';
  hoverName.style.left = clientX + 12 + 'px';
  hoverName.style.top  = clientY - 20 + 'px';
});

// Next‐layer button cycles through stack
nextLayer.addEventListener('click', () => {
  if (!inspectStack.length) return;
  inspectIndex = (inspectIndex + 1) % inspectStack.length;
  updateSideBody();
});

// Convert a mouse event → tileX/tileY + raw clientX,clientY
function screenToTile(e) {
  const rect = mapCanvas.getBoundingClientRect();
  const mx = e.clientX - rect.left;
  const my = e.clientY - rect.top;
  // These are in *tiles* because applyCam has scaled context
  const fx = mx / TILE, fy = my / TILE;
  const tileX = Math.floor(cam.x + fx);
  const tileY = Math.floor(cam.y + fy);
  return { tileX, tileY, clientX: e.clientX, clientY: e.clientY };
}

function showSideInfo(x, y) {
  // build stack: entities first, then cell
  const ents = getEntitiesAt(x, y);
  inspectStack = ents.map(e => ({ type:'entity', ...e }))
               .concat({ type:'cell', x, y, name: map[y][x].name });
  inspectIndex = 0;
  updateSideBody();
  sideInfo.style.display = 'block';
}

function updateSideBody() {
  const cur = inspectStack[inspectIndex];
  let html = '';

  if (cur.type === 'entity') {
    sideTitle.textContent = (cur.name || cur.id) + ' (entity)';
    // HP if you stored it in cur.bl
    if (cur.bl?.length >= 3) {
      html += `<div><b>HP:</b> ${cur.bl[0]} / ${cur.bl[2]}</div>`;
    }
    // status effects
    if (cur.top?.length) {
      html += `<div><b>Status:</b><br>` +
        cur.top.map(s=>`${s}: ${DESCRIPTIONS.status[s]||''}`).join('<br>') +
        `</div>`;
    }
    // type overlays
    if (cur.br?.length) {
      html += `<div><b>Types:</b><br>`+
        cur.br.map(t=>`${t}: ${DESCRIPTIONS.type[t]||''}`).join('<br>')+
        `</div>`;
    }
  } else {
    sideTitle.textContent = `${map[cur.y][cur.x].name} (${cur.x},${cur.y})`;
    html += `<div><b>Type:</b> Map Cell</div>`;
    const tops = map[cur.y][cur.x].top;
    if (tops?.length) {
      html += `<div><b>Status:</b><br>`+
        tops.map(s=>`${s}: ${DESCRIPTIONS.status[s]||''}`).join('<br>')+
        `</div>`;
    }
  }
  sideBody.innerHTML = html;
}

// define a handler to use the input value however you like
function handleTextInput(str) {
  let data = {name: '', uuid: ''}
  data.name = str
  data.uuid = currentplayer
socket.emit('changeName', data);
}

// wire up the button
document.getElementById('textSubmit').addEventListener('click', () => {
  const val = document.getElementById('textInput').value;
  handleTextInput(val);
});


const hotbarCanvas = document.getElementById('hotbarCanvas');
const hotbarCtx    = hotbarCanvas.getContext('2d');
const hotbarContainer = document.getElementById('hotbar-container');

// Call this whenever you resetCamera() or resize:
function resizeHotbar() {
  // container’s CSS size via getBoundingClientRect
  const { width, height } = hotbarContainer.getBoundingClientRect();
  hotbarCanvas.width  = Math.floor(width);
  hotbarCanvas.height = Math.floor(height);
}

function drawHotbar() {
  const player   = entities[currentplayer];
  const inv      = player.inventory || [];
  const HOTBARS  = player.slots.hotbar || 0;
  const hotbar   = inv.filter(i=>i.slot==='hotbar');

  hotbarCtx.resetTransform();
  hotbarCtx.clearRect(0,0,hotbarCanvas.width,hotbarCanvas.height);

  const W     = hotbarCanvas.width;
  const H     = hotbarCanvas.height;
  const slotH = H / HOTBARS;

  for (let i = 0; i < HOTBARS; i++) {
    const y = i * slotH;

    // if this slot is selected, draw a thicker yellow border:
    if (i === selectedHotbarSlot) {
      hotbarCtx.strokeStyle = 'yellow';
      hotbarCtx.lineWidth   = 4;
    } else {
      hotbarCtx.strokeStyle = '#FFF';
      hotbarCtx.lineWidth   = 2;
    }
    hotbarCtx.strokeRect(0, y, W, slotH);

    const item = hotbar[i];
    if (item) {
      const cx = W/2, cy = y + slotH/2;
      // draw char
      if (item.char) {
        hotbarCtx.font         = `${Math.floor(slotH*0.6)}px monospace`;
        hotbarCtx.fillStyle    = '#FFF';
        hotbarCtx.textAlign    = 'center';
        hotbarCtx.textBaseline = 'middle';
        hotbarCtx.fillText(item.char, cx, cy - slotH*0.1);
      }
      // draw name
      hotbarCtx.font         = `${Math.floor(slotH*0.25)}px sans-serif`;
      hotbarCtx.textAlign    = 'center';
      hotbarCtx.textBaseline = 'top';
      hotbarCtx.fillText(item.name||'', cx, cy + slotH*0.1);
      // draw quantity
      if (item.quantity != null) {
        hotbarCtx.font         = `${Math.floor(slotH*0.25)}px monospace`;
        hotbarCtx.textAlign    = 'right';
        hotbarCtx.textBaseline = 'bottom';
        hotbarCtx.fillText(
          item.quantity,
          W - slotH*0.1,
          y + slotH - slotH*0.1
        );
      }
    }
  }
}

// Global state:
let selectedHotbarSlot = 0;    // index 0…HOTBARS–1
let selectedHotbarItem = null; // the actual item object

function updateSelectedItem() {
  const player   = entities[currentplayer];
  const hotbar   = player.inventory.filter(i => i.slot==='hotbar');
  selectedHotbarItem = hotbar[selectedHotbarSlot] || null;
}

document.addEventListener('keydown', e => {
  // only digits 1…HOTBARS
  const n = parseInt(e.key, 10);
  const HOTBARS = entities[currentplayer].slots.hotbar;
  if (!isNaN(n) && n >= 1 && n <= HOTBARS) {
    selectedHotbarSlot = n - 1;
    updateSelectedItem();
    drawHotbar();
    // now `selectedHotbarItem` holds your newly selected item
    console.log('Selected hotbar item:', selectedHotbarItem);
  }
});
hotbarCanvas.addEventListener('click', e => {
  const rect = hotbarCanvas.getBoundingClientRect();
  const mx   = e.clientX - rect.left;
  const my   = e.clientY - rect.top;
  const HOTBARS = entities[currentplayer].slots.hotbar;
  const slotH  = hotbarCanvas.height / HOTBARS;
  // compute which slot
  const i = Math.floor(my / slotH);
  if (i >= 0 && i < HOTBARS) {
    selectedHotbarSlot = i;
    updateSelectedItem();
    drawHotbar();
    console.log('Selected hotbar item:', selectedHotbarItem);
  }
});


// Integrate into your render loop / resize logic
function onResizeOrReset() {
  resetCamera();        // your existing camera code
  resizeHotbar();
  resizeOverlay()
  drawBaseMap();
  drawEntities();
  drawFog();
updateSelectedItem();
drawHotbar();

}

