// src/constants.js
const DIR_VECTORS = {
  up:    [ 0, -1],
  right: [ 1,  0],
  down:  [ 0,  1],
  left:  [-1,  0],
};

const HALF_CONE_RAD  = Math.PI / 4; // 45°
const COS_HALF_CONE  = Math.cos(HALF_CONE_RAD);

const deltas4 = [
  { dx:  1, dy:  0 },
  { dx: -1, dy:  0 },
  { dx:  0, dy:  1 },
  { dx:  0, dy: -1 },
];

module.exports = { DIR_VECTORS, HALF_CONE_RAD, COS_HALF_CONE, deltas4 };
