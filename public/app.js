const $ = (selector, root = document) => root.querySelector(selector);

const el = {
  form: $('#resolveForm'),
  input: $('#input'),
  button: $('#resolveBtn'),
  buttonLabel: $('#resolveBtn .btn-label'),
  spinner: $('#resolveBtn .spinner'),
  statusLine: $('#statusLine'),
  suggestions: $('#suggestions'),
  result: $('#result'),
};

const state = {
  resolving: false,
  suggestions: [],
  activeIndex: -1,
  current: null,
  infoView: '',
  searchTimer: null,
  searchSeq: 0,
  searchAbort: null,
  slowTimer: null,
};

/* ---------------- language + theme ---------------- */

const LANG_KEY = 'mi-lang';
const THEME_KEY = 'mi-theme';
const LANGS = ['zh-Hans', 'zh-Hant', 'en'];

const STRINGS = {
  'zh-Hans': {
    pageTitle: 'Mi2Obtainium',
    storeName: '小米应用商店',
    metaDescription: '粘贴小米应用商店链接、包名或应用名称，生成 Obtainium 可直接读取的更新源。',
    placeholder: '粘贴 app.mi.com 链接、包名，或输入应用名称',
    searchAria: '小米应用商店链接、包名或应用名称',
    resolve: '解析',
    languageGroup: '语言',
    themeToDark: '切换深色模式',
    themeToLight: '切换浅色模式',
    searching: '正在搜索应用…',
    indexSlow: '首次搜索需要建立应用索引，可能需要十几秒…',
    searchFailed: '搜索失败（HTTP {status}）',
    noMatch: '没有找到匹配的应用，试试粘贴链接或包名',
    foundClick: '找到 {count} 个应用，点击选择',
    foundChoose: '找到 {count} 个应用，请选择',
    searchFailedPrefix: '搜索失败：{message}',
    requestFailed: '请求失败（HTTP {status}）',
    resolvingFirst: '正在解析小米应用商店页面…',
    resolved: '已解析 · {name} {version}',
    inputRequired: '请输入链接、包名或应用名称',
    pressEnter: '按回车解析',
    about: '关于',
    how: '原理',
    close: '关闭',
    aboutTitle: '关于',
    aboutP1: '这是一个非官方的桥接工具，与小米、Obtainium 都没有关联。',
    aboutP2: '它只读取小米应用商店的公开页面和分类索引，用来生成 Obtainium 能读取的 HTML 更新源。',
    aboutP3: 'APK 由手机从链接直接下载；本服务不代理 APK 字节，也不收集用户数据。',
    howTitle: '原理',
    howStep1: '读取 app.mi.com 详情页，拿到名称、版本、图标和下载地址。',
    howStep2: '从分类接口 categotyAllListApi 找到 APK hash。',
    howStep3: '拼出小米 CDN 的 APK 直链。',
    howStep4: '生成 HTML 源页和 obtainium:// 深链。',
    addObtainium: '在 Obtainium 中添加',
    copyDeep: '复制深链',
    version: '版本',
    size: '大小',
    updated: '更新日期',
    sourceType: '直链来源',
    hashSource: '分类索引哈希',
    signedSource: '页面签名链接',
    unknown: '未知',
    storeCategory: '小米应用商店',
    htmlSource: 'HTML 源',
    copy: '复制',
    testApk: '下载 APK',
    qrAlt: '在手机上打开本页',
    qrHint: '扫码在手机上打开并添加',
    errNotFound: '找不到这个应用，或已从小米应用商店下架。',
    errNoDownload: '这个应用目前没有可用的下载直链。',
    errResolve: '解析失败，请稍后再试。',
    errQuery: '搜索词太长。',
  },
  'zh-Hant': {
    pageTitle: 'Mi2Obtainium',
    storeName: '小米應用商店',
    metaDescription: '貼上小米應用商店連結、套件名稱或應用程式名稱，產生 Obtainium 可直接讀取的更新來源。',
    placeholder: '貼上 app.mi.com 連結、套件名稱，或輸入應用程式名稱',
    searchAria: '小米應用商店連結、套件名稱或應用程式名稱',
    resolve: '解析',
    languageGroup: '語言',
    themeToDark: '切換深色模式',
    themeToLight: '切換淺色模式',
    searching: '正在搜尋應用程式…',
    indexSlow: '首次搜尋需要建立應用程式索引，可能需要十幾秒…',
    searchFailed: '搜尋失敗（HTTP {status}）',
    noMatch: '找不到符合的應用程式，試試貼上連結或套件名稱',
    foundClick: '找到 {count} 個應用程式，點擊選擇',
    foundChoose: '找到 {count} 個應用程式，請選擇',
    searchFailedPrefix: '搜尋失敗：{message}',
    requestFailed: '請求失敗（HTTP {status}）',
    resolvingFirst: '正在解析小米應用商店頁面…',
    resolved: '已解析 · {name} {version}',
    inputRequired: '請輸入連結、套件名稱或應用程式名稱',
    pressEnter: '按 Enter 解析',
    about: '關於',
    how: '原理',
    close: '關閉',
    aboutTitle: '關於',
    aboutP1: '這是一個非官方的橋接工具，與小米、Obtainium 都沒有關聯。',
    aboutP2: '它只讀取小米應用商店的公開頁面和分類索引，用來產生 Obtainium 能讀取的 HTML 更新來源。',
    aboutP3: 'APK 由手機從連結直接下載；本服務不代理 APK 位元組，也不收集使用者資料。',
    howTitle: '原理',
    howStep1: '讀取 app.mi.com 詳情頁，取得名稱、版本、圖示和下載網址。',
    howStep2: '從分類介面 categotyAllListApi 找到 APK hash。',
    howStep3: '組合出小米 CDN 的 APK 直連。',
    howStep4: '產生 HTML 來源頁和 obtainium:// 深層連結。',
    addObtainium: '在 Obtainium 中加入',
    copyDeep: '複製深層連結',
    version: '版本',
    size: '大小',
    updated: '更新日期',
    sourceType: '直連來源',
    hashSource: '分類索引雜湊',
    signedSource: '頁面簽名連結',
    unknown: '未知',
    storeCategory: '小米應用商店',
    htmlSource: 'HTML 來源',
    copy: '複製',
    testApk: '下載 APK',
    qrAlt: '在手機上開啟本頁',
    qrHint: '掃碼在手機上開啟並加入',
    errNotFound: '找不到這個應用程式，或已從小米應用商店下架。',
    errNoDownload: '這個應用程式目前沒有可用的下載直連。',
    errResolve: '解析失敗，請稍後再試。',
    errQuery: '搜尋詞太長。',
  },
  en: {
    pageTitle: 'Mi2Obtainium',
    storeName: 'Xiaomi App Store',
    metaDescription: 'Paste a Xiaomi App Store link, package name, or app name to generate an update source Obtainium can read.',
    placeholder: 'Paste an app.mi.com link, package name, or app name',
    searchAria: 'Xiaomi App Store link, package name, or app name',
    resolve: 'Resolve',
    languageGroup: 'Language',
    themeToDark: 'Switch to dark mode',
    themeToLight: 'Switch to light mode',
    searching: 'Searching apps…',
    indexSlow: 'The first search may take a few seconds while the app index is built…',
    searchFailed: 'Search failed (HTTP {status})',
    noMatch: 'No matching app found. Try pasting a link or package name.',
    foundClick: '{count} apps found. Click to select.',
    foundChoose: '{count} apps found. Choose one.',
    searchFailedPrefix: 'Search failed: {message}',
    requestFailed: 'Request failed (HTTP {status})',
    resolvingFirst: 'Resolving Xiaomi App Store page…',
    resolved: 'Resolved · {name} {version}',
    inputRequired: 'Enter a link, package name, or app name',
    pressEnter: 'Press Enter to resolve',
    about: 'About',
    how: 'How it works',
    close: 'Close',
    aboutTitle: 'About',
    aboutP1: 'This is an unofficial bridge, not affiliated with Xiaomi or Obtainium.',
    aboutP2: 'It only reads public Xiaomi App Store pages and category indexes to generate an HTML update source Obtainium can read.',
    aboutP3: 'APKs are downloaded directly by your phone; this service does not proxy APK bytes or collect user data.',
    howTitle: 'How it works',
    howStep1: 'Read the app.mi.com details page for name, version, icon, and download URL.',
    howStep2: 'Find the APK hash in the categotyAllListApi category index.',
    howStep3: 'Build the Xiaomi CDN APK URL.',
    howStep4: 'Generate the HTML source page and the obtainium:// deep link.',
    addObtainium: 'Add in Obtainium',
    copyDeep: 'Copy deep link',
    version: 'Version',
    size: 'Size',
    updated: 'Updated',
    sourceType: 'Source',
    hashSource: 'Category index hash',
    signedSource: 'Signed page URL',
    unknown: 'Unknown',
    storeCategory: 'Xiaomi App Store',
    htmlSource: 'HTML source',
    copy: 'Copy',
    testApk: 'Download APK',
    qrAlt: 'Open this page on your phone',
    qrHint: 'Scan to open and add on your phone',
    errNotFound: 'App not found or removed from Xiaomi App Store.',
    errNoDownload: 'No downloadable APK URL is available for this app right now.',
    errResolve: 'Could not resolve this app. Try again later.',
    errQuery: 'Search query is too long.',
  },
};

