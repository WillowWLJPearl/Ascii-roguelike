// src/entityFactory.js
const { state } = require('./state');
const storage   = require('../storage');
const { ENT_TEMPLATES } = require('./templates/entities');
const { resolveTemplate, deepClone, deepDiff, applyDiff } = require('./template');

function nextUid(type) {
    return `${type}-${state.nextEntityUID++}`;
}

function allocVision(e, pos) {
    const H = state.chunkHeight, W = state.chunkWidth;
    const blankCell = { base:'', top:[], bl:[], br:[], color:'#111', name:'Darkness', meta:{} };

    e.visibleMap = Array.from({ length: H }, () => Array(W).fill().map(() => ({...blankCell})));
    e.fovMask    = Array.from({ length: H }, () => Array(W).fill(false));
    e.lightMask  = Array.from({ length: H }, () => Array(W).fill(false));

    const seen = Array.from({ length: H }, () => Array(W).fill(false));
    e.seen = { [pos.map]: { map: { chunks: [ { x: pos.cx, y: pos.cy, data: seen } ] } } };
}

function materializeFromTemplate(tplId, overrides, pos) {
    const tpl = resolveTemplate(ENT_TEMPLATES, tplId);

    // Build the prototype payload (no functions in delta!)
    const proto = {
        type: tpl.type || 'entity',
        name: tpl.name || tpl.type || tplId,
        char: tpl.char || '?',
        color: tpl.color || '#fff',
        overlays: tpl.overlays || { top:[], bl:[], br:[] },
        inventory: tpl.inventory || [],
        traits: tpl.traits || [],
        slots: tpl.slots || { hotbar: 0 },
        FOV_RADIUS: (typeof tpl.FOV_RADIUS === 'number') ? tpl.FOV_RADIUS : 6,
        behaviors: {}, // not used; functions inline
        meta: tpl.meta || {}
    };

    const cur = applyDiff(proto, overrides || {});
    const uid = nextUid(cur.type);
    const e = {
        uid,
        ...cur,
        map: pos.map, cx: pos.cx, cy: pos.cy, x: pos.x, y: pos.y,
        dir: 'down',
        health: cur.health || { maxHealth: 2, currentHealth: 2 },
        stamina: cur.stamina || { maxStamina: 5, currentStamina: 5 },

        // runtime-only function refs (not saved)
        _tick: typeof tpl.tick === 'function' ? tpl.tick : null,
        _spawn: typeof tpl.spawn === 'function' ? tpl.spawn : null,

        templateRef: { id: tplId, diff: overrides || undefined }
    };

    allocVision(e, pos);
    return e;
}

function spawnFromTemplate(tplId, pos, overrides = {}, persist = true) {
    const e = materializeFromTemplate(tplId, overrides, pos);
    state.entities[e.uid] = e;
    (state.typeIndex[e.type] ||= []).push(e.uid);

    if (persist) storage.queueSaveEntity(e.uid, serializeEntity(e));
    return e.uid;
}

function serializeEntity(e) {
    return {
        uid: e.uid,
        templateRef: e.templateRef, // { id, diff }
        type: e.type,
        map: e.map, cx: e.cx, cy: e.cy, x: e.x, y: e.y,
        dir: e.dir,
        health: e.health,
        stamina: e.stamina,
        inventory: e.inventory,
        traits: e.traits,
        slots: e.slots,
        meta: e.meta
    };
}

function hydrateEntityFromSave(saveObj) {
    if (!saveObj?.templateRef?.id) throw new Error('Bad save: missing templateRef.id');
    const pos = { map: saveObj.map, cx: saveObj.cx, cy: saveObj.cy, x: saveObj.x, y: saveObj.y };
    const e = materializeFromTemplate(saveObj.templateRef.id, saveObj.templateRef.diff || {}, pos);

    // overlay runtime things that changed
    e.uid       = saveObj.uid || e.uid;
    e.dir       = saveObj.dir ?? e.dir;
    e.health    = saveObj.health    || e.health;
    e.stamina   = saveObj.stamina   || e.stamina;
    e.inventory = saveObj.inventory || e.inventory;
    e.traits    = saveObj.traits    || e.traits;
    e.slots     = saveObj.slots     || e.slots;
    e.meta      = saveObj.meta      || e.meta;

    state.entities[e.uid] = e;
    (state.typeIndex[e.type] ||= []).push(e.uid);
    return e.uid;
}

// Call this after you mutate an entity’s properties to refresh its diff.
function recomputeEntityDelta(uid) {
    const e = state.entities[uid];
    if (!e?.templateRef?.id) return;
    const tpl = resolveTemplate(ENT_TEMPLATES, e.templateRef.id);
    const proto = {
        type: e.type, name: e.name, char: e.char, color: e.color,
        overlays: e.overlays, inventory: e.inventory, traits: e.traits,
        slots: e.slots, FOV_RADIUS: e.FOV_RADIUS, meta: e.meta
    };
    const base = {
        type: tpl.type || 'entity',
        name: tpl.name || tpl.type || e.templateRef.id,
        char: tpl.char || '?',
        color: tpl.color || '#fff',
        overlays: tpl.overlays || { top:[], bl:[], br:[] },
        inventory: tpl.inventory || [],
        traits: tpl.traits || [],
        slots: tpl.slots || { hotbar: 0 },
        FOV_RADIUS: (typeof tpl.FOV_RADIUS === 'number') ? tpl.FOV_RADIUS : 6,
        meta: tpl.meta || {}
    };
    const diff = deepDiff(base, proto) || undefined;
    e.templateRef.diff = diff;
}

module.exports = { spawnFromTemplate, hydrateEntityFromSave, serializeEntity, recomputeEntityDelta };
