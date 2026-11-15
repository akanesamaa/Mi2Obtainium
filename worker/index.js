import QRCode from 'qrcode/lib/browser.js';

const BASE = 'https://app.mi.com';
const CDN_HOST = 'https://f5.market.xiaomi.com/download/';
const PAGES_BASE = 'https://akanesamaa.github.io/Mi2Obtainium';
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const CATEGORY_MAP = {
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

const PACKAGE_RE = /^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z0-9_]+)+$/;

export class WorkerError extends Error {
  constructor(message, code = 'RESOLVE_FAILED', status = 502) {
    super(message);
    this.name = 'WorkerError';
    this.code = code;
    this.status = status;
  }
}

export function normalizePackage(input) {
  const text = String(input ?? '').trim();
  if (!text) throw new WorkerError('请提供包名或小米链接', 'BAD_INPUT', 400);
  const idMatch = text.match(/[?&]id=([A-Za-z0-9._]+)/);
  if (idMatch) return checkPackage(idMatch[1]);
  const pkgMatch = text.match(/([A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z0-9_]+)+)/);
  if (pkgMatch) return checkPackage(pkgMatch[1]);
  throw new WorkerError('没有在输入里找到包名', 'BAD_INPUT', 400);
}

function checkPackage(pkg) {
  if (!PACKAGE_RE.test(pkg) || pkg.length > 200) {
    throw new WorkerError(`包名格式不正确：${pkg}`, 'BAD_INPUT', 400);
  }
  return pkg;
}

function decodeEntities(text) {
  return String(text)
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) =>
      String.fromCodePoint(Number.parseInt(code, 16)),
    );
}

function textOf(html) {
  return decodeEntities(
    String(html)
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' '),
  ).trim();
}

async function request(url, { timeout = 15000, retries = 1 } = {}) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent': UA,
          'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.5',
        },
        redirect: 'follow',
        signal: AbortSignal.timeout(timeout),
      });
      if (response.status >= 500 && attempt < retries) {
        lastError = new Error(`HTTP ${response.status}`);
        continue;
      }
      return response;
    } catch (error) {
      lastError = error;
    }
  }
  throw new WorkerError(
    `连接小米应用商店失败：${lastError?.message || '网络错误'}`,
    'UPSTREAM',
    502,
  );
}

export async function fetchDetails(pkg) {
  const url = `${BASE}/details?id=${encodeURIComponent(pkg)}`;
  const response = await request(url);
  if (!response.ok) {
    throw new WorkerError(
      `小米应用商店没有找到 ${pkg}（HTTP ${response.status}）`,
      'NOT_FOUND',
      404,
    );
  }
  const html = await response.text();

  const nameMatch = html.match(
    /<div[^>]*class="[^"]*intro-titles[^"]*"[^>]*>[\s\S]*?<h3[^>]*>([\s\S]*?)<\/h3>/i,
  );
  const name = textOf(nameMatch?.[1] || '');
  if (!name) {
    throw new WorkerError(
      `小米应用商店没有找到 ${pkg}，或者应用已下架`,
      'NOT_FOUND',
      404,
    );
  }

  const fields = {};
  const fieldRe =
    /<div class="float-(?:left|right)">\s*<div[^>]*>([\s\S]*?)<\/div>\s*<div[^>]*>([\s\S]*?)<\/div>/gi;
  for (const match of html.matchAll(fieldRe)) {
    const key = textOf(match[1]).replace(/\s+/g, '');
    const value = textOf(match[2]);
    if (key && value && fields[key] === undefined) fields[key] = value;
  }

  const version = fields['版本号'] || '';
  if (!version) {
    throw new WorkerError(
      `没有在 ${pkg} 页面读到版本号，页面结构可能变了`,
      'PARSE_FAILED',
      502,
    );
  }

  const categoryLineMatch = html.match(
    /<p[^>]*class="[^"]*action[^"]*"[^>]*>([\s\S]*?)<\/p>/i,
  );
  const categoryLine = textOf(categoryLineMatch?.[1] || '');
  const category =
    (categoryLine.match(/分类[：:]\s*([^|]+)/) || [])[1]?.trim() || '';

  let signedUrl = '';
  const downloadTag = html.match(
    /<a\b[^>]*class="[^"]*allowDownload[^"]*"[^>]*>/i,
  )?.[0];
  if (downloadTag) {
    const src = downloadTag.match(/\bsrc="([^"]+)"/i)?.[1];
    const href = downloadTag.match(/\bhref="([^"]+)"/i)?.[1];
    const candidate = src || href || '';
    if (candidate && !/^javascript:/i.test(candidate)) {
      signedUrl = decodeEntities(candidate).trim();
      if (signedUrl && !/^https?:/i.test(signedUrl)) {
        signedUrl = new URL(signedUrl, BASE).toString();
      }
      if (!/^https?:/i.test(signedUrl)) signedUrl = '';
    }
  }

  const iconMatch =
    html.match(
      /<img[^>]*class="[^"]*yellow-flower[^"]*"[^>]*src="([^"]+)"/i,
    ) || html.match(/<div class="app-info">[\s\S]*?<img[^>]*src="([^"]+)"/i);
  let icon = decodeEntities(iconMatch?.[1] || '').trim();
  if (icon.startsWith('//')) icon = `https:${icon}`;
  if (icon.startsWith('http://')) icon = `https://${icon.slice(7)}`;

  const appId =
    (fields['appID'] || '').replace(/\D/g, '') ||
    (signedUrl.match(/\/download\/(\d+)/) || [])[1] ||
    '';

  return {
    pkg,
    name,
    author: fields['开发者'] || '小米应用商店',
    version,
    icon,
    sizeText: fields['软件大小'] || '',
    updated: fields['更新时间'] || '',
    category,
    appId,
    signedUrl,
    sourceUrl: url,
  };
}