function detectLanguage() {
  try {
    const saved = localStorage.getItem(LANG_KEY);
    if (LANGS.includes(saved)) return saved;
  } catch { /* ignore */ }
  let list = [];
  try {
    list = navigator.languages?.length ? navigator.languages : [navigator.language || 'zh-CN'];
  } catch {
    list = ['zh-CN'];
  }
  const first = String(list[0] || '').toLowerCase();
  if (!first.startsWith('zh')) return 'en';
  return /hant|tw|hk|mo/.test(first) ? 'zh-Hant' : 'zh-Hans';
}

function detectTheme() {
  try {
    const saved = localStorage.getItem(THEME_KEY);
    if (saved === 'light' || saved === 'dark') return saved;
  } catch { /* ignore */ }
  try {
    return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}

let lang = document.documentElement.lang === 'zh-Hant'
  ? 'zh-Hant'
  : document.documentElement.lang === 'en'
    ? 'en'
    : detectLanguage();

function t(key, vars = {}) {
  const table = STRINGS[lang] || STRINGS['zh-Hans'];
  const fallback = STRINGS['zh-Hans'];
  const text = table[key] ?? fallback[key] ?? key;
  return String(text).replace(/\{(\w+)\}/g, (_, name) =>
    String(vars[name] ?? ''),
  );
}

function errorMessage(error) {
  const map = {
    NOT_FOUND: 'errNotFound',
    NO_DOWNLOAD: 'errNoDownload',
    RESOLVE_FAILED: 'errResolve',
    QUERY_TOO_LONG: 'errQuery',
  };
  const key = map[error?.code];
  return key ? t(key) : (error?.message || t('errResolve'));
}

function applyTheme(next, persist = true) {
  const theme = next === 'dark' ? 'dark' : 'light';
  document.documentElement.dataset.theme = theme;
  if (persist) {
    try { localStorage.setItem(THEME_KEY, theme); } catch { /* ignore */ }
  }
  const meta = document.getElementById('themeColor');
  if (meta) meta.setAttribute('content', theme === 'dark' ? '#0f0f10' : '#ffffff');
  const favicon = document.getElementById('favicon');
  if (favicon) {
    favicon.setAttribute(
      'href',
      theme === 'dark' ? '/favicon.svg?v=18' : '/favicon-light.svg?v=3',
    );
  }
  const toggle = document.getElementById('themeToggle');
  if (toggle) {
    const label = theme === 'dark' ? t('themeToLight') : t('themeToDark');
    toggle.setAttribute('aria-label', label);
    toggle.setAttribute('title', label);
  }
}

function applyLanguage(next, persist = true) {
  lang = LANGS.includes(next) ? next : 'zh-Hans';
  if (persist) {
    try { localStorage.setItem(LANG_KEY, lang); } catch { /* ignore */ }
  }
  document.documentElement.lang = lang === 'zh-Hant' ? 'zh-Hant' : lang === 'en' ? 'en' : 'zh-CN';
  document.title = t('pageTitle');
  const meta = document.getElementById('metaDescription');
  if (meta) meta.setAttribute('content', t('metaDescription'));

  const storeTitle = document.getElementById('storeTitle');
  if (storeTitle) storeTitle.textContent = t('storeName');

  const input = el.input;
  input.placeholder = t('placeholder');
  input.setAttribute('aria-label', t('searchAria'));
  el.button.setAttribute('aria-label', t('resolve'));

  const group = document.querySelector('.lang-switch');
  if (group) group.setAttribute('aria-label', t('languageGroup'));
  document.querySelectorAll('[data-lang]').forEach((button) => {
    const active = button.dataset.lang === lang;
    button.setAttribute('aria-pressed', String(active));
  });

  const footAbout = document.querySelector('[data-info="about"]');
  if (footAbout) footAbout.textContent = t('about');
  const footHow = document.querySelector('[data-info="how"]');
  if (footHow) footHow.textContent = t('how');
  const infoClose = document.getElementById('infoClose');
  if (infoClose) infoClose.setAttribute('aria-label', t('close'));
  const infoDialog = document.getElementById('infoDialog');
  if (state.infoView && infoDialog?.open) renderInfo(state.infoView);

  applyTheme(document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light', false);

  if (state.current) {
    renderResult(state.current);
    setStatus(t('resolved', {
      name: state.current.app.name,
      version: state.current.app.version,
    }));
  } else {
    setStatus('');
  }
}

/* ---------------- helpers ---------------- */

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => {
    switch (ch) {
      case '&': return '&amp;';
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '"': return '&quot;';
      case "'": return '&#39;';
      default: return ch;
    }
  });
}

