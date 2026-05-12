// src/entityFactory.js
const { state } = require('./state');
const storage   = require('../storage');
const { ENT_TEMPLATES } = require('./templates/entities');
const { resolveTemplate, deepClone, deepDiff, applyDiff } = require('./template');

function nextUid(type) {
    return `${type}-${state.nextEntityUID++}`;
}
const RUNTIME_ONLY_KEYS = new Set([
    'uid',
    'map', 'cx', 'cy', 'x', 'y', 'dir',
    'visibleMap', 'fovMask', 'lightMask', 'seen',
    '_tick', '_spawn',
    'templateRef',
]);

function buildTemplateBase(tplId) {
    const tplResolved = resolveTemplate(ENT_TEMPLATES, tplId);
    const base = {};

    for (const [k, v] of Object.entries(tplResolved)) {
        if (k === 'extends' || k === 'tick' || k === 'spawn') continue;
        base[k] = deepClone(v);
    }

    return { tplResolved, base };
}

function snapshotPersistent(e) {
    const out = {};
    for (const [k, v] of Object.entries(e)) {
        if (RUNTIME_ONLY_KEYS.has(k)) continue;
        out[k] = v;
    }
    return out;
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
    const { tplResolved, base } = buildTemplateBase(tplId);

    // apply template diff / overrides onto the base
    const cur = applyDiff(base, overrides || {});

    const uid = nextUid(cur.type || tplResolved.type || 'entity');

    const e = {
        uid,

        // all template-derived / diff-derived props (dynamic)
        ...cur,

        // fixed runtime positioning
        map: pos.map, cx: pos.cx, cy: pos.cy, x: pos.x, y: pos.y,
        dir: 'down',

        // ensure some defaults if template/diff didn’t define them
        health:  cur.health  || { maxHealth: 2, currentHealth: 2 },
        stamina: cur.stamina || { maxStamina: 5, currentStamina: 5 },

        // runtime-only function refs (never saved)
        _tick:  typeof tplResolved.tick  === 'function' ? tplResolved.tick  : null,
        _spawn: typeof tplResolved.spawn === 'function' ? tplResolved.spawn : null,

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
        templateRef: e.templateRef,   // { id, diff }

        // minimal runtime info we always persist
        map: e.map, cx: e.cx, cy: e.cy, x: e.x, y: e.y,
        dir: e.dir,

        // dynamic snapshot of *all* persistent fields
        props: snapshotPersistent(e),
    };
}


function hydrateEntityFromSave(saveObj) {
    if (!saveObj?.templateRef?.id) {
        throw new Error('Bad save: missing templateRef.id');
    }

    const tplId = saveObj.templateRef.id;
    const { tplResolved, base } = buildTemplateBase(tplId);

    const pos = {
        map: saveObj.map,
        cx:  saveObj.cx,
        cy:  saveObj.cy,
        x:   saveObj.x,
        y:   saveObj.y,
    };

    // 1) template base → 2) template diff → 3) saved props
    const fromTemplate = applyDiff(base, saveObj.templateRef.diff || {});
    const mergedProps  = { ...fromTemplate, ...(saveObj.props || {}) };

    const uid = saveObj.uid || nextUid(mergedProps.type || tplId);

    const e = {
        uid,

        // all persistent props from template + save (dynamic)
        ...mergedProps,

        // runtime placement
        map: pos.map, cx: pos.cx, cy: pos.cy, x: pos.x, y: pos.y,
        dir: saveObj.dir ?? 'down',

        // runtime-only function refs
        _tick:  typeof tplResolved.tick  === 'function' ? tplResolved.tick  : null,
        _spawn: typeof tplResolved.spawn === 'function' ? tplResolved.spawn : null,

        templateRef: {
            id:   tplId,
            diff: saveObj.templateRef.diff || undefined,
        },
    };

    allocVision(e, pos);
    state.entities[e.uid] = e;
    (state.typeIndex[e.type] ||= []).push(e.uid);

    return e.uid;
}

function snapshotPersistent(e) {
    const out = {};
    for (const [k, v] of Object.entries(e)) {
        // fields that should NOT go into template diff
        if (k === 'uid'        ||
            k === 'map'        || k === 'cx' || k === 'cy' ||
            k === 'x'          || k === 'y'  || k === 'dir' ||
            k === 'visibleMap' || k === 'fovMask' ||
            k === 'lightMask'  || k === 'seen' ||
            k === '_tick'      || k === '_spawn' ||
            k === 'templateRef') {
            continue;
        }
        out[k] = v;
    }
    return out;
}

// Call this after you mutate an entity’s properties to refresh its diff.
function recomputeEntityDelta(uid) {
    const e = state.entities[uid];
    if (!e?.templateRef?.id) return;

    const tplId = e.templateRef.id;
    const { base } = buildTemplateBase(tplId);

    // what the entity *currently* looks like, ignoring runtime-only fields
    const proto = snapshotPersistent(e);

    const diff = deepDiff(base, proto) || undefined;
    e.templateRef.diff = diff;
}



module.exports = { spawnFromTemplate, hydrateEntityFromSave, serializeEntity, recomputeEntityDelta };
