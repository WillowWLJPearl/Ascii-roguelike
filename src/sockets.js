// src/sockets.js
let _ioRef;
function ioRef() { return _ioRef; }

const { state } = require('./state');
const storage = require('../storage');
const {
  addEntity, moveEntity, turnEntity,
  setEntityData, getEntityData,
  entitiesInFovDetailed, getUIDsByType,
  findEntityByAccountId, attachSocket, detachSocket
} = require('./entities');
const { assembleVisibleMaps } = require('./vision');
const { TickManager, updateMapNEntityData } = require('./tick');
const { attackHandler } = require('./combat');
const { trueMappingWithSeenMapping, getChunkByMapId } = require('./maps');

const { createAccount, authenticate, linkEntityToAccount, getAccountById } = require('./accounts');

const buffers = new Map();
function sendOnlyTo(sockId, channel, payload) {
  if (!sockId) return;
  _ioRef.to(sockId).emit(channel, payload);
}

// spawn logic reused by both first-time and returning users
function spawnOrReuseEntityForAccount(account, socket) {
  // kick prior session if any
  if (account.entityUid) {
    const existing = state.entities[account.entityUid];
    if (existing) {
      // disconnect old socket if still online
      const oldSockId = existing.meta?.socketId;
      if (oldSockId && _ioRef.sockets?.sockets?.get(oldSockId)) {
        _ioRef.sockets.sockets.get(oldSockId).disconnect(true);
      }
      attachSocket(account.entityUid, socket.id);
      // make sure it's persisted
      storage.queueSaveEntity(account.entityUid, state.entities[account.entityUid]);
      return account.entityUid;
    }
  }


  // else create a new one and link
  const baseChunk = getChunkByMapId('overworld', 0, 0, true).data;
  let spawn = { x: 1, y: 1 };
  for (let y=0; y<baseChunk.length; y++) {
    for (let x=0; x<baseChunk[0].length; x++) {
      if (baseChunk[y][x].br?.includes('g')) spawn = { x, y };
    }
  }

  const newUid = addEntity('player', spawn.x, spawn.y, '@', '#404', {}, account.username);
  setEntityData(newUid, 'accountId', account.id);
  setEntityData(newUid, 'socketId', socket.id);
  attachSocket(newUid, socket.id);

  linkEntityToAccount(account.id, newUid);
  storage.queueSaveEntity(newUid, state.entities[newUid]);
  return newUid;
}
function getSocketsOnMap(mapId) {
  return Object.values(state.entities)
    .filter(e => e.type === 'player' && e.map === mapId && e.meta?.socketId)
    .map(e => e.meta.socketId);
}
function requireAuthed(socket) {
  if (!socket.data?.accountId) {
    socket.emit('error', { message: 'Not authenticated' });
    return false;
  }
  return true;
}

function wireSockets(io) {
  _ioRef = io;

  io.on('connection', socket => {
    console.log('➕ client connected:', socket.id);

    // 1) AUTH HANDSHAKE
    socket.on('auth', async ({ mode, username, password }) => {
      try {
        let acc;
        if (mode === 'register') {
          acc = createAccount(username, password);
        } else {
          acc = authenticate(username, password);
          if (!acc) return socket.emit('auth:error', { message: 'Invalid credentials' });
        }
        socket.data.accountId = acc.id;

        // attach or create/relink entity
        const uid = spawnOrReuseEntityForAccount(acc, socket);

        // refresh visible maps and send initial payload
        assembleVisibleMaps();

        const player = state.entities[uid];
        sendOnlyTo(socket.id, 'clientPlayer', uid);
        sendOnlyTo(socket.id, 'mapData', {
          map: {
            seen: player.seen[player.map],
            trueMapping: trueMappingWithSeenMapping(player.seen, state.maps, player.map),
            fovMask: player.fovMask,
            map: player.visibleMap
          },
          width: state.chunkWidth,
          height: state.chunkHeight
        });
        sendOnlyTo(socket.id, "entityData", { list: entitiesInFovDetailed(uid), changed: uid });

        socket.emit('auth:ok', { accountId: acc.id, username: acc.username, entityUid: uid });
      } catch (e) {
        socket.emit('auth:error', { message: e.message || 'Auth failed' });
      }
    });

    // 2) GAME EVENTS (guarded)
    socket.on('changeName', ({ uuid, name }) => {
      if (!requireAuthed(socket)) return;
      if (state.entities[uuid]) state.entities[uuid].name = name;
    });

    socket.on('wait', () => {
      if (!requireAuthed(socket)) return;
      TickManager('overworld');
    });

    socket.on('alldata', () => {
      if (!requireAuthed(socket)) return;
      const uid = getUIDsByType('player').find(u => getEntityData(u, 'socketId') === socket.id);
      const baseMap = getChunkByMapId('overworld', 0, 0, true).data;
      sendOnlyTo(socket.id, 'alldata', { entities: state.entities, map: baseMap, you: uid });
    });

    socket.on('move', data => {
      if (!requireAuthed(socket)) return;
      if (moveEntity(data.currentplayer, data.dx, data.dy)) {
        assembleVisibleMaps();
        let buf = buffers.get(socket.id);
        if (!buf) { buf = { pieces: [] }; buffers.set(socket.id, buf); }
        buf.pieces.push({ ...data, action: 'move' });
      }
    });

    socket.on('turn', data => {
      if (!requireAuthed(socket)) return;
      const e = state.entities[data.currentplayer];
      if (!e) return;
      if (e.dir !== data.dir) {
        turnEntity(data.currentplayer, data.dir);
        assembleVisibleMaps();
        let buf = buffers.get(socket.id);
        if (!buf) { buf = { pieces: [] }; buffers.set(socket.id, buf); }
        buf.pieces.push({ ...data, action: 'turn' });
      }
    });

    socket.on('commitData', () => {
      if (!requireAuthed(socket)) return;
      const buf = buffers.get(socket.id);
      if (buf) {
        for (const piece of buf.pieces) {
          updateMapNEntityData(piece.currentplayer, 'lightweight');
        }
        buffers.delete(socket.id);
      }
    });

    socket.onAny(() => {
        sendOnlyTo(socket.id, 'tpsupdate');
    })

    socket.on('attack', data => {
      if (!requireAuthed(socket)) return;
      attackHandler(data.currentplayer, data.tile, data.item);
    });

    socket.on('disconnect', () => {
      console.log('➖ client left:', socket.id);
      // don’t delete the entity; just detach the socket so it can be reused next time
      const uid = (getUIDsByType('player') || []).find(u => getEntityData(u, 'socketId') === socket.id);
      if (uid) {
        detachSocket(uid);
        setEntityData(uid, 'socketId', null);
        storage.queueSaveEntity(uid, state.entities[uid]);
      }
    });
  });
}

module.exports = { wireSockets, ioRef, sendOnlyTo, getSocketsOnMap };
