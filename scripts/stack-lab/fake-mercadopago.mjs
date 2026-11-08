// SIMULADOR do Mercado Pago para o stack-lab (NÃO é o provedor; não substitui a homologação com conta de teste).
// Só endpoints usados pelo Pix automático: GET /users/me, POST /v1/payments, GET /v1/payments/:id.
// Controle do teste: POST /__sim/mode/<ok|undefined-once|reject|wrong-collector>, POST /__sim/approve/<external_reference>,
// GET /__sim/state. Token aceito: o que começar com "TEST-sim-". Conta recebedora simulada: 777.
import http from "node:http";

const PORT = Number(process.env.FAKE_MP_PORT || 54400);
const payments = new Map(); // id -> payment
const byIdem = new Map(); // idempotency key -> id
let mode = "ok";
let nextId = 9000001;
const calls = [];

const json = (res, status, body) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(body)); };
const authed = (req) => /^Bearer TEST-sim-/.test(req.headers.authorization || "");

http.createServer((req, res) => {
  let raw = "";
  req.on("data", (c) => (raw += c));
  req.on("end", () => {
    const url = new URL(req.url, "http://x");
    calls.push(`${req.method} ${url.pathname}`);
    if (url.pathname.startsWith("/__sim/")) {
      const [, , action, arg] = url.pathname.split("/");
      if (action === "mode") { mode = arg; return json(res, 200, { mode }); }
      if (action === "approve") {
        const p = [...payments.values()].find((x) => x.external_reference === decodeURIComponent(arg));
        if (!p) return json(res, 404, { error: "not_found" });
        p.status = "approved"; p.status_detail = "accredited";
        return json(res, 200, { id: p.id });
      }
      if (action === "state") return json(res, 200, { mode, payments: [...payments.values()], calls });
      return json(res, 404, {});
    }
    if (!authed(req)) return json(res, 401, { message: "invalid_token" });
    if (req.method === "GET" && url.pathname === "/users/me") return json(res, 200, { id: 777, nickname: "LOJA_SIM" });
    if (req.method === "POST" && url.pathname === "/v1/payments") {
      const key = req.headers["x-idempotency-key"];
      if (mode === "reject") return json(res, 400, { message: "bad_request" });
      const body = JSON.parse(raw || "{}");
      let id = key && byIdem.get(key);
      if (!id) {
        id = nextId++;
        payments.set(id, {
          id, status: "pending", status_detail: "pending_waiting_transfer", payment_method_id: "pix",
          transaction_amount: body.transaction_amount, currency_id: "BRL", collector_id: mode === "wrong-collector" ? 999 : 777,
          external_reference: body.external_reference, date_of_expiration: body.date_of_expiration,
          point_of_interaction: { transaction_data: { qr_code: `00020126580014br.gov.bcb.pix0136sim-${id}5204000053039865802BR6304ABCD` } },
        });
        if (key) byIdem.set(key, id);
      }
      // "undefined-once": a cobrança É criada, mas a resposta se perde (502) — a próxima tentativa recebe a mesma
      if (mode === "undefined-once") { mode = "ok"; return json(res, 502, { message: "bad_gateway" }); }
      return json(res, 201, payments.get(id));
    }
    const m = /^\/v1\/payments\/(\d+)$/.exec(url.pathname);
    if (req.method === "GET" && m) {
      const p = payments.get(Number(m[1]));
      return p ? json(res, 200, p) : json(res, 404, { message: "not_found" });
    }
    return json(res, 404, { message: "not_found" });
  });
}).listen(PORT, "127.0.0.1", () => console.log(`simulador Mercado Pago em http://127.0.0.1:${PORT}`));
