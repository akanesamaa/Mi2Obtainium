import { appApkPath, directApkUrl } from './xiaomi.js';

export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => {
    switch (ch) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      case "'":
        return '&#39;';
      default:
        return ch;
    }
  });
}

export function pageUrl(app, baseUrl) {
  return `${baseUrl}/o/${encodeURIComponent(app.pkg)}`;
}

function isDirect(app) {
  return app.targetType === 'hash' && !!app.apkHash;
}

export function apkUrl(app, baseUrl) {
  return directApkUrl(app) || proxyUrl(app, baseUrl);
}

export function proxyUrl(app, baseUrl) {
  return `${baseUrl}${appApkPath(app)}`;
}

/**
 * Full app config in Obtainium's export/import shape.
 * "additionalSettings" and "apkUrls" are JSON strings on purpose: that is how
 * Obtainium serializes them, and obtainium://app/<json> reuses the same parser.
 */
export function buildConfig(app, baseUrl) {
  const settings = {
    versionExtractionRegEx: '([^/]+)\\.apk',
    matchGroupToUse: '$1',
    versionDetection: true,
    autoApkFilterByArch: false,
    // Direct CDN links stay valid after the check, so Obtainium can download
    // an already-detected update even while the PC is off. Signed links must
    // be refreshed through the local proxy.
    refreshBeforeDownload: !isDirect(app),
  };

  return {
    id: app.pkg,
    url: pageUrl(app, baseUrl),
    author: app.author || '小米应用商店',
    name: app.name || app.pkg,
    latestVersion: app.version,
    apkUrls: JSON.stringify([
      [`${app.pkg}-${app.version}.apk`, apkUrl(app, baseUrl)],
    ]),
    preferredApkIndex: 0,
    additionalSettings: JSON.stringify(settings),
    overrideSource: 'HTML',
  };
}

export function buildDeepLink(app, baseUrl) {
  return `obtainium://app/${encodeURIComponent(
    JSON.stringify(buildConfig(app, baseUrl)),
  )}`;
}

export function buildManual(app, baseUrl) {
  return {
    provider: 'Obtainium',
    source: 'HTML',
    sourceIdentifier: 'HTML',
    url: pageUrl(app, baseUrl),
    downloadUrl: apkUrl(app, baseUrl),
    versionExtractionRegEx: '([^/]+)\\.apk',
    matchGroupToUse: '$1',
    note:
      '在 Obtainium 里手动添加时：来源选 HTML，把页面地址填进 URL，版本正则填第一行，匹配组填 $1。',
  };
}

/** Tiny page that Obtainium's HTML source parses. Keep exactly one .apk link. */
export function renderObtainiumPage(app, baseUrl) {
  const href = directApkUrl(app) || appApkPath(app);
  const absoluteApk = apkUrl(app, baseUrl);
  const title = `${app.name} ${app.version} - 小米应用商店`;
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="x-mi-package" content="${escapeHtml(app.pkg)}">
<meta name="x-mi-version" content="${escapeHtml(app.version)}">
<meta name="x-mi-updated" content="${escapeHtml(app.updated)}">
<title>${escapeHtml(title)}</title>
<link rel="icon" href="data:,">
</head>
<body>
<main>
  <h1 id="app-name">${escapeHtml(app.name)}</h1>
  <p id="app-version">版本：${escapeHtml(app.version)}</p>
  <p id="app-package">包名：${escapeHtml(app.pkg)}</p>
  <p id="app-updated">更新日期：${escapeHtml(app.updated)}</p>
  <p id="app-developer">开发者：${escapeHtml(app.author)}</p>
  <p id="app-size">大小：${escapeHtml(app.sizeText)}</p>
  <p><a id="download" class="apk" href="${escapeHtml(
    href,
  )}">下载 APK</a></p>
  <p id="apk-direct" hidden>${escapeHtml(absoluteApk)}</p>
</main>
</body>
</html>`;
}

