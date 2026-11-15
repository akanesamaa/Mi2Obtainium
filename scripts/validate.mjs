const base = 'http://127.0.0.1:8787';
const pkg = process.argv[2] || 'tv.danmaku.bili';
const res = await fetch(`${base}/api/resolve`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ input: pkg }),
});
const data = await res.json();
if (!data.ok) {
  console.error(data);
  process.exit(1);
}

const prefix = 'obtainium://app/';
if (!data.deepLink.startsWith(prefix)) throw new Error('bad prefix');
const raw = decodeURIComponent(data.deepLink.slice(prefix.length));
const config = JSON.parse(raw);

console.log('config keys:', Object.keys(config).join(', '));
console.log('id:', config.id);
console.log('url:', config.url);
console.log('name:', config.name);
console.log('author:', config.author);
console.log('latestVersion:', config.latestVersion);
console.log('overrideSource:', config.overrideSource);

const settings = JSON.parse(config.additionalSettings);
console.log('settings:', settings);
const apkUrls = JSON.parse(config.apkUrls);
console.log('apkUrls:', apkUrls);

const checks = [
  ['id === pkg', config.id === pkg],
  ['url points at /o/', config.url.includes(`/o/${encodeURIComponent(pkg)}`)],
  ['overrideSource HTML', config.overrideSource === 'HTML'],
  ['settings regex', settings.versionExtractionRegEx === '([^/]+)\\.apk'],
  ['settings matchGroup', settings.matchGroupToUse === '$1'],
  ['apk urls array', Array.isArray(apkUrls) && apkUrls.length === 1 && apkUrls[0][1].endsWith('.apk')],
  ['version from link', apkUrls[0][1].match(/([^/]+)\.apk/)?.[1] === data.app.version],
];
for (const [name, ok] of checks) console.log(ok ? 'OK  ' : 'FAIL', name);
if (checks.some(([, ok]) => !ok)) process.exit(1);