function initial(name) {
  return String(name || '?').trim().slice(0, 1) || '?';
}

function setStatus(message, kind = '') {
  if (kind === 'error' && message) {
    el.statusLine.textContent = message;
    el.statusLine.className = 'status error';
    return;
  }
  el.statusLine.textContent = '';
  el.statusLine.className = 'status';
}

function setActive(active) {
  document.body.classList.toggle('search-active', active);
}

function setLoading(loading) {
  el.button.disabled = loading;
  el.spinner.hidden = !loading;
  el.buttonLabel.hidden = loading;
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      Accept: 'application/json',
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers || {}),
    },
  });
  let data = null;
  try {
    data = await response.json();
  } catch {
    /* non-JSON error */
  }
  if (!response.ok || data?.ok === false) {
    const error = new Error(
      data?.error?.message || t('requestFailed', { status: response.status }),
    );
    error.code = data?.error?.code;
    throw error;
  }
  return data;
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.top = '-1000px';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch {
      ok = false;
    }
    area.remove();
    return ok;
  }
}

/* ---------------- name search ---------------- */

function isDirectInput(value) {
  const text = value.trim();
  if (!text) return false;
  if (/^https?:\/\//i.test(text)) return true;
  if (/app\.mi\.com/i.test(text)) return true;
  if (/[?&]id=[A-Za-z0-9._]+/.test(text)) return true;
  return /^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z0-9_]+)+$/.test(text);
}

