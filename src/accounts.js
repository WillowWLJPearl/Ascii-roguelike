// src/accounts.js
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, '..', 'data', 'accounts');
const INDEX_FILE = path.join(DATA_DIR, 'user_index.json');

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(INDEX_FILE)) fs.writeFileSync(INDEX_FILE, JSON.stringify({}), 'utf8');
}

function readIndex() {
  ensureDir();
  return JSON.parse(fs.readFileSync(INDEX_FILE, 'utf8') || '{}');
}
function writeIndex(idx) {
  fs.writeFileSync(INDEX_FILE, JSON.stringify(idx, null, 2), 'utf8');
}

function accountPath(id) {
  return path.join(DATA_DIR, `${id}.json`);
}

function saveAccount(acc) {
  ensureDir();
  fs.writeFileSync(accountPath(acc.id), JSON.stringify(acc, null, 2), 'utf8');
}

function loadAccountById(id) {
  ensureDir();
  const p = accountPath(id);
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function getAccountByUsername(username) {
  const idx = readIndex();
  const id = idx[username.toLowerCase()];
  return id ? loadAccountById(id) : null;
}

function getAccountById(id) {
  return loadAccountById(id);
}

// password hashing (no deps)
function hashPassword(password, salt) {
  const key = crypto.scryptSync(password, salt, 64);
  return key.toString('hex');
}

function createAccount(username, password) {
  ensureDir();
  const uname = String(username || '').trim();
  if (!uname) throw new Error('username required');
  const idx = readIndex();
  if (idx[uname.toLowerCase()]) throw new Error('username already exists');

  const id = crypto.randomUUID();
  const salt = crypto.randomBytes(16).toString('hex');
  const passHash = hashPassword(password, salt);

  const acc = {
    id,
    username: uname,
    passHash,
    salt,
    entityUid: null,
    createdAt: Date.now(),
    lastLoginAt: null
  };
  idx[uname.toLowerCase()] = id;
  writeIndex(idx);
  saveAccount(acc);
  return acc;
}

function authenticate(username, password) {
  const acc = getAccountByUsername(username);
  if (!acc) return null;
  const check = hashPassword(password, acc.salt);
  // timing-safe compare
  const a = Buffer.from(acc.passHash, 'hex');
  const b = Buffer.from(check, 'hex');
  if (a.length !== b.length) return null;
  if (!crypto.timingSafeEqual(a, b)) return null;
  acc.lastLoginAt = Date.now();
  saveAccount(acc);
  return acc;
}

function linkEntityToAccount(accountId, entityUid) {
  const acc = getAccountById(accountId);
  if (!acc) throw new Error('account not found');
  acc.entityUid = entityUid;
  saveAccount(acc);
  return acc;
}

module.exports = {
  createAccount,
  authenticate,
  getAccountByUsername,
  getAccountById,
  linkEntityToAccount,
};
