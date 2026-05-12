

  // ==== NEW: auth gate ====
let authed = false;

// Socket first (we'll auth before doing anything else)

// ============================
// WebSocket transport (Ktor /ws)
// Server expects JSON frames: { event: string, data: any }
// ============================
(function(){
  const params = new URLSearchParams(location.search);
  const explicit = params.get('ws');

  function defaultWsUrl(){
    // If this page is served over http(s), try same host but port 3000.
    // If opened as file://, fall back to localhost.
    try {
      if (location.protocol === 'http:' || location.protocol === 'https:') {
        const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
        const host = location.hostname || 'localhost';
        // If you're serving the client from another port, we default to 3000 for the server.
        return `${proto}//${host}:3000/ws`;
      }
    } catch (_) {}
    return 'ws://localhost:3000/ws';
  }

  const WS_URL = explicit || defaultWsUrl();

  class WsEmitter {
    constructor(url){
      this.url = url;
      this.ws = null;
      this.handlers = new Map(); // event -> Set(fn)
      this.queue = [];
      this.connected = false;
      this._connect();
    }

    _connect(){
      try {
        this.ws = new WebSocket(this.url);
      } catch (e) {
        console.error('WS ctor failed', e);
        this._emitLocal('__error', e);
        return;
      }

      this.ws.addEventListener('open', () => {
        this.connected = true;
        // flush queued messages
        for (const m of this.queue) this.ws.send(m);
        this.queue.length = 0;
        this._emitLocal('__open');
      });

      this.ws.addEventListener('message', (ev) => {
        let msg;
        try { msg = JSON.parse(ev.data); } catch (_) { return; }
        const event = msg && msg.event;
        const data  = msg ? msg.data : undefined;
        if (!event) return;
        const set = this.handlers.get(event);
        if (!set) return;
        for (const fn of set) {
          try { fn(data); } catch (e) { console.error('handler error', event, e); }
        }
      });

      this.ws.addEventListener('close', () => {
        this.connected = false;
        this._emitLocal('__close');
        // simple reconnect
        setTimeout(() => this._connect(), 800);
      });

      this.ws.addEventListener('error', (e) => {
        this._emitLocal('__error', e);
      });
    }

    _emitLocal(name, payload){
      const set = this.handlers.get(name);
      if (!set) return;
      for (const fn of set) {
        try { fn(payload); } catch (_) {}
      }
    }

    on(event, fn){
      if (!this.handlers.has(event)) this.handlers.set(event, new Set());
      this.handlers.get(event).add(fn);
    }

    off(event, fn){
      const set = this.handlers.get(event);
      if (!set) return;
      set.delete(fn);
    }

    emit(event, data){
      const payload = JSON.stringify({ event, data: (data === undefined ? null : data) });
      if (this.connected && this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(payload);
      } else {
        this.queue.push(payload);
      }
    }
  }

  // expose a socket-like global used by the rest of the file
  window.socket = new WsEmitter(WS_URL);
  console.log('🔌 WS connecting to', WS_URL, '(override with ?ws=ws://HOST:3000/ws)');
})();