function iconSrc(url) {
  const raw = String(url || '').trim();
  if (!raw) return '';
  if (/^https?:\/\//i.test(raw) || raw.startsWith('//')) {
    return `/api/icon?url=${encodeURIComponent(raw)}`;
  }
  return raw;
}

function suggestionIcon(item) {
  const img = item.icon
    ? `<img src="${esc(iconSrc(item.icon))}" alt="" onerror="this.remove()">`
    : '';
  return `<span class="s-icon"><span class="letter">${esc(
    initial(item.name),
  )}</span>${img}</span>`;
}

function renderSuggestions(items) {
  state.suggestions = items;
  state.activeIndex = items.length ? 0 : -1;

  if (items.length === 0) {
    el.suggestions.hidden = true;
    el.suggestions.innerHTML = '';
    return;
  }

  el.suggestions.innerHTML = items
    .map(
      (item, index) => `<button type="button" class="suggestion${
        index === 0 ? ' active' : ''
      }" role="option" aria-selected="${index === 0}" data-index="${index}">
        ${suggestionIcon(item)}
        <span class="s-text">
          <strong>${esc(item.name)}</strong>
          <small>${esc(item.pkg)}</small>
        </span>
        ${item.category ? `<span class="s-cat">${esc(item.category)}</span>` : ''}
      </button>`,
    )
    .join('');
  el.suggestions.hidden = false;
}

