/**
 * Asaas SIMULADO, só para ensaio local: servidor HTTP que imita os endpoints de
 * assinatura/cobrança que o MenuNext usa e entrega webhooks no formato documentado.
 * Existe para ensaiar o backend real (Next.js + banco isolado) antes do Sandbox.
 * Nunca é carregado pela aplicação; só pelo teste de integração.
 */
import http from "node:http";

export type FakePayment = {
  id: string;
  customer: string;
  subscription: string;
  value: number;
  status: string;
  dueDate: string;
  paymentDate: string | null;
  deleted: boolean;
};

export type FakeSubscription = {
  id: string;
  customer: string;
  value: number;
  status: "ACTIVE" | "INACTIVE" | "EXPIRED";
  externalReference: string | null;
  deleted: boolean;
  nextDueDate: string;
};

const pad = (n: number) => String(n).padStart(2, "0");
/** "YYYY-MM-DD HH:mm:ss" no horário de Brasília, como o Asaas envia em dateCreated. */
export function brasiliaNow(offsetSeconds = 0): string {
  const d = new Date(Date.now() - 3 * 3600_000 + offsetSeconds * 1000);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
}
export const isoDate = (offsetDays = 0) => new Date(Date.now() + offsetDays * 86_400_000).toISOString().slice(0, 10);

export class FakeAsaas {
  customers = new Map<string, { id: string; name: string; cpfCnpj: string }>();
  subscriptions = new Map<string, FakeSubscription>();
  payments = new Map<string, FakePayment>();
  /** Alterações aplicadas às respostas de GET /subscriptions/:id (simula divergência). */
  tamper: Partial<FakeSubscription> | null = null;
  /** Quando true, toda chamada falha com 503 (Asaas fora do ar). */
  down = false;
  /** Quando true, as ações feitas pela API (receber, estornar, cancelar) entregam o webhook sozinhas, como o Asaas. */
  autoWebhook = false;
  requests: { method: string; path: string }[] = [];

  private server: http.Server | null = null;
  private seq = 0;
  private eventSeq = 0;

  constructor(
    private readonly apiKey: string,
    private readonly webhookUrl: string,
    private readonly webhookToken: string
  ) {}

  async start(port: number): Promise<void> {
    this.server = http.createServer((req, res) => void this.handle(req, res));
    await new Promise<void>((resolve) => this.server!.listen(port, "127.0.0.1", resolve));
  }

  async stop(): Promise<void> {
    await new Promise<void>((resolve) => (this.server ? this.server.close(() => resolve()) : resolve()));
  }

  private id(prefix: string): string {
    this.seq += 1;
    return `${prefix}_fake${String(this.seq).padStart(8, "0")}`;
  }

