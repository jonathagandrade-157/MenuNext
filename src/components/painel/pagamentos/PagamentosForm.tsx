"use client";

import { useActionState, useEffect, useState } from "react";
import { useFormStatus } from "react-dom";
import { Banknote, CircleCheck, CreditCard, QrCode, Wallet, type LucideIcon } from "lucide-react";
import { savePagamentosConfigAction } from "@/lib/actions/pagamentos";
import { initialPagamentosState } from "@/lib/form-state";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { CopyButton } from "@/components/loja/CopyButton";
import { generatePixQrCodeDataUrl } from "@/lib/qrcode";
import { generatePixBrCode, PIX_KEY_TYPE_LABEL, type PixKeyType } from "@/lib/pix";
import type { Restaurant } from "@/lib/tenant";

const inputClass =
  "h-11 w-full rounded-xl border border-border bg-surface-card px-3 text-body-md text-graphite placeholder:text-slate-400 focus:border-primary focus:outline-none focus:ring-[3px] focus:ring-primary/15";

const fieldLabelClass = "mb-1.5 block text-label-lg text-graphite";

function SaveButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="lg" className="w-full sm:w-auto" loading={pending} disabled={pending}>
      {pending ? "Salvando..." : "Salvar formas de pagamento"}
    </Button>
  );
}

function StatTile({ label, value, icon: Icon, tint }: { label: string; value: string | number; icon: LucideIcon; tint: string }) {
  return (
    <Card className="flex items-center gap-3 p-4">
      <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${tint}`}>
        <Icon className="h-5 w-5" aria-hidden />
      </span>
      <div className="min-w-0">
        <p className="truncate text-label-sm uppercase text-text-muted">{label}</p>
        <p className="text-headline-md text-graphite">{value}</p>
      </div>
    </Card>
  );
}

function MethodIcon({ icon: Icon, tint }: { icon: LucideIcon; tint: string }) {
  return (
    <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${tint}`}>
      <Icon className="h-5 w-5" aria-hidden />
    </span>
  );
}

function PixQrCodePreview({ pixKey, holderName, city }: { pixKey: string; holderName: string; city: string }) {
  const [qrCodeDataUrl, setQrCodeDataUrl] = useState<string | null>(null);

  const brCode = pixKey && holderName && city ? generatePixBrCode({ pixKey, merchantName: holderName, merchantCity: city }) : null;

  useEffect(() => {
    if (!brCode) return;
    let cancelled = false;
    generatePixQrCodeDataUrl(brCode).then((dataUrl) => {
      if (!cancelled) setQrCodeDataUrl(dataUrl);
    });
    return () => {
      cancelled = true;
    };
  }, [brCode]);

  if (!brCode) {
    return (
      <p className="text-body-sm text-text-muted">
        Preencha a chave, o nome do titular e a cidade para gerar o QR Code Pix.
      </p>
    );
  }

  return (
    <div className="flex flex-col items-center gap-3 rounded-xl border border-border bg-surface-subdued p-5">
      {qrCodeDataUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- data URL local, sem imagem remota
        <img src={qrCodeDataUrl} alt="QR Code Pix" className="h-40 w-40 rounded-lg" />
      ) : (
        <div className="h-40 w-40 animate-pulse rounded-lg bg-surface-card" />
      )}
      <p className="text-center text-label-md text-text-muted">Cliente escaneia pelo app do banco para pagamento imediato</p>
      <div className="flex w-full items-center gap-2 rounded-lg border border-border bg-surface-card px-3 py-2">
        <p className="min-w-0 flex-1 truncate text-xs text-graphite">{brCode}</p>
        <CopyButton value={brCode} label="Copiar código" />
      </div>
      <p className="text-center text-[11px] text-text-muted">
        QR sem valor fixo — o cliente digita o valor a pagar no app do banco.
      </p>
    </div>
  );
}

/**
 * Mesma UI de formas de pagamento do Passo 6 do onboarding (Passo6Form), sem
 * o rodapé de navegação de etapa — aqui é só "Salvar", e salvar mantém o
 * lojista em /painel/pagamentos.
 */