function hideSuggestions() {
  el.suggestions.hidden = true;
  el.suggestions.innerHTML = '';
  state.suggestions = [];
  state.activeIndex = -1;
}

function moveActive(delta) {
  if (state.suggestions.length === 0) return;
  const count = state.suggestions.length;
  state.activeIndex = (state.activeIndex + delta + count) % count;
  const buttons = [...el.suggestions.querySelectorAll('.suggestion')];
  buttons.forEach((button, index) => {
    const active = index === state.activeIndex;
    button.classList.toggle('active', active);
    button.setAttribute('aria-selected', String(active));
    if (active) button.scrollIntoView({ block: 'nearest' });
  });
}

function selectSuggestion(index) {
  const item = state.suggestions[index];
  if (!item) return;
  el.input.value = item.name || item.pkg;
  hideSuggestions();
  setStatus('');
  resolve(item.pkg);
}

async function runSearch(query) {
  const seq = ++state.searchSeq;
  if (state.searchAbort) state.searchAbort.abort();
  const controller = new AbortController();
  state.searchAbort = controller;

  setStatus(t('searching'));
  clearTimeout(state.slowTimer);
  state.slowTimer = setTimeout(() => {
    if (seq === state.searchSeq) {
      setStatus(t('indexSlow'));
    }
  }, 1200);

  try {
    const response = await fetch(
      `/api/search?q=${encodeURIComponent(query)}&limit=8`,
      { signal: controller.signal, headers: { Accept: 'application/json' } },
    );
    const data = await response.json().catch(() => null);
    if (seq !== state.searchSeq) return [];
    clearTimeout(state.slowTimer);

    if (!response.ok || data?.ok === false) {
      throw new Error(
        data?.error?.message || t('searchFailed', { status: response.status }),
      );
    }

    const apps = Array.isArray(data.apps) ? data.apps : [];
    if (apps.length === 0) {
      hideSuggestions();
      setStatus(t('noMatch'), 'error');
      return [];
    }

    renderSuggestions(apps);
    setStatus(t('foundClick', { count: apps.length }));
    return apps;
  } catch (error) {
    if (error.name === 'AbortError') return [];
    if (seq !== state.searchSeq) return [];
    clearTimeout(state.slowTimer);
    hideSuggestions();
    setStatus(t('searchFailedPrefix', { message: error.message }), 'error');
    return [];
  }
}

/* ---------------- resolve + result ---------------- */

function renderResult(data) {
  const app = data.app;
  state.current = data;

  const icon = app.icon
    ? `<img class="app-icon" src="${esc(iconSrc(app.icon))}" alt="" onerror="this.remove()">`
    : '';
  const warning = data.warning
    ? `<p class="warning">${esc(data.warning)}</p>`
    : '';

  el.result.innerHTML = `
    <div class="result-head">
      <span class="app-icon-wrap">
        <span class="app-letter">${esc(initial(app.name))}</span>
        ${icon}
      </span>
      <div class="result-title">
        <div class="title-line">
          <h2>${esc(app.name)}</h2>
          <span class="version-badge">v${esc(app.version)}</span>
        </div>
        <p class="pkg">${esc(app.pkg)}</p>
        <p class="byline">${esc(app.author)} · ${esc(
          app.category || t('storeCategory'),
        )}</p>
      </div>
      <div class="result-actions">
        <a class="btn obtainium" id="addBtn" href="${esc(
          data.deepLink,
        )}">${esc(t('addObtainium'))}</a>
        <button class="btn ghost" type="button" data-copy="deep">${esc(
          t('copyDeep'),
        )}</button>
        <a class="btn ghost" id="testApk" href="${esc(
          data.apkUrl,
        )}" target="_blank" rel="noreferrer">${esc(t('testApk'))}</a>
      </div>
    </div>

    <div class="meta-grid">
      <div class="meta-item"><span>${esc(t('version'))}</span><strong>${esc(
        app.version,
      )}</strong></div>
      <div class="meta-item"><span>${esc(t('size'))}</span><strong>${esc(
        app.sizeText || t('unknown'),
      )}</strong></div>
      <div class="meta-item"><span>${esc(t('updated'))}</span><strong>${esc(
        app.updated || t('unknown'),
      )}</strong></div>
      <div class="meta-item"><span>${esc(t('sourceType'))}</span><strong>${esc(
        app.targetType === 'hash' ? t('hashSource') : t('signedSource'),
      )}</strong></div>
    </div>

    <div class="result-body">
      <aside class="qr-side">
        <img id="deepQr" alt="${esc(t('qrAlt'))}">
        <p>${esc(t('qrHint'))}</p>
      </aside>
      <div class="result-main">
        <div class="source-box">
          <span class="label">${esc(t('htmlSource'))}</span>
          <code title="${esc(data.pageUrl)}" tabindex="0">${esc(
            data.pageUrl,
          )}</code>
          <button class="icon-btn" type="button" data-copy="source">${esc(
            t('copy'),
          )}</button>
        </div>
        ${warning}
      </div>
    </div>

  `;

  el.result.hidden = false;
  $('#deepQr').src =
    data.deepQr || `/qr?data=${encodeURIComponent(data.deepLink)}`;
}

