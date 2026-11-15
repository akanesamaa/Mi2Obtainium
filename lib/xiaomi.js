import * as cheerio from 'cheerio';
import fs from 'node:fs/promises';
import path from 'node:path';
import { DATA_DIR } from './paths.js';
import { getApp, setApp } from './store.js';

export const BASE = 'https://app.mi.com';
export const CDN_HOST = 'https://f5.market.xiaomi.com/download/';
const DETAILS_URL = (pkg) => `${BASE}/details?id=${encodeURIComponent(pkg)}`;
const LIST_URL = (id, page) =>
  `${BASE}/categotyAllListApi?page=${page}&categoryId=${id}&pageSize=5000`;

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const DETAILS_TTL = 60 * 1000;
const CATEGORY_TTL = 10 * 60 * 1000;
const MAP_TTL = 30 * 24 * 60 * 60 * 1000;
const MAP_FILE = path.join(DATA_DIR, 'categories.json');
const MAX_PAGES = 3;

// Category IDs that existed when this bridge was written. Used only when the
// live probe of /categotyAllListApi fails (for example when Xiaomi is down).
const STATIC_CATEGORY_MAP = {
  金融理财: [1],
  聊天社交: [2],
  旅行交通: [3],
  居家生活: [4],
  实用工具: [5],
  摄影摄像: [6],
  图书阅读: [7],
  体育运动: [8],
  时尚购物: [9],
  效率办公: [10],
  新闻资讯: [11],
  学习教育: [12],
  娱乐消遣: [13],
  医疗健康: [14],
  网游RPG: [15, 16, 19, 21],
  动作枪战: [17],
  赛车体育: [18],
  棋牌桌游: [20],
  格斗快打: [22],
  休闲创意: [23],
  飞行空战: [25],
  跑酷闯关: [26],
  影音视听: [27],
  塔防迷宫: [28],
  模拟经营: [29],
};

export class ResolveError extends Error {
  constructor(message, code = 'RESOLVE_FAILED', status = 502) {
    super(message);
    this.name = 'ResolveError';
    this.code = code;
    this.status = status;
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const PACKAGE_RE = /^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z0-9_]+)+$/;

export function normalizePackage(input) {
  const text = String(input ?? '').trim();
  if (!text) {
    throw new ResolveError('请先粘贴小米应用商店链接或包名。', 'BAD_INPUT', 400);
  }

  // Most Xiaomi share links contain ?id=<package>
  const idMatch = text.match(/[?&]id=([A-Za-z0-9._]+)/);
  if (idMatch) return checkPackage(idMatch[1]);

  // Any package-looking token (this also accepts a bare package name)
  const pkgMatch = text.match(/([A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z0-9_]+)+)/);
  if (pkgMatch) return checkPackage(pkgMatch[1]);

  throw new ResolveError(
    '没有在输入里找到包名。请粘贴形如 https://app.mi.com/details?id=com.tencent.mm 的链接。',
    'BAD_INPUT',
    400,
  );
}

function checkPackage(pkg) {
  if (!PACKAGE_RE.test(pkg) || pkg.length > 200) {
    throw new ResolveError(`包名格式不正确：${pkg}`, 'BAD_INPUT', 400);
  }
  return pkg;
}

async function request(url, { timeout = 20000, retries = 2, headers = {} } = {}) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent': UA,
          'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.5',
          ...headers,
        },
        redirect: 'follow',
        signal: AbortSignal.timeout(timeout),
      });
      if (res.status >= 500 && attempt < retries) {
        lastError = new Error(`HTTP ${res.status}`);
        await sleep(350 * (attempt + 1));
        continue;
      }
      return res;
    } catch (error) {
      lastError = error;
      if (attempt < retries) await sleep(350 * (attempt + 1));
    }
  }
  throw new ResolveError(
    `连接小米应用商店失败：${lastError?.message || '网络错误'}`,
    'UPSTREAM',
    502,
  );
}

async function getJson(url) {
  const res = await request(url);
  if (!res.ok) {
    throw new ResolveError(`小米应用商店接口返回 HTTP ${res.status}`, 'UPSTREAM', 502);
  }
  return res.json();
}