  private json(res: http.ServerResponse, status: number, body: unknown) {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(body));
  }

  private async handle(req: http.IncomingMessage, res: http.ServerResponse) {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const path = url.pathname.replace(/^\/v3/, "");
    this.requests.push({ method: req.method ?? "GET", path });
    if (this.down) return this.json(res, 503, { errors: [{ description: "indisponivel" }] });
    if (req.headers["access_token"] !== this.apiKey) return this.json(res, 401, { errors: [{ description: "chave invalida" }] });

    let body: Record<string, unknown> = {};
    if (req.method === "POST") {
      const chunks: Buffer[] = [];
      for await (const c of req) chunks.push(c as Buffer);
      try {
        body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
      } catch {
        return this.json(res, 400, { errors: [{ description: "json invalido" }] });
      }
    }

    const actionMatch = /^\/payments\/([^/]+)\/(receiveInCash|refund)$/.exec(path);
    if (req.method === "POST" && actionMatch) {
      const p = this.payments.get(actionMatch[1]);
      if (!p) return this.json(res, 404, { errors: [{ description: "nao encontrada" }] });
      if (actionMatch[2] === "receiveInCash") {
        p.status = "RECEIVED_IN_CASH";
        p.paymentDate = typeof body.paymentDate === "string" ? body.paymentDate : isoDate();
        this.json(res, 200, p);
        this.later(() => this.sendPaymentEvent("PAYMENT_RECEIVED", p));
      } else {
        p.status = "REFUNDED";
        this.json(res, 200, p);
        this.later(() => this.sendPaymentEvent("PAYMENT_REFUNDED", p));
      }
      return;
    }

    if (req.method === "POST" && path === "/customers") {
      const customer = { id: this.id("cus"), name: String(body.name), cpfCnpj: String(body.cpfCnpj) };
      this.customers.set(customer.id, customer);
      return this.json(res, 200, customer);
    }

    if (req.method === "POST" && path === "/subscriptions") {
      const sub: FakeSubscription = {
        id: this.id("sub"),
        customer: String(body.customer),
        value: Number(body.value),
        status: "ACTIVE",
        externalReference: typeof body.externalReference === "string" ? body.externalReference : null,
        deleted: false,
        nextDueDate: String(body.nextDueDate),
      };
      if (!this.customers.has(sub.customer)) return this.json(res, 400, { errors: [{ description: "cliente invalido" }] });
      this.subscriptions.set(sub.id, sub);
      // Como o Asaas: a primeira cobranca da assinatura ja nasce (pendente).
      const first = this.newPayment(sub, sub.nextDueDate);
      this.json(res, 200, sub);
      // O Asaas avisa a cobranca criada (pode chegar antes de o MenuNext registrar a assinatura).
      this.later(() => this.sendPaymentEvent("PAYMENT_CREATED", first));
      return;
    }

    if (req.method === "GET" && path === "/subscriptions") {
      const ref = url.searchParams.get("externalReference");
      const customer = url.searchParams.get("customer");
      const list = [...this.subscriptions.values()].filter(
        (s) => !s.deleted && (!ref || s.externalReference === ref) && (!customer || s.customer === customer)
      );
      return this.json(res, 200, { object: "list", hasMore: false, totalCount: list.length, limit: 10, offset: 0, data: list });
    }

    const subMatch = /^\/subscriptions\/([^/]+)(\/payments)?$/.exec(path);
    if (subMatch) {
      const sub = this.subscriptions.get(subMatch[1]);
      if (!sub) return this.json(res, 404, { errors: [{ description: "nao encontrada" }] });
      if (req.method === "GET" && !subMatch[2]) return this.json(res, 200, { ...sub, ...(this.tamper ?? {}) });
      if (req.method === "DELETE" && !subMatch[2]) {
        sub.deleted = true;
        sub.status = "INACTIVE";
        this.json(res, 200, { deleted: true, id: sub.id });
        this.later(() => this.sendSubscriptionEvent("SUBSCRIPTION_DELETED", sub));
        return;
      }
      if (req.method === "GET" && subMatch[2]) {
        const offset = Number(url.searchParams.get("offset") ?? 0);
        const limit = Math.min(Number(url.searchParams.get("limit") ?? 10), 100);
        const all = [...this.payments.values()].filter((p) => p.subscription === sub.id);
        const data = all.slice(offset, offset + limit);
        return this.json(res, 200, { object: "list", hasMore: offset + limit < all.length, totalCount: all.length, limit, offset, data });
      }
    }

    const payMatch = /^\/payments\/([^/]+)$/.exec(path);
    if (req.method === "GET" && payMatch) {
      const p = this.payments.get(payMatch[1]);
      return p ? this.json(res, 200, p) : this.json(res, 404, { errors: [{ description: "nao encontrada" }] });
    }

    return this.json(res, 404, { errors: [{ description: "rota desconhecida" }] });
  }

  /** Entrega o webhook depois de responder à chamada, como o Asaas (só com autoWebhook). */
  private later(fn: () => Promise<unknown>) {
    if (!this.autoWebhook) return;
    setTimeout(() => void fn().catch(() => undefined), 300);
  }

  // ----- controle do ensaio (equivale a agir no painel do Asaas) -----

  newPayment(sub: FakeSubscription, dueDate: string, value = sub.value): FakePayment {
    const payment: FakePayment = {
      id: this.id("pay"),
      customer: sub.customer,
      subscription: sub.id,
      value,
      status: "PENDING",
      dueDate,
      paymentDate: null,
      deleted: false,
    };
    this.payments.set(payment.id, payment);
    return payment;
  }

  firstPayment(subId: string): FakePayment {
    return [...this.payments.values()].find((p) => p.subscription === subId)!;
  }

  setPayment(id: string, patch: Partial<FakePayment>): FakePayment {
    const p = this.payments.get(id)!;
    Object.assign(p, patch);
    return p;
  }

  /** Entrega um evento de COBRANÇA ao webhook do MenuNext, como o Asaas faria. */
  async sendPaymentEvent(event: string, payment: FakePayment, opts: { token?: string | null; eventId?: string; dateCreated?: string } = {}) {
    return this.post(
      {
        id: opts.eventId ?? this.nextEventId(),
        event,
        dateCreated: opts.dateCreated ?? brasiliaNow(),
        account: { id: "acc_fake", ownerId: null },
        payment: { ...payment, object: "payment" },
      },
      opts.token
    );
  }

  async sendSubscriptionEvent(event: string, sub: FakeSubscription, opts: { token?: string | null; eventId?: string } = {}) {
    return this.post(
      {
        id: opts.eventId ?? this.nextEventId(),
        event,
        dateCreated: brasiliaNow(),
        account: { id: "acc_fake", ownerId: null },
        subscription: { ...sub, object: "subscription" },
      },
      opts.token
    );
  }

  nextEventId(): string {
    this.eventSeq += 1;
    return `evt_fake${String(this.eventSeq).padStart(8, "0")}`;
  }

  private async post(payload: unknown, token: string | null | undefined) {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    const t = token === undefined ? this.webhookToken : token;
    if (t !== null) headers["asaas-access-token"] = t;
    const response = await fetch(this.webhookUrl, { method: "POST", headers, body: JSON.stringify(payload) });
    let json: Record<string, unknown> | null = null;
    try {
      json = (await response.json()) as Record<string, unknown>;
    } catch {
      json = null;
    }
    return { status: response.status, body: json };
  }
}