function handleCopy(kind) {
  const data = state.current;
  if (!data) return;
  if (kind === 'deep') return copyText(data.deepLink);
  if (kind === 'source') return copyText(data.pageUrl);
  return undefined;
}

async function resolve(input) {
  if (state.resolving) return;
  setActive(true);
  clearTimeout(state.searchTimer);
  if (state.searchAbort) state.searchAbort.abort();
  state.resolving = true;
  hideSuggestions();
  setLoading(true);
  setStatus(t('resolvingFirst'));

  try {
    const data = await api('/api/resolve', {
      method: 'POST',
      body: JSON.stringify({ input }),
    });
    renderResult(data);
    setStatus(t('resolved', {
      name: data.app.name,
      version: data.app.version,
    }));
    const nextUrl = new URL(location.href);
    nextUrl.searchParams.set('pkg', data.app.pkg);
    history.replaceState(null, '', nextUrl);
    if (window.innerWidth < 720) {
      el.result.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  } catch (error) {
    setStatus(errorMessage(error), 'error');
  } finally {
    state.resolving = false;
    setLoading(false);
  }
}

/* ---------------- events ---------------- */

el.form.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (state.resolving) return;

  const value = el.input.value.trim();
  if (!value) {
    setStatus(t('inputRequired'), 'error');
    el.input.focus();
    return;
  }

  setActive(true);

  if (isDirectInput(value)) {
    hideSuggestions();
    resolve(value);
    return;
  }

  if (state.suggestions.length > 0 && state.activeIndex >= 0) {
    selectSuggestion(state.activeIndex);
    return;
  }

  const apps = await runSearch(value);
  if (apps.length === 0) return;

  const exact = apps.find(
    (item) => item.name.toLowerCase() === value.toLowerCase(),
  );
  if (exact) {
    selectSuggestion(apps.indexOf(exact));
    return;
  }
  if (apps.length === 1) {
    selectSuggestion(0);
    return;
  }

  renderSuggestions(apps);
  setStatus(t('foundChoose', { count: apps.length }));
});

el.input.addEventListener('focus', () => setActive(true));

el.input.addEventListener('blur', () => {
  setTimeout(() => {
    if (!el.input.value.trim() && el.result.hidden) setActive(false);
  }, 160);
});

el.input.addEventListener('input', () => {
  const value = el.input.value.trim();
  clearTimeout(state.searchTimer);
  if (state.searchAbort) state.searchAbort.abort();
  clearTimeout(state.slowTimer);

  if (!value) {
    setActive(!el.result.hidden);
    hideSuggestions();
    setStatus('');
    return;
  }

  setActive(true);

  if (isDirectInput(value)) {
    hideSuggestions();
    setStatus(t('pressEnter'));
    return;
  }

  hideSuggestions();
  setStatus('');
  state.searchTimer = setTimeout(() => runSearch(value), 260);
});