async function fetchCategoryApps(id, page) {
  const url = `${BASE}/categotyAllListApi?page=${page}&categoryId=${id}&pageSize=5000`;
  const response = await request(url);
  if (!response.ok) return [];
  const json = await response.json();
  return Array.isArray(json.data) ? json.data : [];
}

export async function findApkHash(category, pkg) {
  let ids = CATEGORY_MAP[category] || [];
  const fallback = ids.length === 0;
  if (fallback) {
    ids = Array.from({ length: 45 }, (_, index) => index + 1);
  }
  for (let page = 0; page < (fallback ? 1 : 3); page += 1) {
    const pages = await Promise.all(
      ids.map((id) => fetchCategoryApps(id, page).catch(() => [])),
    );
    for (const list of pages) {
      const hit = list.find((item) => item?.packageName === pkg && item?.apk);
      if (hit) {
        return {
          apk: hit.apk,
          appId: hit.appId || '',
          apkSizeKb: Number(hit.apkSize) || 0,
        };
      }
    }
  }
  return null;
}

export async function resolveApp(input) {
  const pkg = normalizePackage(input);
  const details = await fetchDetails(pkg);
  const hashInfo = await findApkHash(details.category, pkg);
  const targetType = hashInfo?.apk ? 'hash' : details.signedUrl ? 'signed' : '';
  const targetUrl = hashInfo?.apk
    ? `${CDN_HOST}${hashInfo.apk}/${encodeURIComponent(details.version)}.apk`
    : details.signedUrl;
  if (!targetType || !targetUrl) {
    throw new WorkerError(
      `${pkg} 没有可用的下载直链`,
      'NO_DOWNLOAD',
      422,
    );
  }

  const app = {
    ...details,
    appId: details.appId || hashInfo?.appId || '',
    apkHash: hashInfo?.apk || '',
    apkSizeKb: hashInfo?.apkSizeKb || 0,
    targetType,
    targetUrl,
    directUrl: targetType === 'hash' ? targetUrl : '',
    proxyUrl: '',
    cdnUrl: targetType === 'hash' ? targetUrl : details.signedUrl,
  };

  return { app, pkg, version: app.version };
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function qrDataUri(text) {
  const svg = await QRCode.toString(text, {
    type: 'svg',
    margin: 1,
    width: 260,
    errorCorrectionLevel: 'M',
    color: { dark: '#1b120c', light: '#ffffff' },
  });
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function buildConfig(app, origin) {
  const pageUrl = `${origin}/o/${encodeURIComponent(app.pkg)}`;
  const filename = `${app.pkg}-${app.version}.apk`;
  const apkUrl = app.targetUrl;
  return {
    id: app.pkg,
    url: pageUrl,
    author: app.author,
    name: app.name,
    latestVersion: app.version,
    apkUrls: JSON.stringify([[filename, apkUrl]]),
    preferredApkIndex: 0,
    additionalSettings: JSON.stringify({
      versionExtractionRegEx: '([^/]+)\\.apk',
      matchGroupToUse: '$1',
      versionDetection: true,
      autoApkFilterByArch: false,
      refreshBeforeDownload: app.targetType !== 'hash',
    }),
    overrideSource: 'HTML',
  };
}

async function renderPage(app, origin) {
  const config = buildConfig(app, origin);
  const qrUri = await qrDataUri(`${PAGES_BASE}/?pkg=${encodeURIComponent(app.pkg)}`);
  const deepLink = `obtainium://app/${encodeURIComponent(JSON.stringify(config))}`;
  const pageUrl = config.url;
  const filename = `${app.pkg}-${app.version}.apk`;
  const icon = String(app.icon || '').replace(/^http:\/\//i, 'https://');
  const letter = String(app.name || app.pkg || '?').slice(0, 1);
  const typeLabel =
    app.targetType === 'hash' ? '分类索引哈希' : '页面签名链接';
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta id="themeColor" name="theme-color" content="#ffffff">
<link id="favicon" rel="icon" href="${PAGES_BASE}/favicon-light.svg?v=3" type="image/svg+xml">
<title>${escapeHtml(app.name)} · Obtainium</title>
<script>
(function () {
  try {
    var theme = localStorage.getItem('mi-theme');
    if (theme !== 'light' && theme !== 'dark') theme = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    document.documentElement.dataset.theme = theme;
    var favicon = document.getElementById('favicon');
    if (favicon) favicon.href = theme === 'dark' ? '${PAGES_BASE}/favicon.svg?v=18' : '${PAGES_BASE}/favicon-light.svg?v=3';
    var lang = localStorage.getItem('mi-lang');
    if (lang !== 'zh-Hans' && lang !== 'zh-Hant' && lang !== 'en') {
      lang = 'zh-Hans';
      var list = navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language || 'zh-CN'];
      for (var i = 0; i < list.length; i += 1) {
        var code = String(list[i] || '').toLowerCase();
        if (code.indexOf('zh') === 0) lang = /hant|tw|hk|mo/.test(code) ? 'zh-Hant' : 'zh-Hans';
        else lang = 'en';
        break;
      }
    }
    document.documentElement.lang = lang === 'zh-Hant' ? 'zh-Hant' : lang === 'en' ? 'en' : 'zh-CN';
  } catch (error) {}
})();
</script>
<link rel="stylesheet" href="${PAGES_BASE}/styles.css?v=31">
</head>
<body class="search-active" data-app-type="${escapeHtml(app.targetType)}">
<div class="top-controls">
  <div class="lang-switch" role="group" aria-label="语言 / Language">
    <button type="button" data-lang="zh-Hans" aria-pressed="true">简中</button>
    <button type="button" data-lang="zh-Hant" aria-pressed="false">繁中</button>
    <button type="button" data-lang="en" aria-pressed="false">EN</button>
  </div>
  <button id="themeToggle" class="theme-toggle" type="button" aria-label="切换深色模式" title="切换深色模式">
    <svg class="icon-sun" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="3.5"></circle><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"></path></svg>
    <svg class="icon-moon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20.4 14.2A8.5 8.5 0 0 1 9.8 3.6 8.5 8.5 0 1 0 20.4 14.2Z"></path></svg>
  </button>
</div>

<main class="page">
  <header class="masthead">
    <h1><a href="${PAGES_BASE}/"><span class="title-xiaomi" id="storeTitle">小米应用商店</span><span class="title-arrow" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><path d="m9 6 6 6-6 6"></path></svg></span><span class="title-obtainium">Obtainium</span></a></h1>
  </header>

  <section class="result">
    <div class="result-head">
      <span class="app-icon-wrap">
        <span class="app-letter">${escapeHtml(letter)}</span>
        ${icon ? `<img class="app-icon" src="${escapeHtml(icon)}" alt="" onerror="this.remove()">` : ''}
      </span>
      <div class="result-title">
        <div class="title-line">
          <h2>${escapeHtml(app.name)}</h2>
          <span class="version-badge">v${escapeHtml(app.version)}</span>
        </div>
        <p class="pkg">${escapeHtml(app.pkg)}</p>
        <p class="byline">${escapeHtml(app.author)}${app.category ? ` · ${escapeHtml(app.category)}` : ''}</p>
      </div>
      <div class="result-actions">
        <a class="btn obtainium" id="addBtn" href="${escapeHtml(deepLink)}" data-i18n="addObtainium">在 Obtainium 中添加</a>
        <button class="btn ghost" id="copyDeep" type="button" data-deep="${escapeHtml(deepLink)}" data-i18n="copyDeep">复制深链</button>
        <a class="btn ghost" id="downloadApk" href="${escapeHtml(app.targetUrl)}" target="_blank" rel="noreferrer" data-i18n="downloadApk">下载 APK</a>
      </div>
    </div>

    <div class="meta-grid">
      <div class="meta-item"><span data-i18n="version">版本</span><strong>${escapeHtml(app.version)}</strong></div>
      <div class="meta-item"><span data-i18n="size">大小</span><strong id="sizeValue" data-empty="${app.sizeText ? '0' : '1'}">${escapeHtml(app.sizeText || '未知')}</strong></div>
      <div class="meta-item"><span data-i18n="updated">更新日期</span><strong id="updatedValue" data-empty="${app.updated ? '0' : '1'}">${escapeHtml(app.updated || '未知')}</strong></div>
      <div class="meta-item"><span data-i18n="sourceType">直链来源</span><strong id="sourceValue" data-type="${escapeHtml(app.targetType)}">${typeLabel}</strong></div>
    </div>

    <div class="result-body">
      <aside class="qr-side">
        <img src="${qrUri}" alt="${escapeHtml('扫码在手机上打开并添加')}">
        <p data-i18n="qrHint">扫码在手机上打开并添加</p>
      </aside>
      <div class="result-main">
        <div class="source-box">
          <span class="label" data-i18n="htmlSource">HTML 源</span>
          <code title="${escapeHtml(pageUrl)}" tabindex="0">${escapeHtml(pageUrl)}</code>
          <button class="icon-btn" id="copySource" type="button" data-copy="${escapeHtml(pageUrl)}">复制</button>
        </div>
        <div class="source-box">
          <span class="label">APK</span>
          <code><a href="${escapeHtml(app.targetUrl)}">${escapeHtml(filename)}</a></code>
        </div>
      </div>
    </div>
  </section>

  <footer class="site-foot">
    <a class="foot-link" href="https://github.com/akanesamaa/Mi2Obtainium" target="_blank" rel="noreferrer">GitHub ↗</a>
  </footer>
</main>
<script>
(function () {
  var LANG_KEY = 'mi-lang';
  var THEME_KEY = 'mi-theme';
  var LANGS = ['zh-Hans', 'zh-Hant', 'en'];
  var STR = {
    'zh-Hans': {
      storeName: '小米应用商店', languageGroup: '语言',
      themeToDark: '切换深色模式', themeToLight: '切换浅色模式',
      version: '版本', size: '大小', updated: '更新日期', sourceType: '直链来源',
      hashSource: '分类索引哈希', signedSource: '页面签名链接', unknown: '未知',
      addObtainium: '在 Obtainium 中添加', copyDeep: '复制深链', downloadApk: '下载 APK', copied: '已复制',
      htmlSource: 'HTML 源',
      qrHint: '扫码在手机上打开并添加',
      hint: 'APK 由手机直连小米 CDN 下载；Obtainium 每次检查都会重新解析这个 Worker 页面。',
      foot: '由 Cloudflare Worker 实时解析 · {base}'
    },
    'zh-Hant': {
      storeName: '小米應用商店', languageGroup: '語言',
      themeToDark: '切換深色模式', themeToLight: '切換淺色模式',
      version: '版本', size: '大小', updated: '更新日期', sourceType: '直連來源',
      hashSource: '分類索引雜湊', signedSource: '頁面簽名連結', unknown: '未知',
      addObtainium: '在 Obtainium 中加入', copyDeep: '複製深層連結', downloadApk: '下載 APK', copied: '已複製',
      htmlSource: 'HTML 來源',
      qrHint: '掃碼在手機上開啟並加入',
      hint: 'APK 由手機直連小米 CDN 下載；Obtainium 每次檢查都會重新解析這個 Worker 頁面。',
      foot: '由 Cloudflare Worker 即時解析 · {base}'
    },
    en: {
      storeName: 'Xiaomi App Store', languageGroup: 'Language',
      themeToDark: 'Switch to dark mode', themeToLight: 'Switch to light mode',
      version: 'Version', size: 'Size', updated: 'Updated', sourceType: 'Source',
      hashSource: 'Category index hash', signedSource: 'Signed page URL', unknown: 'Unknown',
      addObtainium: 'Add in Obtainium', copyDeep: 'Copy deep link', downloadApk: 'Download APK', copied: 'Copied',
      htmlSource: 'HTML source',
      qrHint: 'Scan to open and add on your phone',
      hint: 'The APK downloads directly from Xiaomi CDN on your phone; Obtainium re-resolves this Worker page on every check.',
      foot: 'Resolved live by Cloudflare Worker · {base}'
    }
  };
  var lang = document.documentElement.lang === 'zh-Hant' ? 'zh-Hant' : document.documentElement.lang === 'en' ? 'en' : 'zh-Hans';

  function t(key, vars) {
    var table = STR[lang] || STR['zh-Hans'];
    var text = table[key] || STR['zh-Hans'][key] || key;
    return String(text).replace(/\\{(\\w+)\\}/g, function (_, name) { return String((vars || {})[name] || ''); });
  }

  var themeTimer = null;
  var lastThemeToggleAt = 0;

  function applyTheme(next, persist, immediate) {
    var theme = next === 'dark' ? 'dark' : 'light';
    var root = document.documentElement;
    if (immediate) {
      root.classList.add('theme-switching');
      clearTimeout(themeTimer);
      themeTimer = setTimeout(function () { root.classList.remove('theme-switching'); }, 260);
    }
    root.dataset.theme = theme;
    if (persist) { try { localStorage.setItem(THEME_KEY, theme); } catch (e) {} }
    var meta = document.getElementById('themeColor');
    if (meta) meta.setAttribute('content', theme === 'dark' ? '#0f0f10' : '#ffffff');
    var favicon = document.getElementById('favicon');
    if (favicon) favicon.href = theme === 'dark' ? '${PAGES_BASE}/favicon.svg?v=18' : '${PAGES_BASE}/favicon-light.svg?v=3';
    var button = document.getElementById('themeToggle');
    if (button) {
      var label = theme === 'dark' ? t('themeToLight') : t('themeToDark');
      button.setAttribute('aria-label', label);
      button.setAttribute('title', label);
    }
  }

  function applyLanguage(next, persist) {
    lang = LANGS.indexOf(next) >= 0 ? next : 'zh-Hans';
    if (persist) { try { localStorage.setItem(LANG_KEY, lang); } catch (e) {} }
    document.documentElement.lang = lang === 'zh-Hant' ? 'zh-Hant' : lang === 'en' ? 'en' : 'zh-CN';
    var store = document.getElementById('storeTitle');
    if (store) store.textContent = t('storeName');
    document.querySelectorAll('[data-i18n]').forEach(function (node) {
      node.textContent = t(node.getAttribute('data-i18n'));
    });
    var source = document.getElementById('sourceValue');
    if (source) source.textContent = t(source.getAttribute('data-type') === 'hash' ? 'hashSource' : 'signedSource');
    var size = document.getElementById('sizeValue');
    if (size && size.getAttribute('data-empty') === '1') size.textContent = t('unknown');
    var updated = document.getElementById('updatedValue');
    if (updated && updated.getAttribute('data-empty') === '1') updated.textContent = t('unknown');
    var group = document.querySelector('.lang-switch');
    if (group) group.setAttribute('aria-label', t('languageGroup'));
    document.querySelectorAll('[data-lang]').forEach(function (button) {
      button.setAttribute('aria-pressed', String(button.getAttribute('data-lang') === lang));
    });
    applyTheme(document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light', false);
  }

  document.querySelectorAll('[data-lang]').forEach(function (button) {
    button.addEventListener('click', function () { applyLanguage(button.getAttribute('data-lang'), true); });
  });
  var themeToggle = document.getElementById('themeToggle');
  if (themeToggle) themeToggle.addEventListener('click', function () {
    var now = Date.now();
    var immediate = now - lastThemeToggleAt < 260;
    lastThemeToggleAt = now;
    applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark', true, immediate);
  });
  try {
    var media = matchMedia('(prefers-color-scheme: dark)');
    if (media.addEventListener) media.addEventListener('change', function (event) {
      try { if (localStorage.getItem(THEME_KEY)) return; } catch (e) {}
      applyTheme(event.matches ? 'dark' : 'light', false);
    });
  } catch (e) {}
  try {
    window.addEventListener('languagechange', function () {
      try { if (localStorage.getItem(LANG_KEY)) return; } catch (e) {}
      var next = navigator.languages && navigator.languages.length ? navigator.languages[0] : navigator.language;
      next = String(next || '').toLowerCase();
      applyLanguage(!next.indexOf('zh') ? (/hant|tw|hk|mo/.test(next) ? 'zh-Hant' : 'zh-Hans') : 'en', false);
    });
  } catch (e) {}

  async function copyText(text) {
    try { await navigator.clipboard.writeText(text); return true; }
    catch (e) {
      var area = document.createElement('textarea');
      area.value = text; area.style.position = 'fixed'; area.style.opacity = '0';
      document.body.appendChild(area); area.select();
      var ok = false;
      try { ok = document.execCommand('copy'); } catch (error) {}
      area.remove();
      return ok;
    }
  }

  var button = document.getElementById('copyDeep');
  if (button) {
    button.addEventListener('click', async function () {
      var ok = await copyText(button.getAttribute('data-deep') || '');
      button.textContent = ok ? t('copied') : t('copyDeep');
      setTimeout(function () { button.textContent = t('copyDeep'); }, 1500);
    });
  }

  var sourceButton = document.getElementById('copySource');
  if (sourceButton) {
    sourceButton.addEventListener('click', async function () {
      var ok = await copyText(sourceButton.getAttribute('data-copy') || '');
      sourceButton.textContent = ok ? t('copied') : '复制';
      setTimeout(function () { sourceButton.textContent = '复制'; }, 1500);
    });
  }

  applyTheme(document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light', false);
  applyLanguage(lang, false);
})();
</script>
</body>
</html>`;
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

async function handle(request) {
  const url = new URL(request.url);
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders() });
  }

  if (url.pathname === '/health') {
    return Response.json({ ok: true, service: 'mi2obtainium-worker' });
  }

  if (url.pathname === '/api/resolve') {
    try {
      const input = url.searchParams.get('input') || url.searchParams.get('pkg');
      const resolved = await resolveApp(input);
      const config = buildConfig(
        resolved.app,
        `${url.protocol}//${url.host}`,
      );
      return Response.json(
        {
          ok: true,
          app: resolved.app,
          pageUrl: config.url,
          apkUrl: resolved.app.targetUrl,
          deepLink: `obtainium://app/${encodeURIComponent(
            JSON.stringify(config),
          )}`,
        },
        { headers: corsHeaders() },
      );
    } catch (error) {
      return Response.json(
        {
          ok: false,
          error: { code: error.code || 'ERROR', message: error.message },
        },
        {
          status: error.status || 500,
          headers: corsHeaders(),
        },
      );
    }
  }

  const match = url.pathname.match(/^\/o\/([^/]+)\/?$/);
  if (!match) {
    return new Response('mi2obtainium worker: use /o/<package>', {
      status: 404,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }

  const pkg = decodeURIComponent(match[1]);
  try {
    const { app } = await resolveApp(pkg);
    const html = await renderPage(app, `${url.protocol}//${url.host}`);
    return new Response(html, {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control':
          app.targetType === 'hash'
            ? 'public, max-age=900, s-maxage=900'
            : 'no-store',
      },
    });
  } catch (error) {
    return new Response(
      `<h1>解析失败</h1><p>${escapeHtml(error.message)}</p>`,
      {
        status: error.status || 502,
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      },
    );
  }
}

export default {
  fetch(request) {
    return handle(request);
  },
};
















