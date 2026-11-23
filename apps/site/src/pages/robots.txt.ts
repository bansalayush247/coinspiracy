import type { APIRoute } from 'astro';

export const GET: APIRoute = ({ site }) => {
  if (site === undefined) throw new Error('site is not configured');
  const body = ['User-agent: *', 'Allow: /', '', `Sitemap: ${new URL('/sitemap-index.xml', site).href}`, ''].join('\n');
  return new Response(body, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
};