el.input.addEventListener('keydown', (event) => {
  if (el.suggestions.hidden || state.suggestions.length === 0) return;

  if (event.key === 'ArrowDown') {
    event.preventDefault();
    moveActive(1);
  } else if (event.key === 'ArrowUp') {
    event.preventDefault();
    moveActive(-1);
  } else if (event.key === 'Enter') {
    event.preventDefault();
    selectSuggestion(state.activeIndex);
  } else if (event.key === 'Escape') {
    hideSuggestions();
  }
});

el.suggestions.addEventListener('click', (event) => {
  const button = event.target.closest('.suggestion');
  if (!button) return;
  selectSuggestion(Number(button.dataset.index));
});

document.addEventListener('click', (event) => {
  if (!event.target.closest('.search-section')) hideSuggestions();
});

el.result.addEventListener('click', (event) => {
  const trigger = event.target.closest('[data-copy]');
  if (!trigger) return;
  handleCopy(trigger.dataset.copy);
});

function renderInfo(view) {
  const title = document.getElementById('infoTitle');
  const body = document.getElementById('infoBody');
  if (!title || !body) return;
  if (view === 'how') {
    title.textContent = t('howTitle');
    body.innerHTML = `<ol>
      <li>${esc(t('howStep1'))}</li>
      <li>${esc(t('howStep2'))}</li>
      <li>${esc(t('howStep3'))}</li>
      <li>${esc(t('howStep4'))}</li>
    </ol>`;
    return;
  }
  title.textContent = t('aboutTitle');
  body.innerHTML = `<p>${esc(t('aboutP1'))}</p>
    <p>${esc(t('aboutP2'))}</p>
    <p>${esc(t('aboutP3'))}</p>`;
}

function openInfo(view) {
  state.infoView = view;
  renderInfo(view);
  const dialog = document.getElementById('infoDialog');
  if (!dialog) return;
  document.body.classList.add('modal-open');
  if (typeof dialog.showModal === 'function') {
    if (!dialog.open) dialog.showModal();
  } else {
    dialog.setAttribute('open', '');
  }
}

function closeInfo() {
  const dialog = document.getElementById('infoDialog');
  if (!dialog) return;
  if (dialog.open) dialog.close();
  else dialog.removeAttribute('open');
  document.body.classList.remove('modal-open');
}

document.querySelectorAll('[data-info]').forEach((button) => {
  button.addEventListener('click', () => openInfo(button.dataset.info));
});

document.getElementById('infoClose')?.addEventListener('click', closeInfo);
document.getElementById('infoDialog')?.addEventListener('click', (event) => {
  if (event.target === event.currentTarget) closeInfo();
});
document.getElementById('infoDialog')?.addEventListener('close', () => {
  document.body.classList.remove('modal-open');
  if (location.hash === '#about' || location.hash === '#how') {
    history.replaceState(null, '', location.pathname + location.search);
  }
});

function openInfoFromHash() {
  const view = location.hash.replace('#', '');
  if (view === 'about' || view === 'how') openInfo(view);
}

openInfoFromHash();
window.addEventListener('hashchange', openInfoFromHash);

/* ---------------- language + theme events ---------------- */

document.querySelectorAll('[data-lang]').forEach((button) => {
  button.addEventListener('click', () => applyLanguage(button.dataset.lang));
});

const themeToggle = document.getElementById('themeToggle');
themeToggle?.addEventListener('click', () => {
  applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
});

try {
  const media = matchMedia('(prefers-color-scheme: dark)');
  media.addEventListener?.('change', (event) => {
    try {
      if (localStorage.getItem(THEME_KEY)) return;
    } catch { /* ignore */ }
    applyTheme(event.matches ? 'dark' : 'light', false);
  });
} catch { /* matchMedia unavailable */ }

try {
  window.addEventListener('languagechange', () => {
    try {
      if (localStorage.getItem(LANG_KEY)) return;
    } catch { /* ignore */ }
    applyLanguage(detectLanguage(), false);
  });
} catch { /* ignore */ }

/* ---------------- boot ---------------- */

applyTheme(document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light', false);
applyLanguage(lang, false);

(async function boot() {
  const pkg = new URLSearchParams(location.search).get('pkg');
  if (pkg) {
    el.input.value = pkg;
    setActive(true);
    resolve(pkg);
  }
})();










