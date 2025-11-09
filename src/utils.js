// src/utils.js
const { state } = require('./state');

function VisibleMapBase(width = state.chunkWidth, height = state.chunkHeight) {
  const visibleMap = [];
  for (let y = 0; y < height; y++) {
    const row = [];
    for (let x = 0; x < width; x++) {
      row.push({
        base:  '',
        top: [], bl: [], br: [],
        color: '#111',
        name:  'Darkness',
        meta: {}
      });
    }
    visibleMap.push(row);
  }
  return visibleMap;
}

function shiftMask(mask, dx, dy) {
  const H = mask.length;
  const W = mask[0].length;
  const out = Array.from({length: H}, () => Array(W).fill(false));
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const srcY = y + dy, srcX = x + dx;
    if (srcY >= 0 && srcY < H && srcX >= 0 && srcX < W) {
      out[y][x] = mask[srcY][srcX];
    }
  }
  return out;
}

function uniqueDicts(arr) {
  const seen = new Set();
  return arr.filter(obj => {
    const key = JSON.stringify(obj);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

module.exports = { VisibleMapBase, shiftMask, uniqueDicts };
