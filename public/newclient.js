  const socket = io();
    const container    = document.getElementById('game-container');
    const mapCanvas    = document.getElementById('mapCanvas');
    const entityCanvas = document.getElementById('entityCanvas');
    const fogCanvas    = document.getElementById('fogCanvas');
    const mapCtx       = mapCanvas.getContext('2d');
    const entityCtx    = entityCanvas.getContext('2d');
    const fogCtx       = fogCanvas.getContext('2d');
    let debugNoFog = true
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
  (cell,x,y) => cell.base === '#*' ? [1,7] : null,
  // ...other rules...
];
const wallImg = new Image();
wallImg.src = '/sprites/wall.png';
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
    let TILE = 64;


function resetCamera() {
  const cols = map[0].length,
        rows = map.length;

  if (cam.full) {
    cam.w = cols;
    cam.h = rows;
    cam.x = 0;
    cam.y = 0;
  } else {
    cam.w = Math.min(VIEW_W, cols);
    cam.h = Math.min(VIEW_H, rows);
    if(entities) {
    const p = entities[currentplayer];
    cam.x = Math.max(0, Math.min(cols - cam.w, p.x - Math.floor(cam.w / 2)));
    cam.y = Math.max(0, Math.min(rows - cam.h, p.y - Math.floor(cam.h / 2)));
    }
  }

  // The "tile" size is the *largest* tile that fits cam.w × cam.h in the box:
  const BW = container.clientWidth,
        BH = container.clientHeight;
  TILE = Math.floor(Math.min(BW / cam.w, BH / cam.h));

  // Now, set canvas *buffer* (not style) sizes:
  const bufW = cam.w * TILE, bufH = cam.h * TILE;
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

  for (let y = cam.y; y < cam.y + cam.h; y++) {
    for (let x = cam.x; x < cam.x + cam.w; x++) {
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
        // single‐image sprite (your wallImg)
        mapCtx.drawImage(sprite,
          x, y, 1, 1         // dest in *tiles*
        );
      } else if (Array.isArray(sprite)) {
        // atlas‐based sprite [sx,sy]
        const [sx,sy] = sprite;
  mapCtx.drawImage(
    atlas,           // your single Image()
    sx * 16,       // source-x in pixels
    sy * 16,       // source-y in pixels
    16, 16,      // source width/height
    x, y,            // destination in *tiles* (applyCam scale)
    1, 1             // dest size in *tiles*
  );
      } else {
        // fallback ASCII
        mapCtx.font = `0.8px monospace`;
        mapCtx.fillStyle = '#FFF';
        mapCtx.fillText(cell.base, x+0.5, y+0.5);
      }
    }
  }
}



function drawEntities() {
  entityCtx.resetTransform();
  entityCtx.clearRect(0,0,entityCanvas.width,entityCanvas.height);
  applyCam(entityCtx);
  entityCtx.textAlign = 'center';
  entityCtx.textBaseline = 'middle';

  for (let id in entities) {
    const e = entities[id];
    if (!debugNoFog && !(fovMask[e.y][e.x] || lightMask[e.y][e.x]))
      continue;

    // sprite check
    let sprite = null;
    if (atlasReady) {
      for (const rule of spriteRules) {
        const r = rule({ base: e.char, top: e.top }, e.x, e.y);
        if (r) { sprite = r; break; }
      }
    }

    if (sprite) {
      const [sx,sy] = sprite;
 entityCtx.drawImage(
   atlas,
   sx * TILE, sy * TILE, TILE, TILE,
   e.x, e.y, 1, 1
 );
    } else {
      entityCtx.font = `0.8px monospace`;
      entityCtx.fillStyle = e.color;
 entityCtx.fillText(e.char, e.x + 0.5, e.y + 0.5);
    }
  }
}
const chunkHeight = 32
const chunkWidth = 32



function drawFog() {
    if(debugNoFog) return
  fogCtx.resetTransform();
  fogCtx.clearRect(0, 0, fogCanvas.width, fogCanvas.height);
  applyCam(fogCtx);

  // grab the array of seen‐chunks for this map
  const seenChunks = seen?.map?.chunks || [];

  for (let y = cam.y; y < cam.y + cam.h; y++) {
    for (let x = cam.x; x < cam.x + cam.w; x++) {

      // 1) “Seen?” via chunk lookup
      const cx = Math.floor(x / chunkWidth);
      const cy = Math.floor(y / chunkHeight);
      const chunk = seenChunks.find(c => c.x === cx && c.y === cy);
      let hasSeen = false;
      if (chunk) {
        // wrap into chunk‐local coords
        const lx = ((x % chunkWidth)  + chunkWidth)  % chunkWidth;
        const ly = ((y % chunkHeight) + chunkHeight) % chunkHeight;
        hasSeen = chunk.data[ly]?.[lx] || false;
      }

      // 2) “In FOV?” and “lit?” via relative indices
      const rx = x - cam.x;  // [0..chunkWidth)
      const ry = y - cam.y;  // [0..chunkHeight)
      const inFov = fovMask[ry]?.[rx];
      if(lightMask) {
      const lit   = lightMask[ry]?.[rx];
      }
      // 3) draw fog
      if (!hasSeen) {
        fogCtx.fillStyle = 'rgba(0,0,0,1)';
        fogCtx.fillRect(x, y, 1, 1);
      } else if (!(inFov || lit)) {
        fogCtx.fillStyle = 'rgba(0,0,0,0.6)';
        fogCtx.fillRect(x, y, 1, 1);
      }
      // else: visible → leave clear
    }
  }
}

function renderLoop() {
  drawEntities();
  drawFog();
  requestAnimationFrame(renderLoop);
}

document.addEventListener('keydown', e => {
  if (e.key.toLowerCase()==='m') {
    cam.full = !cam.full;
    resetCamera();
    drawBaseMap();
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
   console.log(data.map.map)
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

  seen = entities[currentplayer].seen['overworld']
  fovMask = entities[currentplayer].fovMask
map = entities[currentplayer].visibleMap
if(entities[currentplayer]?.lightMask) {
lightMask = entities[currentplayer].lightMask
}
    resetCamera();
      drawBaseMap();
      renderLoop()

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
      (!debugNoFog && !fovMask[tileY][tileX])) {
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
