import { Megaphone } from "lucide-react";

/** Aviso promocional da loja (texto escrito pelo dono, até 140 caracteres). Texto puro — nunca HTML. */
export function StoreBanner({ message }: { message: string }) {
  return (
    <div className="mx-3.5 mt-3 flex items-start gap-3 rounded-2xl bg-graphite px-4 py-3 text-white shadow-card">
      <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary">
        <Megaphone className="h-4 w-4" aria-hidden />
      </span>
      <p className="text-body-md font-semibold">{message}</p>
    </div>
  );
}
