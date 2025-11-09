// src/template.js
function deepClone(x) {
    if (Array.isArray(x)) return x.map(deepClone);
    if (x && typeof x === 'object') {
        const o = {};
        for (const k in x) o[k] = deepClone(x[k]);
        return o;
    }
    return x;
}

// arrays are REPLACED by child; objects are merged
function deepMerge(base, over) {
    if (Array.isArray(base) && Array.isArray(over)) return deepClone(over);
    if (base && typeof base === 'object' && over && typeof over === 'object') {
        const out = { ...base };
        for (const k of Object.keys(over)) {
            out[k] = (k in base) ? deepMerge(base[k], over[k]) : deepClone(over[k]);
        }
        return out;
    }
    return deepClone(over);
}

function deepDiff(base, cur) {
    if (typeof base !== 'object' || base === null ||
        typeof cur  !== 'object' || cur  === null) {
        return (base === cur) ? undefined : deepClone(cur);
    }
    if (Array.isArray(base) || Array.isArray(cur)) {
        return JSON.stringify(base) === JSON.stringify(cur) ? undefined : deepClone(cur);
    }
    const out = {};
    let any = false;
    const keys = new Set([...Object.keys(base || {}), ...Object.keys(cur || {})]);
    for (const k of keys) {
        const d = deepDiff(base ? base[k] : undefined, cur ? cur[k] : undefined);
        if (d !== undefined) { out[k] = d; any = true; }
    }
    return any ? out : undefined;
}

function applyDiff(base, diff) {
    if (diff === undefined) return deepClone(base);
    if (typeof diff !== 'object' || diff === null) return deepClone(diff);
    if (Array.isArray(diff)) return deepClone(diff);
    const out = deepClone(base);
    for (const k of Object.keys(diff)) {
        out[k] = applyDiff(base ? base[k] : undefined, diff[k]);
    }
    return out;
}

function resolveTemplate(templates, id) {
    if (!templates[id]) throw new Error(`Template not found: ${id}`);
    const chain = [];
    let cur = templates[id];
    const guard = new Set();
    while (cur) {
        if (guard.has(cur)) throw new Error(`Template cycle at ${id}`);
        guard.add(cur);
        chain.push(cur);
        cur = cur.extends ? templates[cur.extends] : null;
    }
    // merge base→child
    let out = {};
    for (let i = chain.length - 1; i >= 0; i--) out = deepMerge(out, chain[i]);
    return out;
}

module.exports = { deepClone, deepMerge, deepDiff, applyDiff, resolveTemplate };
