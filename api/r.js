// Same-origin proxy to the relay (Vercel edge). The CDN caches each answer briefly, so the relay sees a handful of
// requests a second however many people are swiping.
export const config = { runtime: 'edge' }
const RELAY = 'https://pumpmatch-relay.trenchcounty.workers.dev/v1/'
const TTL = { deck: 2, coin: 2, dev: 300 }
export default async function handler(req) {
  const u = new URL(req.url), path = u.searchParams.get('path')
  if (!TTL[path]) return new Response('{"error":"unknown"}', { status: 404, headers: { 'content-type': 'application/json' } })
  u.searchParams.delete('path')
  const r = await fetch(RELAY + path + '?' + u.searchParams.toString(), { cache: 'no-store' })
  return new Response(r.body, { status: r.status, headers: { 'content-type': 'application/json', 'cache-control': `public, s-maxage=${TTL[path]}, stale-while-revalidate=${TTL[path] * 2}` } })
}
