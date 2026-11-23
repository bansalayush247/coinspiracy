// The HTML for a 1200×630 share card; scripts/render-og.ts screenshots it.
import { OG_HEIGHT, OG_WIDTH, SITE_NAME } from './site.js';

export interface OgCard {
  readonly slug: string;
  readonly eyebrow: string;
  readonly title: string;
  readonly subtitle: string;
}

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => `&#${String(c.charCodeAt(0))};`);
}

export function ogFileName(slug: string): string {
  if (!/^[a-z0-9-]+$/.test(slug)) throw new Error(`invalid OG slug: ${slug}`);
  return `${slug}.png`;
}

export function ogCardHtml(card: OgCard, logoSvg: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
*{box-sizing:border-box;margin:0}
body{width:${String(OG_WIDTH)}px;height:${String(OG_HEIGHT)}px;font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;
background:linear-gradient(160deg,#6a62b0 0%,#d9849a 40%,#ffae7e 70%,#ffd59a 100%);color:#2a1a33;padding:64px 72px;display:flex;flex-direction:column}
.brand{display:flex;align-items:center;gap:16px;font-size:30px;font-weight:700}
.brand svg{width:52px;height:52px}
.panel{margin-top:auto;background:rgba(34,22,48,.86);color:#fff1de;border-radius:28px;padding:44px 52px;border:2px solid rgba(255,224,190,.25)}
.eyebrow{color:#ffd27a;font-size:24px;font-weight:700;letter-spacing:.12em;text-transform:uppercase}
h1{font-size:64px;line-height:1.08;margin-top:14px;letter-spacing:-.01em}
p{font-size:28px;color:#e2cfd6;margin-top:18px;line-height:1.35}
</style></head><body>
<div class="brand">${logoSvg}<span>${escapeHtml(SITE_NAME)}</span></div>
<div class="panel"><div class="eyebrow">${escapeHtml(card.eyebrow)}</div><h1>${escapeHtml(card.title)}</h1><p>${escapeHtml(card.subtitle)}</p></div>
</body></html>`;
}