/** Parse the public details page. */
export async function fetchDetails(pkg) {
  const url = DETAILS_URL(pkg);
  const res = await request(url);
  if (!res.ok) {
    throw new ResolveError(
      `小米应用商店没有找到 ${pkg}（HTTP ${res.status}）。`,
      'NOT_FOUND',
      404,
    );
  }
  const html = await res.text();
  const $ = cheerio.load(html);

  const name = $('.app-info .intro-titles h3').first().text().trim();
  if (!name) {
    throw new ResolveError(
      `小米应用商店没有找到 ${pkg}，或者这个应用已下架。`,
      'NOT_FOUND',
      404,
    );
  }

  const fields = {};
  $('.float-left, .float-right').each((_, element) => {
    const $el = $(element);
    const $kids = $el.children('div');
    if ($kids.length < 2) return;
    const key = $kids.eq(0).text().replace(/\s+/g, '').trim();
    const value = $kids.eq(1).text().replace(/\s+/g, ' ').trim();
    if (key && value && fields[key] === undefined) fields[key] = value;
  });

  const version = (fields['版本号'] || '').trim();
  if (!version) {
    throw new ResolveError(
      `没有在 ${pkg} 的页面里读到版本号，页面结构可能变了。`,
      'PARSE_FAILED',
      502,
    );
  }

  const categoryLine = $('.app-info .intro-titles p.action')
    .first()
    .text()
    .replace(/\s+/g, ' ')
    .trim();
  const category =
    (categoryLine.match(/分类[：:]\s*([^|]+)/) || [])[1]?.trim() || '';

  const $download = $('a.allowDownload').first();
  let signedUrl = ($download.attr('src') || '').trim();
  if (!signedUrl || /^javascript:/i.test(signedUrl)) {
    signedUrl = ($download.attr('href') || '').trim();
  }
  if (signedUrl && !/^https?:/i.test(signedUrl)) {
    signedUrl = new URL(signedUrl, BASE).toString();
  }
  if (!/^https?:/i.test(signedUrl)) signedUrl = '';

  const appId =
    (fields['appID'] || '').replace(/\D/g, '') ||
    (signedUrl.match(/\/download\/(\d+)/) || [])[1] ||
    '';

  let icon =
    $('.app-info img.yellow-flower').attr('src') ||
    $('.app-info img').first().attr('src') ||
    '';
  if (icon.startsWith('//')) icon = `https:${icon}`;
  if (icon.startsWith('http://')) icon = `https://${icon.slice(7)}`;

  return {
    pkg,
    name,
    author: (fields['开发者'] || '小米应用商店').trim(),
    version,
    icon,
    sizeText: (fields['软件大小'] || '').trim(),
    updated: (fields['更新时间'] || '').trim(),
    category,
    appId,
    signedUrl,
    sourceUrl: url,
  };
}

let categoryMap = null;
let categoryMapBuiltAt = 0;

function useStaticMap() {
  const map = {};
  for (const [name, ids] of Object.entries(STATIC_CATEGORY_MAP)) {
    map[name] = [...ids];
  }
  return map;
}

async function readMapFile() {
  try {
    const raw = await fs.readFile(MAP_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    if (
      parsed &&
      typeof parsed.builtAt === 'number' &&
      parsed.map &&
      typeof parsed.map === 'object'
    ) {
      return parsed;
    }
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.warn(`[xiaomi] category cache unreadable: ${error.message}`);
    }
  }
  return null;
}

async function probeCategoryMap() {
  const ids = Array.from({ length: 45 }, (_, index) => index + 1);
  const map = {};
  const batchSize = 8;

  for (let offset = 0; offset < ids.length; offset += batchSize) {
    const batch = ids.slice(offset, offset + batchSize);
    const results = await Promise.allSettled(
      batch.map(async (id) => {
        const url = `${BASE}/categotyAllListApi?page=0&categoryId=${id}&pageSize=1`;
        const res = await request(url, { timeout: 12000, retries: 1 });
        if (!res.ok) return null;
        const json = await res.json();
        const name = json?.data?.[0]?.level1CategoryName;
        return name ? { id, name: String(name).trim() } : null;
      }),
    );
    for (const result of results) {
      if (result.status !== 'fulfilled' || !result.value) continue;
      const { id, name } = result.value;
      if (!map[name]) map[name] = [];
      if (!map[name].includes(id)) map[name].push(id);
    }
  }

  if (Object.keys(map).length === 0) throw new Error('empty category map');
  for (const name of Object.keys(map)) map[name].sort((a, b) => a - b);
  return map;
}

