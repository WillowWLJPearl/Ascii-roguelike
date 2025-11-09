// src/state.js
const state = {
  maps: {},            // mapId -> { map: { chunks: [...] }, type, time }
  entities: {},        // uid -> entity
  typeIndex: {},       // type -> [uids]
  nextEntityUID: 1,

  // world dims
  chunkWidth: 32,
  chunkHeight: 32,

  // blocking rules
  blockBases:    ['#'],
  blockStatuses: ['S'],
  blockTypes:    ['W'],
};

module.exports = { state };
