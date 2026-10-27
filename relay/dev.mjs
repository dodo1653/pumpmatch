// Local relay for building the app: node relay/dev.mjs  ->  http://127.0.0.1:8790/v1/deck
import http from "node:http"
import { createRelay } from "./server.js"

const RPC = process.env.RPC_URL || "https://api.mainnet-beta.solana.com"
const relay = createRelay({
  rpcUrl: RPC,
  openSocket(onOpen, onMsg, onClose) {
    const ws = new WebSocket(RPC.replace(/^http/, "ws"))
    ws.onopen = () => onOpen(ws)
    ws.onmessage = (e) => onMsg(String(e.data))
    ws.onclose = () => { onClose(); setTimeout(() => relay.connect(), 2000) }
  },
})
relay.connect()
setInterval(() => relay.tick(), 2000)
http.createServer(async (req, res) => {
  const r = await relay.handle("http://local" + req.url)
  res.writeHead(r.status, Object.fromEntries(r.headers)); res.end(await r.text())
}).listen(8790, "127.0.0.1", () => console.log("pumpmatch dev relay on http://127.0.0.1:8790/v1/deck"))