export async function getCategoryMap(force = false) {
  if (!force && categoryMap && Date.now() - categoryMapBuiltAt < MAP_TTL) {
    return categoryMap;
  }

  if (!force) {
    const cached = await readMapFile();
    if (cached && Date.now() - cached.builtAt < MAP_TTL) {
      categoryMap = cached.map;
      categoryMapBuiltAt = cached.builtAt;
      return categoryMap;
    }
  }

  let map;
  let builtAt = Date.now();
  try {
    map = await probeCategoryMap();
    await fs
      .writeFile(MAP_FILE, JSON.stringify({ builtAt, map }, null, 2), 'utf8')
      .catch((error) =>
        console.warn(`[xiaomi] could not save category cache: ${error.message}`),
      );
  } catch (error) {
    console.warn(
      `[xiaomi] live category probe failed (${error.message}); using built-in map`,
    );
    map = useStaticMap();
    builtAt = 0;
  }

  categoryMap = map;
  categoryMapBuiltAt = builtAt || Date.now();
  return categoryMap;
}

/** @type {Map<string, {t:number, apps:Map<string, any>}>} */
const categoryCache = new Map();
const CATEGORY_CACHE_MAX = 60;

async function getCategoryPage(categoryId, page, fresh = false) {
  const key = `${categoryId}:${page}`;
  const cached = categoryCache.get(key);
  if (!fresh && cached && Date.now() - cached.t < CATEGORY_TTL) {
    return cached.apps;
  }

  const json = await getJson(LIST_URL(categoryId, page));
  const apps = new Map();
  for (const item of Array.isArray(json.data) ? json.data : []) {
    if (!item?.packageName) continue;
    apps.set(item.packageName, {
      apk: item.apk || '',
      appId: item.appId || '',
      apkSizeKb: item.apkSize || 0,
      versionName: item.versionName || '',
      displayName: item.displayName || '',
      icon: item.icon || '',
      category: item.level1CategoryName || '',
    });
  }

  categoryCache.set(key, { t: Date.now(), apps });
  if (categoryCache.size > CATEGORY_CACHE_MAX) {
    const oldest = [...categoryCache.entries()]
      .sort((a, b) => a[1].t - b[1].t)
      .slice(0, 10);
    for (const [oldKey] of oldest) categoryCache.delete(oldKey);
  }
  return apps;
}

/**
 * Xiaomi's category index is public and contains the APK hash for each app.
 * That hash can be turned into a permanent CDN link, which sidesteps the
 * captcha-gated "download" button on app.mi.com.
 */
export async function findApkHash(categoryName, pkg, { fresh = false } = {}) {
  if (!categoryName) return null;

  let map = await getCategoryMap();
  let ids = map[categoryName] || [];
  if (ids.length === 0) {
    map = await getCategoryMap(true);
    ids = map[categoryName] || [];
  }
  if (ids.length === 0) return null;

  for (let page = 0; page < MAX_PAGES; page += 1) {
    const pages = await Promise.all(
      ids.map((id) =>
        getCategoryPage(id, page, fresh).catch((error) => {
          console.warn(
            `[xiaomi] category ${id} page ${page} failed: ${error.message}`,
          );
          return new Map();
        }),
      ),
    );

    for (let index = 0; index < ids.length; index += 1) {
      const hit = pages[index].get(pkg);
      if (hit?.apk) {
        return { ...hit, categoryId: ids[index], page };
      }
    }

    if (pages.every((apps) => apps.size === 0)) break;
  }

  return null;
}

/**
 * Fetch every app in every category. Used to build the name -> package index
 * for the homepage search bar. This is roughly 25-30 large JSON responses, so
 * callers should cache the result (see lib/search.js).
 */
