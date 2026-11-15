import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from './paths.js';

const FILE = path.join(DATA_DIR, 'apps.json');
const TMP = FILE + '.tmp';

/** @type {Map<string, any>} */
const apps = new Map();
let timer = null;
let loaded = false;

export function loadStore() {
  if (loaded) return;
  loaded = true;
  try {
    const raw = fs.readFileSync(FILE, 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      for (const [pkg, value] of Object.entries(parsed)) {
        if (value && typeof value === 'object') apps.set(pkg, value);
      }
    }
    console.log(`[store] loaded ${apps.size} app(s) from ${FILE}`);
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.warn(`[store] could not read ${FILE}: ${error.message}`);
    }
  }
}

function scheduleSave() {
  if (timer) return;
  timer = setTimeout(() => {
    timer = null;
    saveNow();
  }, 120);
  if (typeof timer.unref === 'function') timer.unref();
}

export function saveNow() {
  try {
    const obj = Object.fromEntries(
      [...apps.entries()].sort((a, b) => (b[1].resolvedAt || 0) - (a[1].resolvedAt || 0)),
    );
    fs.writeFileSync(TMP, JSON.stringify(obj, null, 2), 'utf8');
    fs.renameSync(TMP, FILE);
  } catch (error) {
    console.error(`[store] save failed: ${error.message}`);
  }
}

export function getApp(pkg) {
  return apps.get(pkg);
}

export function setApp(app) {
  apps.set(app.pkg, app);
  scheduleSave();
}

export function deleteApp(pkg) {
  const removed = apps.delete(pkg);
  if (removed) scheduleSave();
  return removed;
}

export function allApps() {
  return [...apps.values()].sort(
    (a, b) => (b.resolvedAt || 0) - (a.resolvedAt || 0),
  );
}

export function appCount() {
  return apps.size;
}
