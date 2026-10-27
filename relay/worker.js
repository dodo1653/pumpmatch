// PUMPMATCH relay on Cloudflare: one Durable Object keeps the pump.fun log stream open (RPC_URL secret = a Helius
// or other RPC that accepts Workers; Solana's public endpoint refuses them) and serves /v1/deck, /v1/coin, /v1/dev.
import { DurableObject } from "cloudflare:workers"
import { createRelay } from "./server.js"

const IDLE_MS = 20 * 60_000, TICK_MS = 2000

export default {
  async fetch(req, env) { return env.RELAY.get(env.RELAY.idFromName("pumpmatch-1")).fetch(req) },
}

export class Relay extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env)
    this.lastReq = 0; this.ws = null
    this.relay = createRelay({
      rpcUrl: env.RPC_URL,
      openSocket: (onOpen, onMsg, onClose) => {
        if (this.ws) return
        this.ws = "connecting"
        ;(async () => {
          try {
            const resp = await fetch(env.RPC_URL, { headers: { Upgrade: "websocket" } })
            const ws = resp.webSocket; if (!ws) throw new Error("no websocket " + resp.status)
            ws.accept()
            ws.addEventListener("message", (e) => onMsg(typeof e.data === "string" ? e.data : new TextDecoder().decode(e.data)))
            const drop = () => { if (this.ws === ws) { this.ws = null; onClose() } }
            ws.addEventListener("close", drop); ws.addEventListener("error", drop)
            this.ws = ws; onOpen(ws)
          } catch (e) { console.log("connect failed", String(e)); this.ws = null }
        })()
      },
    })
  }
  async alarm() {
    if (Date.now() - this.lastReq > IDLE_MS) { try { if (this.ws && this.ws !== "connecting") this.ws.close() } catch {}; this.ws = null; return }
    if (this.ws && this.ws !== "connecting" && Date.now() - this.relay.lastMsg > 30_000) { try { this.ws.close() } catch {}; this.ws = null }
    if (!this.ws) this.relay.connect()
    await this.relay.tick()
    await this.ctx.storage.setAlarm(Date.now() + TICK_MS)
  }
  async fetch(req) {
    this.lastReq = Date.now()
    if (!this.ws) this.relay.connect()
    if ((await this.ctx.storage.getAlarm()) == null) await this.ctx.storage.setAlarm(Date.now() + 500)
    return this.relay.handle(req.url)
  }
}