export async function getAllCategoryApps() {
  const map = await getCategoryMap();
  const ids = [...new Set(Object.values(map).flat())]
    .filter((id) => Number.isInteger(id))
    .sort((a, b) => a - b);
  const byPackage = new Map();
  const concurrency = 4;

  for (let offset = 0; offset < ids.length; offset += concurrency) {
    const batch = ids.slice(offset, offset + concurrency);
    const results = await Promise.allSettled(
      batch.map(async (categoryId) => {
        const list = [];
        for (let page = 0; page < MAX_PAGES; page += 1) {
          const apps = await getCategoryPage(categoryId, page);
          if (apps.size === 0) break;
          for (const [pkg, item] of apps) list.push({ pkg, ...item });
        }
        return list;
      }),
    );

    results.forEach((result, index) => {
      if (result.status !== 'fulfilled') {
        console.warn(
          `[xiaomi] search index: category ${batch[index]} failed: ${result.reason?.message}`,
        );
        return;
      }
      for (const item of result.value) {
        if (!byPackage.has(item.pkg)) byPackage.set(item.pkg, item);
      }
    });
  }

  return [...byPackage.values()];
}

const inflight = new Map();

export function resolveApp(pkg, { force = false } = {}) {
  const normalized = checkPackage(String(pkg));
  const cached = getApp(normalized);
  if (
    !force &&
    cached &&
    cached.targetUrl &&
    Date.now() - (cached.checkedAt || 0) < DETAILS_TTL
  ) {
    return Promise.resolve(cached);
  }
  if (inflight.has(normalized)) return inflight.get(normalized);

  const promise = resolveAppUncached(normalized, { force }).finally(() => {
    inflight.delete(normalized);
  });
  inflight.set(normalized, promise);
  return promise;
}

async function resolveAppUncached(pkg, { force }) {
  const cached = getApp(pkg);

  let details;
  try {
    details = await fetchDetails(pkg);
  } catch (error) {
    if (cached?.targetUrl) {
      console.warn(`[xiaomi] ${pkg}: ${error.message}; serving cached result`);
      return {
        ...cached,
        stale: true,
        warning: '暂时访问不到小米应用商店，正在使用上一次成功解析的结果。',
      };
    }
    throw error;
  }

  let hashInfo = null;
  let hashError = null;
  if (cached?.apkHash && cached.version === details.version) {
    hashInfo = {
      apk: cached.apkHash,
      appId: cached.appId,
      apkSizeKb: cached.apkSizeKb,
    };
  } else {
    try {
      hashInfo = await findApkHash(details.category, pkg, {
        fresh: !!cached && cached.version !== details.version,
      });
    } catch (error) {
      hashError = error;
      console.warn(`[xiaomi] ${pkg}: category lookup failed: ${error.message}`);
    }
  }

  let targetUrl = '';
  let targetType = '';
  if (hashInfo?.apk) {
    targetUrl = CDN_HOST + hashInfo.apk;
    targetType = 'hash';
  } else if (details.signedUrl) {
    targetUrl = details.signedUrl;
    targetType = 'signed';
  }

  if (!targetUrl) {
    if (cached?.targetUrl && cached.version === details.version) {
      return {
        ...cached,
        stale: true,
        warning: '这次没有重新查到直链，正在使用上一次的结果。',
      };
    }
    if (hashError) throw hashError;
    throw new ResolveError(
      `${details.name} 目前没有可用的下载直链。小米网页端显示「维护中」，分类索引里也没有找到它。`,
      'NO_DOWNLOAD',
      502,
    );
  }

  const app = {
    ...details,
    appId: details.appId || hashInfo?.appId || '',
    apkHash: hashInfo?.apk || '',
    apkSizeKb: hashInfo?.apkSizeKb || 0,
    targetType,
    targetUrl,
    checkedAt: Date.now(),
    resolvedAt: Date.now(),
    stale: false,
    warning: '',
  };
  setApp(app);
  return app;
}

export function appApkPath(app) {
  return `/apk/${encodeURIComponent(app.pkg)}/${encodeURIComponent(app.version)}.apk`;
}

/**
 * Xiaomi's CDN ignores whatever follows the content hash, so we can append a
 * version-named .apk segment. That gives Obtainium a direct phone -> Xiaomi
 * download URL (no PC bandwidth), while the path still ends in .apk for
 * Obtainium's link filter and version extraction.
 */
export function directApkUrl(app) {
  if (!app || app.targetType !== 'hash' || !app.apkHash) return '';
  const version = String(app.version || '').trim();
  if (!version) return '';
  return `${CDN_HOST}${app.apkHash}/${encodeURIComponent(version)}.apk`;
}

export function isFreshForDownload(app) {
  if (!app) return false;
  if (app.targetType !== 'signed') return true;
  return Date.now() - (app.checkedAt || 0) < 5 * 60 * 1000;
}


