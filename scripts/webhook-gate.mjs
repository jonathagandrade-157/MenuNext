// "Porteiro" do webhook: o UNICO ponto que um tunel publico deve apontar.
// Encaminha somente POST /api/webhooks/asaas para o Next local; todo o resto da aplicacao
// (painel, login, cron, paginas) fica inacessivel pela internet.
//   - corpo maximo de 64 KB; sem corpo > 64 KB nem chunked infinito
//   - 60 requisicoes por minuto no total (descarta o excesso com 429)
//   - nunca registra cabecalhos nem corpo (nao ha como vazar o token nos logs)
import http from "node:http";

const LISTEN = Number(process.env.GATE_PORT ?? 3100);
const NEXT = Number(process.env.NEXT_PORT ?? 3000);
const MAX_BODY = 64 * 1024;
const PER_MINUTE = 60;

let windowStart = Date.now();
let count = 0;
const stats = { ok: 0, notFound: 0, tooBig: 0, limited: 0 };

const server = http.createServer((req, res) => {
  const now = Date.now();
  if (now - windowStart > 60_000) { windowStart = now; count = 0; }
  if (++count > PER_MINUTE) { stats.limited++; res.writeHead(429); return res.end(); }

  const url = (req.url ?? "").split("?")[0];
  if (req.method !== "POST" || url !== "/api/webhooks/asaas") {
    stats.notFound++;
    res.writeHead(404);
    return res.end();
  }
  const declared = Number(req.headers["content-length"] ?? 0);
  if (declared > MAX_BODY) { stats.tooBig++; res.writeHead(413); return res.end(); }

  const chunks = [];
  let size = 0;
  let aborted = false;
  req.on("data", (c) => {
    size += c.length;
    if (size > MAX_BODY && !aborted) { aborted = true; stats.tooBig++; res.writeHead(413); res.end(); req.destroy(); return; }
    chunks.push(c);
  });
  req.on("end", () => {
    if (aborted) return;
    const body = Buffer.concat(chunks);
    const upstream = http.request(
      { host: "127.0.0.1", port: NEXT, method: "POST", path: "/api/webhooks/asaas",
        headers: { "content-type": req.headers["content-type"] ?? "application/json", "content-length": body.length,
                   ...(req.headers["asaas-access-token"] ? { "asaas-access-token": req.headers["asaas-access-token"] } : {}) } },
      (ur) => { stats.ok++; res.writeHead(ur.statusCode ?? 502, { "content-type": ur.headers["content-type"] ?? "application/json" }); ur.pipe(res); }
    );
    upstream.on("error", () => { res.writeHead(502); res.end(); });
    upstream.end(body);
  });
});

server.listen(LISTEN, "127.0.0.1", () => console.log(`porteiro do webhook em http://127.0.0.1:${LISTEN} -> Next :${NEXT} (somente POST /api/webhooks/asaas)`));
process.on("SIGINT", () => { console.log(JSON.stringify(stats)); process.exit(0); });
