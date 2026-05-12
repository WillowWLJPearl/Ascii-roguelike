// cellStorage.js
// Compression helpers for chunk cell grids

function cellKey(cell) {
    // Decide what makes two cells "the same template"
    // You can drop meta or parts of it if you want them to count as deviations
    return JSON.stringify({
        base:  cell.base,
        top:   cell.top,
        bl:    cell.bl,
        br:    cell.br,
        color: cell.color,
        name:  cell.name,
        meta:  cell.meta || {}
    });
}

// data: 2D array of full cell objects (current format)
// returns an object that’s smaller & uses references
function compressCellGrid(data) {
    const templates = [];
    const keyToId   = new Map();

    const grid = data.map(row =>
        row.map(cell => {
            if (!cell || typeof cell !== 'object') {
                // Just inline anything weird (shouldn’t really happen)
                return { inline: cell };
            }

            const key = cellKey(cell);
            let id = keyToId.get(key);
            if (id === undefined) {
                id = templates.length;
                // Keep the template exactly as-is so you don't lose info
                templates.push(cell);
                keyToId.set(key, id);
            }
            // Base case: pure reference, no overrides
            return { ref: id };
        })
    );

    return { templates, grid };
}

// obj: whatever was read from disk for a chunk
// returns 2D array of full cell objects in RAM
function decompressCellGrid(obj) {
    // Legacy case: old chunk files that just have data: [][]
    if (Array.isArray(obj)) return obj;
    if (Array.isArray(obj.data)) return obj.data;

    const { templates, grid } = obj;
    if (!templates || !grid) {
        throw new Error('Invalid chunk format: missing templates/grid');
    }

    return grid.map(row =>
        row.map(entry => {
            if (!entry) return null;
            if (entry.inline !== undefined) return entry.inline;
            const tpl = templates[entry.ref];
            if (!tpl) return null;
            // cheap deep clone, enough for game cells
            return JSON.parse(JSON.stringify(tpl));
        })
    );
}

module.exports = { compressCellGrid, decompressCellGrid };
