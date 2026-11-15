import fs from 'node:fs/promises';
import path from 'node:path';
import { DATA_DIR } from './paths.js';
import { getAllCategoryApps } from './xiaomi.js';

const FILE = path.join(DATA_DIR, 'search-index.json');
const TTL = 24 * 60 * 60 * 1000;
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

/** @type {Array<{p:string,n:string,i:string,c:string,a:string}>|null} */
let apps = null;
let builtAt = 0;
let loading = null;
let refreshing = null;

function compact(list) {
  return list.map((app) => ({
    p: app.pkg,
    n: app.displayName || app.pkg,
    i: app.icon || '',
    c: app.category || '',
    a: String(app.appId || ''),
  }));
}

async function readDisk() {
  try {
    const raw = await fs.readFile(FILE, 'utf8');
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed.apps) && parsed.apps.length > 0) {
      return parsed;
    }
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.warn(`[search] index cache unreadable: ${error.message}`);
    }
  }
  return null;
}

async function buildAndStore() {
  console.log('[search] building app name index (first search may take a while)...');
  const started = Date.now();
  const list = await getAllCategoryApps();
  if (list.length === 0) {
    throw new Error('小米分类索引为空，无法建立搜索索引');
  }
  const packed = compact(list);
  apps = packed;
  builtAt = Date.now();
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(FILE, JSON.stringify({ builtAt, apps: packed }), 'utf8');
  console.log(
    `[search] indexed ${packed.length} apps in ${Date.now() - started}ms`,
  );
  return packed;
}

function refreshInBackground() {
  if (refreshing) return;
  refreshing = buildAndStore()
    .catch((error) => {
      console.warn(`[search] background refresh failed: ${error.message}`);
    })
    .finally(() => {
      refreshing = null;
    });
}

export async function ensureSearchIndex() {
  if (apps) {
    if (Date.now() - builtAt > TTL) refreshInBackground();
    return apps;
  }

  if (loading) return loading;

  loading = (async () => {
    const disk = await readDisk();
    if (disk) {
      apps = disk.apps;
      builtAt = disk.builtAt || 0;
      if (Date.now() - builtAt > TTL) refreshInBackground();
      return apps;
    }
    return buildAndStore();
  })().finally(() => {
    loading = null;
  });

  return loading;
}

export function getSearchStatus() {
  return {
    ready: !!apps,
    building: !!loading,
    refreshing: !!refreshing,
    count: apps?.length || 0,
    builtAt,
  };
}

async function getSuggestions(query) {
  try {
    const res = await fetch(
      `https://app.mi.com/suggestionApi?keywords=${encodeURIComponent(query)}`,
      {
        headers: { 'User-Agent': UA },
        signal: AbortSignal.timeout(5000),
      },
    );
    if (!res.ok) return [];
    const json = await res.json();
    return Array.isArray(json.suggestion)
      ? json.suggestion.map(String).slice(0, 6)
      : [];
  } catch {
    return [];
  }
}

export async function searchApps(query, limit = 8) {
  const index = await ensureSearchIndex();
  const q = String(query || '').trim().toLowerCase();
  if (!q) return [];

  const scored = [];
  for (let order = 0; order < index.length; order += 1) {
    const item = index[order];
    const name = String(item.n || '').toLowerCase();
    const pkg = String(item.p || '').toLowerCase();
    let score = -1;
    if (name === q || pkg === q || (item.a && item.a === q)) {
      score = 0;
    } else if (name.startsWith(q)) {
      score = 1;
    } else if (pkg.startsWith(q)) {
      score = 2;
    } else if (name.includes(q)) {
      score = 3;
    } else if (pkg.includes(q)) {
      score = 4;
    }
    if (score >= 0) scored.push({ item, score, order });
  }

  scored.sort((a, b) => a.score - b.score || a.order - b.order);
  const merged = new Map();
  for (const entry of scored) {
    if (!merged.has(entry.item.p) && merged.size < limit * 3) {
      merged.set(entry.item.p, entry);
    }
  }

  // Xiaomi's suggestion endpoint understands pinyin ("weixin" -> 微信) and
  // common aliases, which the raw app-name index cannot.
  const suggested = await getSuggestions(q);
  if (suggested.length > 0) {
    const byName = new Map();
    for (const item of index) {
      const name = String(item.n || '').toLowerCase();
      if (!byName.has(name)) byName.set(name, []);
      byName.get(name).push(item);
    }

    // Pure Chinese queries occasionally get unrelated sponsored suggestions
    // (e.g. 微信 for 王者), so only trust suggestions that actually contain
    // the typed Chinese text. ASCII/pinyin queries cannot use this check.
    const pureCjk = /^[\u3400-\u9fff]+$/.test(q);

    for (let i = 0; i < suggested.length; i += 1) {
      const name = suggested[i].toLowerCase();
      if (pureCjk && !name.includes(q)) continue;

      let matches = byName.get(name) || [];
      if (matches.length === 0) {
        matches = index
          .filter((item) => String(item.n || '').toLowerCase().startsWith(name))
          .slice(0, 3);
      }
      for (const item of matches) {
        const existing = merged.get(item.p);
        if (!existing) {
          merged.set(item.p, { item, score: i / 100, order: -1 });
        } else {
          existing.score = Math.min(existing.score, i / 100);
        }
      }
    }
  }

  const list = [...merged.values()].sort(
    (a, b) => a.score - b.score || a.order - b.order,
  );

  return list.slice(0, limit).map(({ item }) => ({
    pkg: item.p,
    name: item.n || item.p,
    icon: item.i || '',
    category: item.c || '',
  }));
}
