// server.js
const path    = require('path');
const express = require('express');
const http    = require('http');
const { Server } = require('socket.io');

const { state } = require('./src/state');
const { getChunkByMapId } = require('./src/maps');
const { generateMapContentsCircularForChunk } = require('./src/worldgen');
const { ChunkgenPicker } = require('./src/worldgen');
const { wireSockets } = require('./src/sockets');
const storage = require('./storage'); // your existing module

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*', methods: ['GET','POST'] } });

// serve static client
app.use(express.static(path.join(__dirname, 'public')));

// --- bootstrap / rehydrate ---
(async () => {
  // maps container baseline
  state.maps['overworld'] = state.maps['overworld'] || { map: { chunks: [] }, type: 'overworld', time: 0 };

  // load time meta
  const meta = storage.loadMapMetaSync('overworld') || {};
  state.maps['overworld'].time = meta.time || 0;

  // load persisted entities
  for (const [uid, ent] of storage.loadAllEntitiesSync()) {
    state.entities[uid] = ent;
    (state.typeIndex[ent.type] ||= []).push(uid);
  }

  // ensure overworld 0,0 chunk exists
  const c00 = getChunkByMapId('overworld', 0, 0, /*stateful gen*/ true);
  // populate (or refresh) contents
  generateMapContentsCircularForChunk('overworld', 0, 0, ChunkgenPicker('overworld'));
  storage.queueSaveChunk('overworld', 0, 0, c00.data);

  // sockets (after state is ready)
  wireSockets(io);

  server.listen(8000, '0.0.0.0', () => {
    console.log('▶ listening on http://localhost:8000');
  });
})();