// Simple overlay UI for login/register
(function createAuthOverlay() {
  const overlay = document.createElement('div');
  overlay.id = 'auth-overlay';
  overlay.style.cssText = `
    position:fixed; inset:0; display:flex; align-items:center; justify-content:center;
    background:rgba(0,0,0,0.7); z-index:99999; font-family:system-ui, sans-serif;
  `;

  overlay.innerHTML = `
    <div style="background:#1e1e1e; color:#fff; width:min(420px, 92vw); padding:20px 18px; border-radius:14px; box-shadow:0 10px 30px rgba(0,0,0,.4);">
      <h2 style="margin:0 0 12px; font-size:20px; font-weight:700;">Welcome</h2>
      <p style="margin:0 0 16px; opacity:.85;">Log in or create a new account to continue.</p>
      <form id="auth-form">
        <div style="display:flex; gap:8px; margin-bottom:10px;">
          <button type="button" data-mode="login"  class="mode-btn active"  style="flex:1; padding:8px 10px; border-radius:8px; border:1px solid #444; background:#2a2a2a; color:#fff; cursor:pointer;">Login</button>
          <button type="button" data-mode="register" class="mode-btn"       style="flex:1; padding:8px 10px; border-radius:8px; border:1px solid #444; background:#2a2a2a; color:#fff; cursor:pointer;">Register</button>
        </div>
        <label style="display:block; font-size:12px; opacity:.8; margin:8px 0 4px;">Username</label>
        <input id="auth-username" type="text" autocomplete="username" required
               style="width:100%; padding:10px 12px; border-radius:8px; border:1px solid #444; background:#111; color:#fff;">
        <label style="display:block; font-size:12px; opacity:.8; margin:12px 0 4px;">Password</label>
        <input id="auth-password" type="password" autocomplete="current-password" required
               style="width:100%; padding:10px 12px; border-radius:8px; border:1px solid #444; background:#111; color:#fff;">

        <div id="auth-error" style="color:#ff6b6b; min-height:18px; margin:10px 0 0;"></div>

        <button id="auth-submit" type="submit"
                style="margin-top:14px; width:100%; padding:10px 12px; border-radius:10px; border:1px solid #555; background:#3b82f6; color:#fff; font-weight:700; cursor:pointer;">
          Continue
        </button>
      </form>
    </div>
  `;

  document.body.appendChild(overlay);

  let mode = 'login';
  const btns = overlay.querySelectorAll('.mode-btn');
  btns.forEach(b => b.addEventListener('click', () => {
    btns.forEach(x => x.classList.remove('active'));
    b.classList.add('active');
    mode = b.getAttribute('data-mode');
    // update button text
    overlay.querySelector('#auth-submit').textContent = mode === 'login' ? 'Log In' : 'Create Account';
  }));

  const form = overlay.querySelector('#auth-form');
  const userEl = overlay.querySelector('#auth-username');
  const passEl = overlay.querySelector('#auth-password');
  const errEl  = overlay.querySelector('#auth-error');

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    errEl.textContent = '';
    const username = (userEl.value || '').trim();
    const password = (passEl.value || '').trim();
    if (!username || !password) {
      errEl.textContent = 'Please enter both a username and password.';
      return;
    }
    // send auth request
    socket.emit('auth', { mode, username, password });
    overlay.querySelector('#auth-submit').disabled = true;
    overlay.querySelector('#auth-submit').textContent = 'Checking...';
  });
  // handle server responses (Ktor /ws)
  socket.on('authResult', (res) => {
    if (res && res.ok) {
      authed = true;
      // server returns your player uid here
      if (res.playerUid) currentplayer = res.playerUid;
      overlay.remove();
      return;
    }
    authed = false;
    errEl.textContent = (res && res.error) ? res.error : 'Authentication failed.';
    overlay.querySelector('#auth-submit').disabled = false;
    overlay.querySelector('#auth-submit').textContent = mode === 'login' ? 'Log In' : 'Create Account';
  });

  // If the socket drops, bring the auth overlay back so you can reconnect/re-auth
  socket.on('__close', () => {
    authed = false;
    if (!document.getElementById('auth-overlay')) {
      location.reload();
    }
  });
})();

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
var currentplayer
// your single source of truth for which atlas‐cell goes with which map‐glyph
function getEntitiesAt(x, y) {
  return Object.entries(entities)
    .filter(([id, e]) => e.x === x && e.y === y)
    .map(([id, e]) => ({ ...e, id }));
}

// Server sends overlays nested under entity.overlays; flatten to the old shape
function normalizeEntities(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  const out = {};
  for (const [id, e] of Object.entries(obj)) {
    if (!e || typeof e !== 'object') { out[id] = e; continue; }
    const ov = e.overlays || {};
    out[id] = {
      ...e,
      id,
      top: (e.top ?? ov.top ?? []),
      bl:  (e.bl  ?? ov.bl  ?? []),
      br:  (e.br  ?? ov.br  ?? []),
    };
  }
  return out;
}

