import QRCode from 'qrcode';

const cache = new Map();
const MAX = 64;

export async function qrDataUri(text, size = 240) {
  const key = `${size}:${text}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.t < 60 * 60 * 1000) return hit.uri;

  const svg = await QRCode.toString(text, {
    type: 'svg',
    margin: 1,
    width: size,
    errorCorrectionLevel: 'M',
    color: { dark: '#1b120c', light: '#ffffff' },
  });
  const uri = `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
  cache.set(key, { t: Date.now(), uri });
  if (cache.size > MAX) {
    const oldest = [...cache.entries()]
      .sort((a, b) => a[1].t - b[1].t)
      .slice(0, 12);
    for (const [oldKey] of oldest) cache.delete(oldKey);
  }
  return uri;
}
