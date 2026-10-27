// PUMPMATCH relay: the shared request handling for the Node dev server and the Worker.
import { Feed, PUMP, fetchMeta, devHistory } from "./core.js"

export function createRelay({ rpcUrl, openSocket, log = () => {} }) {
  const feed = new Feed()
  let sol = 0, solAt = 0, live = false, lastMsg = 0
  const devCache = new Map()

  async function rpc(method, params) {
    for (let i = 0; i < 4; i++) {
      try {
        const r = await fetch(rpcUrl, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) })
        if (r.status === 429) { await new Promise((ok) => setTimeout(ok, 500 * (i + 1))); continue }
        const j = await r.json(); if (j.error) throw new Error(j.error.message); return j.result
      } catch (e) { if (i === 3) throw e }
    }
  }
  function connect() {
    openSocket((ws) => {
      ws.send(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "logsSubscribe", params: [{ mentions: [PUMP] }, { commitment: "confirmed" }] }))
      live = true
    }, (data) => {
      lastMsg = Date.now()
      let j; try { j = JSON.parse(data) } catch { return }
      const v = j?.params?.result?.value
      if (v && !v.err && v.logs) feed.onLogs(v.logs, j.params.result.context?.slot || 0)
    }, () => { live = false })
  }
  async function tick() {
    feed.prune()
    await Promise.all(feed.wantMeta(6).map(fetchMeta))
    if (Date.now() - solAt > 60_000) {
      try { const p = +(await (await fetch("https://api.coinbase.com/v2/prices/SOL-USD/spot")).json()).data.amount; if (p > 0) { sol = p; solAt = Date.now() } } catch {}
    }
  }
  // a dev's launches and how each one is doing now (DexScreener: a pump.fun pair = still on the curve, a pool = graduated)
  async function dev(wallet) {
    const hit = devCache.get(wallet); if (hit && Date.now() - hit.at < 10 * 60_000) return hit.body
    const h = await devHistory(rpc, wallet, 120)
    const mints = h.launches.slice(0, 30).map((x) => x.mint)
    const pairs = mints.length ? await (await fetch("https://api.dexscreener.com/tokens/v1/solana/" + mints.join(","))).json().catch(() => []) : []
    const byMint = new Map(); for (const p of Array.isArray(pairs) ? pairs : []) { const m = p.baseToken?.address; if (m && (!byMint.has(m) || (p.liquidity?.usd || 0) > (byMint.get(m).liquidity?.usd || 0))) byMint.set(m, p) }
    const launches = h.launches.slice(0, 30).map((x) => {
      const p = byMint.get(x.mint), live = feed.coins.get(x.mint)
      const grad = p ? p.dexId !== "pumpfun" : !!live?.done
      const mcUsd = p ? p.marketCap || p.fdv || 0 : 0
      return { ...x, grad, mcUsd: Math.round(mcUsd), dead: !grad && mcUsd < 6000 && Date.now() - x.t > 3600_000 }
    })
    const body = { wallet, scanned: h.scanned, count: launches.length, grads: launches.filter((x) => x.grad).length, dead: launches.filter((x) => x.dead).length, launches }
    devCache.set(wallet, { at: Date.now(), body }); if (devCache.size > 500) devCache.delete(devCache.keys().next().value)
    return body
  }
  async function handle(url) {
    const u = new URL(url), json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json", "cache-control": "no-store", "access-control-allow-origin": "*" } })
    if (u.pathname === "/v1/deck") return json({ now: Date.now(), live, sol, coins: feed.deck(+(u.searchParams.get("n") || 60)) })
    if (u.pathname === "/v1/coin") { const c = feed.coins.get(u.searchParams.get("mint") || ""); return c ? json(feed.view(c)) : json({ error: "unknown" }, 404) }
    if (u.pathname === "/v1/dev") { const w = u.searchParams.get("wallet") || ""; if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(w)) return json({ error: "bad wallet" }, 400); try { return json(await dev(w)) } catch (e) { return json({ error: String(e.message || e) }, 502) } }
    if (u.pathname === "/v1/status") return json({ live, lastMsg, events: feed.events, coins: feed.coins.size, sol })
    return json({ ok: true })
  }
  return { connect, tick, handle, feed, get live() { return live }, get lastMsg() { return lastMsg } }
}