// sprite sheet that holds every 32×32 tile you might substitute
let atlasReady = false;
const atlas = new Image();
atlas.src = '/sprites/wall2.png';
atlas.onload = () => {
  atlasReady = true;
  console.log('✅ wall2.png loaded');
  // Force a redraw of everything:
  if (map) {    
  resetCamera();
  drawBaseMap();
  drawEntities();   // make sure you redraw sprites for entities too
  }
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
      full: false,   // toggle flag
      subX: 0,       // fractional offset in tiles (for bits)
      subY: 0
  };



    let map, seen, fovMask, lightMask, entities;
    let TILE = 16;


  function resetCamera() {
      if (!map) return;
      const rows = map.length;
      const cols = map[0]?.length || 0;

      if (cam.full) {
          // Full-map mode: show everything
          cam.w = cols;
          cam.h = rows;
          cam.x = 0;
          cam.y = 0;

      } else {
          // Normal mode: viewport is at most VIEW_W×VIEW_H
          cam.w = Math.min(VIEW_W, cols);
          cam.h = Math.min(VIEW_H, rows);

          if (entities && currentplayer && entities[currentplayer]) {
              const p = entities[currentplayer];

              let targetX = p.x - Math.ceil(cam.w / 2);
              let targetY = p.y - Math.ceil(cam.h / 2);

              cam.x = Math.max(0, Math.min(targetX, cols - cam.w));
              cam.y = Math.max(0, Math.min(targetY, rows - cam.h));
          }
      }

      // compute TILE so cam.w × cam.h fits the container
      const BW = container.clientWidth;
      const BH = container.clientHeight;
      TILE = Math.floor(Math.min(BW / cam.w, BH / cam.h));

      const bufW = cam.w * TILE;
      const bufH = cam.h * TILE;
      [mapCanvas, entityCanvas, fogCanvas].forEach(c => {
          c.width  = bufW;
          c.height = bufH;
      });
  }


  const renderState = {}; // uid -> { x, y }
  let lastFrameTime = 0;


  function applyCam(ctx) {
      ctx.setTransform(
          TILE, 0,
          0, TILE,
          -(cam.x + cam.subX) * TILE,
          -(cam.y + cam.subY) * TILE
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
      if (!map) return;
      mapCtx.resetTransform();
      mapCtx.clearRect(0, 0, mapCanvas.width, mapCanvas.height);
      applyCam(mapCtx);

      mapCtx.textAlign    = 'center';
      mapCtx.textBaseline = 'middle';

      const rows = map.length;
      const cols = map[0]?.length || 0;

      const startY = Math.max(0, Math.floor(cam.y));
      const endY   = Math.min(rows, Math.ceil(cam.y + cam.h));
      const startX = Math.max(0, Math.floor(cam.x));
      const endX   = Math.min(cols, Math.ceil(cam.x + cam.w));

      for (let y = startY; y < endY; y++) {
          for (let x = startX; x < endX; x++) {
              const cell = map[y][x];

              // floor colour
              mapCtx.fillStyle = cell.color;
              mapCtx.fillRect(x, y, 1, 1);

              let sprite = null;
              if (atlasReady) {
                  for (const rule of spriteRules) {
                      const r = rule(cell, x, y);
                      if (r) { sprite = r; break; }
                  }
              }

              if (sprite instanceof HTMLImageElement) {
                  mapCtx.drawImage(sprite, x, y, 1, 1);
              } else if (Array.isArray(sprite)) {
                  const [sx, sy] = sprite;
                  mapCtx.drawImage(
                      atlas,
                      sx * 16, sy * 16, 16, 16,
                      x, y, 1, 1
                  );
              } else {
                  mapCtx.font = `0.8px monospace`;
                  mapCtx.fillStyle = '#FFF';
                  mapCtx.fillText(cell.base, x + 0.5, y + 0.5);
              }
          }
      }
  }

  function stepEntityAnimations(dt) {
      if (!entities) return;

      const lerpSpeed = 10; // per second
      const alpha = Math.min(1, dt * lerpSpeed);

      for (const id in entities) {
          const e   = entities[id];
          const uid = e.uid || id;

          let targetX, targetY;

          // 1) Prefer world-ish fractional coords if present
          if (typeof e.renderX === 'number' && typeof e.renderY === 'number') {
              targetX = e.renderX;
              targetY = e.renderY;
          } else if (typeof e.bitX === 'number' && typeof e.bitY === 'number') {
              targetX = e.bitX / BITS_PER_TILE;
              targetY = e.bitY / BITS_PER_TILE;
          } else {
              // fallback: tile coords
              targetX = e.x;
              targetY = e.y;
          }

          let rs = renderState[uid];
          if (!rs) {
              renderState[uid] = { x: targetX, y: targetY };
              continue;
          }

          rs.x += (targetX - rs.x) * alpha;
          rs.y += (targetY - rs.y) * alpha;
      }

      // cleanup
      for (const id in renderState) {
          if (!entities[id]) delete renderState[id];
      }
  }



  function getEntityRenderPos(e) {
      const id = e.uid || e.id;
      const rs = id && renderState[id];
      if (rs) return { x: rs.x, y: rs.y };

      if (typeof e.renderX === 'number' && typeof e.renderY === 'number') {
          return { x: e.renderX, y: e.renderY };
      }
      return { x: e.x, y: e.y };
  }




  const BITS_PER_TILE = 16;

  function drawEntities(playerId = currentplayer) {
      if (!entities) return;

      entityCtx.resetTransform();
      entityCtx.clearRect(0, 0, entityCanvas.width, entityCanvas.height);

      const S = 16; // atlas tile size

      // =============== 1) Everyone except the local player ===============
      // World-space, uses cam.x + cam.subX so the world moves per bit
      applyCam(entityCtx);

      entityCtx.textAlign    = 'center';
      entityCtx.textBaseline = 'middle';

      for (const id in entities) {
          const e = entities[id];

          // we'll draw the local player later in screen space
          if (id === playerId) continue;

          const { x: tx, y: ty } = getEntityRenderPos(e);

          // skip anything outside the camera window
          if (tx < cam.x || tx >= cam.x + cam.w || ty < cam.y || ty >= cam.y + cam.h) {
              continue;
          }

          // --- sprite / char ---
          if (atlasReady) {
              let sprite;
              for (const rule of spriteRules) {
                  const r = rule({ base: e.char, top: e.top }, tx, ty);
                  if (r) { sprite = r; break; }
              }
              if (Array.isArray(sprite)) {
                  const [sx, sy] = sprite;
                  entityCtx.drawImage(atlas, sx * S, sy * S, S, S, tx, ty, 1, 1);
              } else {
                  entityCtx.font      = `0.8px monospace`;
                  entityCtx.fillStyle = e.color;
                  entityCtx.fillText(e.char, tx + 0.5, ty + 0.5);
              }
          } else {
              entityCtx.font      = `0.8px monospace`;
              entityCtx.fillStyle = e.color;
              entityCtx.fillText(e.char, tx + 0.5, ty + 0.5);
          }

          // --- name label (non-self only, which this always is here) ---
          const nameY = ty - 0.3;
          entityCtx.font        = `0.45px monospace`;
          entityCtx.fillStyle   = e.color;
          entityCtx.lineWidth   = 0.05;
          entityCtx.strokeStyle = 'black';
          entityCtx.strokeText(e.name || id, tx + 0.5, nameY);
          entityCtx.fillText  (e.name || id, tx + 0.5, nameY);

          // --- health bar ---
          if (e.health && typeof e.health.currentHealth === 'number') {
              const { currentHealth: cur, maxHealth: max } = e.health;
              const ratio = Math.max(0, Math.min(cur / max, 1));
              const barW = 0.8, barH = 0.1;
              const barX = tx + 0.1;
              let barY   = ty - 0.6;
              if (e.type === 'player') barY -= 0.1;

              entityCtx.lineWidth   = 0.02;
              entityCtx.strokeStyle = '#000';
              entityCtx.strokeRect(barX, barY, barW, barH);

              entityCtx.fillStyle = '#444';
              entityCtx.fillRect(barX, barY, barW, barH);

              entityCtx.fillStyle = 'red';
              entityCtx.fillRect(barX, barY, barW * ratio, barH);

              entityCtx.font         = `0.35px monospace`;
              entityCtx.textAlign    = 'center';
              entityCtx.textBaseline = 'bottom';
              entityCtx.fillStyle    = '#fff';
              entityCtx.fillText(`${cur}/${max}`, tx + 0.5, barY - 0.01);
          }
      }

      // =============== 2) Local player pinned to the centre ===============
      if (playerId && entities[playerId]) {
          const p = entities[playerId];

          // tile-space centre of the current camera window
          const halfW = Math.floor(cam.w / 2);
          const halfH = Math.floor(cam.h / 2);

          // screen pixel coordinates of that centre tile
          const screenX = (halfW + 0.5) * TILE;
          const screenY = (halfH + 0.5) * TILE;

          // switch to plain pixel space (no camera, no subX/subY)
          entityCtx.setTransform(1, 0, 0, 1, 0, 0);
          entityCtx.textAlign    = 'center';
          entityCtx.textBaseline = 'middle';

          // --- player sprite / char ---
          if (atlasReady) {
              let sprite;
              for (const rule of spriteRules) {
                  const r = rule({ base: p.char, top: p.top }, p.x, p.y);
                  if (r) { sprite = r; break; }
              }
              if (Array.isArray(sprite)) {
                  const [sx, sy] = sprite;
                  entityCtx.drawImage(
                      atlas,
                      sx * S, sy * S, S, S,
                      screenX - TILE / 2, screenY - TILE / 2,
                      TILE, TILE
                  );
              } else {
                  entityCtx.font      = `${0.8 * TILE}px monospace`;
                  entityCtx.fillStyle = p.color;
                  entityCtx.fillText(p.char, screenX, screenY);
              }
          } else {
              entityCtx.font      = `${0.8 * TILE}px monospace`;
              entityCtx.fillStyle = p.color;
              entityCtx.fillText(p.char, screenX, screenY);
          }

          // --- HP bar for the player ---
          if (p.health && typeof p.health.currentHealth === 'number') {
              const { currentHealth: cur, maxHealth: max } = p.health;
              const ratio = Math.max(0, Math.min(cur / max, 1));

              const barW = TILE * 0.8;
              const barH = TILE * 0.1;
              const barX = screenX - barW / 2;
              let   barY = screenY - TILE * 0.6;

              entityCtx.lineWidth   = 2;
              entityCtx.strokeStyle = '#000';
              entityCtx.strokeRect(barX, barY, barW, barH);

              entityCtx.fillStyle = '#444';
              entityCtx.fillRect(barX, barY, barW, barH);

              entityCtx.fillStyle = 'green';
              entityCtx.fillRect(barX, barY, barW * ratio, barH);

              entityCtx.font         = `${TILE * 0.35}px monospace`;
              entityCtx.textAlign    = 'center';
              entityCtx.textBaseline = 'bottom';
              entityCtx.fillStyle    = '#fff';
              entityCtx.fillText(`${cur}/${max}`, screenX, barY - 2);
          }
      }
  }








const chunkHeight = 32
const chunkWidth = 32
function drawFog() {
    if (!map || !fovMask || !lightMask) return; 
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


let highlightPos = null;


  function renderLoop(ts) {
      if (!lastFrameTime) lastFrameTime = ts;
      const dt = (ts - lastFrameTime) / 1000;
      lastFrameTime = ts;


      // 1) tile-based camera follows player
      updateCameraFromPlayer();

      // 2) sub-tile offset comes from bitOffsetX/bitOffsetY
      updateBitCameraOffset();


      drawEntities();
      drawFog();
      drawOverlay();

      requestAnimationFrame(renderLoop);
  }

  function updateBitCameraOffset() {
      cam.subX = 0;
      cam.subY = 0;

      if (!entities || !currentplayer) return;
      const p = entities[currentplayer];
      if (!p) return;

      // We just added these on the server
      if (typeof p.bitOffsetX === 'number') {
          cam.subX = p.bitOffsetX;              // 0..1 tile
          cam.subY = p.bitOffsetY || 0;        // usually 0 unless you move vertically by bits
      }
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

  // Server expects a direction string (up/down/left/right)
  const p = entities?.[currentplayer];
  if (!p || !hoverTile) return;
  const dx = hoverTile.x - p.x;
  const dy = hoverTile.y - p.y;
  let dir = null;
  if (dx === 0 && dy === -1) dir = 'up';
  else if (dx === 0 && dy === 1) dir = 'down';
  else if (dx === -1 && dy === 0) dir = 'left';
  else if (dx === 1 && dy === 0) dir = 'right';
  if (!dir) return;
  socket.emit('attack', { dir });
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
  if (!readyToAttack.state) { hoverTile=null; hoverText=''; return; }
  if (!entities || !currentplayer || !entities[currentplayer]) { hoverTile=null; hoverText=''; return; }

  const { tileX, tileY } = screenToTile(e);
  if (tileX < cam.x || tileX >= cam.x + cam.w || tileY < cam.y || tileY >= cam.y + cam.h) {
    hoverTile=null; hoverText=''; return;
  }

  const px = entities[currentplayer].x;
  const py = entities[currentplayer].y;
  if (Math.abs(tileX - px) + Math.abs(tileY - py) === 1) {
    hoverTile = { x: tileX, y: tileY };
    hoverText = (readyToAttack?.item?.name) || 'Fist';
  } else {
    hoverTile=null; hoverText='';
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
  highlightCanvas.width  = mapCanvas.width;
  highlightCanvas.height = mapCanvas.height;
  highlightCanvas.style.width  = mapCanvas.style.width;
  highlightCanvas.style.height = mapCanvas.style.height;
}



document.addEventListener('keydown', e => {
  if (e.key.toLowerCase()==='m') {
    cam.full = !cam.full;
    resetCamera();
    resizeOverlay();
    drawBaseMap();
  } else if (e.code === 'Space'){
    socket.emit('move', { dx: 0, dy: 0 });
    socket.emit('commit', {});
  }
});
  // Movement handling
  const dirMap = {
      ArrowUp:    { dir: 'up',    dx:  0, dy: -1 },
      ArrowDown:  { dir: 'down',  dx:  0, dy:  1 },
      ArrowLeft:  { dir: 'left',  dx: -1, dy:  0 },
      ArrowRight: { dir: 'right', dx:  1, dy:  0 },
  };

  const pressedMoveKeys   = new Set();   // e.key values of currently held arrow keys
  let   lastDirPressed    = null;        // 'up' | 'down' | 'left' | 'right'
  let   moveLoopId        = null;
  const MOVE_INTERVAL_MS  = 120;         // tweak: smaller = faster repeat

  function computeHeldVector() {
      let dx = 0, dy = 0;
      for (const key of pressedMoveKeys) {
          const info = dirMap[key];
          if (!info) continue;
          dx += info.dx;
          dy += info.dy;
      }
      return { dx, dy };
  }

  function doMovementStep() {
      const pUid = currentplayer;
      if (!pUid) return;

      const { dx, dy } = computeHeldVector();
      if (!dx && !dy) return; // either nothing pressed or cancel (e.g. left+right)

      const dir = lastDirPressed || 'down';

      socket.emit('move', { dx, dy });
      socket.emit('turn', { dir });
      socket.emit('commit', {});
      messageSend();
  }

  function startMoveLoop() {
      if (moveLoopId != null) return;
      moveLoopId = setInterval(() => {
          if (!pressedMoveKeys.size) {
              stopMoveLoop();
              return;
          }
          doMovementStep();
      }, MOVE_INTERVAL_MS);
  }

  function stopMoveLoop() {
      if (moveLoopId == null) return;
      clearInterval(moveLoopId);
      moveLoopId = null;
  }
  // Continuous movement with multiple keys
  document.addEventListener('keydown', e => {
      const info = dirMap[e.key];
      if (!info) return;           // not one of the arrow keys
      if (!currentplayer) return;
      if (e.repeat) {
          // OS key repeat — we handle our own repeat, so ignore
          e.preventDefault();
          return;
      }

      pressedMoveKeys.add(e.key);
      lastDirPressed = info.dir;

      // Immediate step so it feels responsive
      doMovementStep();
      startMoveLoop();

      // Stop page scrolling on arrow keys
      e.preventDefault();
  });

  document.addEventListener('keyup', e => {
      if (!dirMap[e.key]) return;

      pressedMoveKeys.delete(e.key);

      if (!pressedMoveKeys.size) {
          stopMoveLoop();
      }
  });

let loopStarted = false;

socket.on('mapData', data => {
  map       = data.map.map;
  seen      = data.map.seen;
  fovMask   = data.map.fovMask;
  // Ktor server doesn't always include lightMask in mapData; we can derive it later from your player entity
  lightMask = data.map.lightMask || data.map.fovMask || lightMask;

  resetCamera();
resizeOverlay();
  drawBaseMap();

  if (!loopStarted) {
    loopStarted = true;
    requestAnimationFrame(renderLoop);
  }
});

 // dynamic updates come in via entityData _and_ mapNEntityData
socket.on('entityData', data => {
  entities = normalizeEntities(data.list);
  // pull lightMask/fovMask from your own entity if provided
  if (currentplayer && entities?.[currentplayer]) {
    const me = entities[currentplayer];
    if (me.lightMask) lightMask = me.lightMask;
    if (me.fovMask)   fovMask   = me.fovMask;
  }
  updateBitCameraOffset();
  updateSelectedItem();
  drawHotbar();
});
  function updateCameraFromPlayer() {
      if (!map || !entities || !currentplayer || !entities[currentplayer]) return;

      const rows = map.length;
      const cols = map[0]?.length || 0;
      const p    = entities[currentplayer];
      if (!p) return;

      // only integer tile coords – NO smoothing here
      const px = p.x;
      const py = p.y;

      const halfW = Math.floor(cam.w / 2);
      const halfH = Math.floor(cam.h / 2);

      let targetX = px - halfW;
      let targetY = py - halfH;

      // clamp so we don’t scroll past the edges of the 32x32 view
      targetX = Math.max(0, Math.min(targetX, cols - cam.w));
      targetY = Math.max(0, Math.min(targetY, rows - cam.h));

      cam.x = targetX;
      cam.y = targetY;
  }


    socket.on('clientPlayer', data => { 
currentplayer = data
//setInterval(checkTps, 1000);
})
  socket.on('tpsupdate', () => {
      messageReceived()
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

      // entities in FOV (small projected objects, no visibleMap/seen/FOV stuff here)
      entities = normalizeEntities(data.list);

      // map/FOV data comes from data.map.*
      map       = data.map.map;
      seen      = data.map.seen;
      fovMask   = data.map.fovMask;
      if (data.map.lightMask) {
          lightMask = data.map.lightMask;
      }

      updateBitCameraOffset();
      resetCamera();
      drawBaseMap();

      if (!loopStarted) {
          loopStarted = true;
          requestAnimationFrame(renderLoop);
      }
  });

window.addEventListener('resize', () => {
  if (!map) return;
  onResizeOrReset();
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

      const fx = mx / TILE;
      const fy = my / TILE;

      const tileX = Math.floor(cam.x + cam.subX + fx);
      const tileY = Math.floor(cam.y + cam.subY + fy);

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
    // HP
    if (cur.health && typeof cur.health.currentHealth === 'number') {
      html += `<div><b>HP:</b> ${cur.health.currentHealth} / ${cur.health.maxHealth}</div>`;
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
  if (!entities || !currentplayer || !entities[currentplayer]) return;

  const player  = entities[currentplayer];
  const HOTBARS = player?.slots?.hotbar ?? 0;
  if (!HOTBARS) return;

  const inv    = player.inventory || [];
  const hotbar = inv.filter(i => i.slot === 'hotbar');

  // make sure the canvas has a non-zero buffer
  resizeHotbar();

  hotbarCtx.resetTransform();
  hotbarCtx.clearRect(0,0,hotbarCanvas.width,hotbarCanvas.height);

  const W = hotbarCanvas.width, H = hotbarCanvas.height;
  if (!W || !H) return;

  const slotH = H / HOTBARS;

  for (let i = 0; i < HOTBARS; i++) {
    const y = i * slotH;

    hotbarCtx.strokeStyle = (i === selectedHotbarSlot) ? 'yellow' : '#FFF';
    hotbarCtx.lineWidth   = (i === selectedHotbarSlot) ? 4 : 2;
    hotbarCtx.strokeRect(0, y, W, slotH);

    const item = hotbar[i];
    if (!item) continue;

    const cx = W/2, cy = y + slotH/2;

    if (item.char) {
      hotbarCtx.font = `${Math.floor(slotH*0.6)}px monospace`;
      hotbarCtx.fillStyle = '#FFF';
      hotbarCtx.textAlign = 'center';
      hotbarCtx.textBaseline = 'middle';
      hotbarCtx.fillText(item.char, cx, cy - slotH*0.1);
    }

    hotbarCtx.font = `${Math.floor(slotH*0.25)}px sans-serif`;
    hotbarCtx.textAlign = 'center';
    hotbarCtx.textBaseline = 'top';
    hotbarCtx.fillText(item.name||'', cx, cy + slotH*0.1);

    if (item.quantity != null) {
      hotbarCtx.font = `${Math.floor(slotH*0.25)}px monospace`;
      hotbarCtx.textAlign = 'right';
      hotbarCtx.textBaseline = 'bottom';
      hotbarCtx.fillText(item.quantity, W - slotH*0.1, y + slotH - slotH*0.1);
    }
  }
}

// Global state:
let selectedHotbarSlot = 0;    // index 0…HOTBARS–1
let selectedHotbarItem = null; // the actual item object

function updateSelectedItem() {
  if (!entities || !currentplayer || !entities[currentplayer]) {
    selectedHotbarItem = null;
    return;
  }
  const hotbar = (entities[currentplayer].inventory || []).filter(i => i.slot==='hotbar');
  selectedHotbarItem = hotbar[selectedHotbarSlot] || null;
}


document.addEventListener('keydown', e => {
  const n = parseInt(e.key, 10);
  const HOTBARS = entities?.[currentplayer]?.slots?.hotbar || 0;
  if (!isNaN(n) && n >= 1 && n <= HOTBARS) {
    selectedHotbarSlot = n - 1;
    updateSelectedItem();
    drawHotbar();
  }
});

hotbarCanvas.addEventListener('click', e => {
  const HOTBARS = entities?.[currentplayer]?.slots?.hotbar || 0;
  if (!HOTBARS) return;
  const rect = hotbarCanvas.getBoundingClientRect();
  const my   = e.clientY - rect.top;
  const slotH  = hotbarCanvas.height / HOTBARS;
  const i = Math.floor(my / slotH);
  if (i >= 0 && i < HOTBARS) {
    selectedHotbarSlot = i;
    updateSelectedItem();
    drawHotbar();
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