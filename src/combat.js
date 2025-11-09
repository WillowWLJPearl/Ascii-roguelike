// src/combat.js
const { state } = require('./state');
const { getWorldPosition } = require('./vision');
const { getEntityUUIDsAt } = require('./entities');
const { uniqueDicts } = require('./utils');
const { updateMapNEntityData } = require('./tick'); // lightweight notifier
const { assembleVisibleMaps } = require('./vision');
const { addEntity, setEntityData, getEntityData, getUIDsByType } = require('./entities');

function attackHandler(attackerUid, targetTile, item) {
  let itemUsed = item;
  if (!itemUsed || !itemUsed.slot) {
    itemUsed = { name:'Fist', types:['melee','physical'], range:1, attackSize:1, damage:1, effects:[{id:'self_harm',chance:10}] };
  }
  const attacker = state.entities[attackerUid];
  if (!attacker) return;

  const pos = getWorldPosition(attacker, targetTile.x, targetTile.y);
  damageHandler(
    { mapId: attacker.map, cy: pos.cy, cx: pos.cx, x: pos.x, y: pos.y },
    { type: 'attack', damage: itemUsed.damage, attacker: attackerUid }
  );
}

function damageHandler(target, source) {
  const uuids = getEntityUUIDsAt(target.mapId, target.cx, target.cy, target.x, target.y);
  const notify = [];

  uuids.forEach(euid => {
    const e = state.entities[euid];
    if (!e) return;
    e.health.currentHealth -= source.damage;
    if (e.health.currentHealth <= 0) deathHandler(euid, source);
    playersSeeingEntity(euid).forEach(p => notify.push(p));
  });

  const uniq = uniqueDicts(notify);
  uniq.forEach(uid => updateMapNEntityData(uid, 'lightweight'));
}

function playersSeeingEntity(targetUid) {
  const target = state.entities[targetUid];
  if (!target) return [];
  const W = state.chunkWidth, H = state.chunkHeight;
  const halfW = Math.floor(W/2), halfH = Math.floor(H/2);

  const targetWX = target.cx * W + target.x;
  const targetWY = target.cy * H + target.y;

  const result = [];
  for (const viewerUid of getUIDsByType('player')) {
    const v = state.entities[viewerUid]; if (!v) continue;
    if (v.map !== target.map) continue;

    const viewerWX = v.cx * W + v.x;
    const viewerWY = v.cy * H + v.y;

    const dx = targetWX - viewerWX, dy = targetWY - viewerWY;
    const rx = dx + halfW, ry = dy + halfH;

    if (rx >= 0 && rx < W && ry >= 0 && ry < H) {
      if (v.fovMask[ry]?.[rx] || v.lightMask[ry]?.[rx]) result.push(viewerUid);
    }
  }
  return result;
}

function deathHandler(euid, source) {
  const ent = state.entities[euid];
  if (!ent) return;

  if (ent.type === 'player') {
    // respawn player at nearest 'g' in current chunk 0,0 of overworld
    const overworld0 = state.maps['overworld']?.map?.chunks.find(c => c.x===0 && c.y===0)?.data;
    let spawn = { x: 1, y: 1 };
    if (overworld0) {
      for (let y=0;y<overworld0.length;y++) for (let x=0;x<overworld0[0].length;x++) {
        if (overworld0[y][x].br?.includes('g')) spawn = {x,y};
      }
    }
    const newUid = addEntity('player', spawn.x, spawn.y, '@', '#404', {}, 'UserRandom');
    setEntityData(newUid, 'socketId', getEntityData(euid, 'socketId'));
    // notify client of new local uid
    const io = require('./sockets').ioRef();
    io.to(getEntityData(euid, 'socketId')).emit('clientPlayer', newUid);

    delete state.entities[euid];
    assembleVisibleMaps();
    updateMapNEntityData(newUid, 'lightweight');
  } else if (ent.type === 'chest') {
    const attacker = state.entities[source.attacker];
    if (attacker && Array.isArray(ent.inventory)) {
      ent.inventory.forEach(i => {
        const newItem = { ...i, slot: 'hotbar' };
        attacker.inventory.push(newItem);
      });
    }
    delete state.entities[euid];
    assembleVisibleMaps();
  } else {
    delete state.entities[euid];
    assembleVisibleMaps();
  }

  playersSeeingEntity(euid).forEach(p => updateMapNEntityData(p, 'lightweight'));
}

module.exports = { attackHandler, damageHandler, deathHandler };