export function PagamentosForm({ restaurant }: { restaurant: Restaurant }) {
  const [state, formAction] = useActionState(savePagamentosConfigAction, initialPagamentosState);
  const [pixEnabled, setPixEnabled] = useState(restaurant.payment_pix);
  const [pixKeyType, setPixKeyType] = useState<PixKeyType | null>(restaurant.payment_pix_key_type);
  const [pixKey, setPixKey] = useState(restaurant.payment_pix_key ?? "");
  const [holderName, setHolderName] = useState(restaurant.payment_pix_holder_name ?? "");
  const [city, setCity] = useState(restaurant.payment_pix_city ?? "");

  const activeMethodsCount = [restaurant.payment_pix, restaurant.payment_cash, restaurant.payment_card].filter(Boolean).length;
  const otherMethodsLabel =
    [restaurant.payment_cash && "Dinheiro", restaurant.payment_card && "Cartão"].filter(Boolean).join(" · ") || "Nenhum";

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <StatTile label="Métodos ativos" value={activeMethodsCount} icon={CircleCheck} tint="bg-emerald/10 text-emerald" />
        <StatTile label="Pix" value={restaurant.payment_pix ? "Ativo" : "Inativo"} icon={QrCode} tint="bg-primary/10 text-primary" />
        <StatTile label="Dinheiro / Cartão" value={otherMethodsLabel} icon={Wallet} tint="bg-blue/10 text-blue" />
      </div>

      <form action={formAction} className="space-y-4">
        <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-border bg-surface-card p-4 has-[:checked]:border-primary has-[:checked]:bg-primary/5">
          <input
            type="checkbox"
            name="payment_pix"
            checked={pixEnabled}
            onChange={(e) => setPixEnabled(e.target.checked)}
            className="mt-2.5 h-5 w-5 accent-primary"
          />
          <MethodIcon icon={QrCode} tint="bg-emerald/10 text-emerald" />
          <span className="min-w-0 flex-1">
            <span className="block text-body-lg font-bold text-graphite">Pix</span>
            <span className="block text-body-sm text-text-muted">O cliente paga direto na sua chave Pix, sem taxa e sem intermediário.</span>
            {pixEnabled && (
              <div className="mt-4 space-y-4">
                <div>
                  <span className={fieldLabelClass}>Tipo de chave</span>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    {(Object.entries(PIX_KEY_TYPE_LABEL) as [PixKeyType, string][]).map(([value, label]) => (
                      <label
                        key={value}
                        className={`flex cursor-pointer items-center justify-center rounded-lg border px-2 py-2 text-label-md ${
                          pixKeyType === value ? "border-primary bg-primary/5 text-primary" : "border-border text-text-muted"
                        }`}
                      >
                        <input
                          type="radio"
                          name="payment_pix_key_type"
                          value={value}
                          checked={pixKeyType === value}
                          onChange={() => setPixKeyType(value)}
                          className="sr-only"
                        />
                        {label}
                      </label>
                    ))}
                  </div>
                </div>

                <div>
                  <span className={fieldLabelClass}>Chave Pix do restaurante *</span>
                  <input
                    name="payment_pix_key"
                    type="text"
                    value={pixKey}
                    onChange={(e) => setPixKey(e.target.value)}
                    placeholder="CPF, CNPJ, e-mail, telefone ou chave aleatória"
                    className={inputClass}
                  />
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <span className={fieldLabelClass}>Nome do titular / recebedor *</span>
                    <input
                      name="payment_pix_holder_name"
                      type="text"
                      value={holderName}
                      onChange={(e) => setHolderName(e.target.value)}
                      placeholder="Exibido no comprovante do cliente"
                      className={inputClass}
                    />
                  </div>
                  <div>
                    <span className={fieldLabelClass}>Cidade da conta bancária *</span>
                    <input
                      name="payment_pix_city"
                      type="text"
                      value={city}
                      onChange={(e) => setCity(e.target.value)}
                      placeholder="Exigido pela especificação do Banco Central"
                      className={inputClass}
                    />
                  </div>
                </div>

                <div>
                  <span className={fieldLabelClass}>QR Code Pix</span>
                  <PixQrCodePreview pixKey={pixKey} holderName={holderName} city={city} />
                </div>

                <div className="rounded-lg border border-border bg-surface-subdued/60 px-3.5 py-2.5">
                  <p className="text-label-md text-graphite">Modo de confirmação: manual</p>
                  <p className="mt-0.5 text-xs text-text-muted">
                    Você confere o Pix no extrato/app do banco e avança o pedido para &ldquo;Em preparação&rdquo; no Kanban — o MenuNext ainda não confirma pagamentos automaticamente.
                  </p>
                </div>
              </div>
            )}
          </span>
        </label>

        <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-border bg-surface-card p-4 has-[:checked]:border-primary has-[:checked]:bg-primary/5">
          <input
            type="checkbox"
            name="payment_cash"
            defaultChecked={restaurant.payment_cash}
            className="mt-2.5 h-5 w-5 accent-primary"
          />
          <MethodIcon icon={Banknote} tint="bg-amber/10 text-amber" />
          <span className="min-w-0 flex-1">
            <span className="block text-body-lg font-bold text-graphite">Dinheiro</span>
            <span className="block text-body-sm text-text-muted">Pago na entrega ou na retirada; o cliente pode informar o valor para troco.</span>
          </span>
        </label>

        <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-border bg-surface-card p-4 has-[:checked]:border-primary has-[:checked]:bg-primary/5">
          <input
            type="checkbox"
            name="payment_card"
            defaultChecked={restaurant.payment_card}
            className="mt-2.5 h-5 w-5 accent-primary"
          />
          <MethodIcon icon={CreditCard} tint="bg-blue/10 text-blue" />
          <span className="min-w-0 flex-1">
            <span className="block text-body-lg font-bold text-graphite">Cartão na entrega ou na retirada</span>
            <span className="block text-body-sm text-text-muted">Pago na sua maquininha, no momento da entrega ou da retirada.</span>
          </span>
        </label>

        {state.status === "error" && (
          <div className="rounded-xl border border-red/20 bg-red/10 px-3.5 py-2.5 text-body-md font-medium text-red">
            {state.message}
          </div>
        )}
        {state.status === "success" && (
          <div className="rounded-xl border border-emerald/20 bg-emerald/10 px-3.5 py-2.5 text-body-md font-medium text-emerald">
            Formas de pagamento salvas com sucesso.
          </div>
        )}

        <SaveButton />
      </form>
    </div>
  );
}
