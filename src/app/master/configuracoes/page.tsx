import { requireMasterPage, getPlatformSettings } from "@/lib/tenant";
import { PlatformSettingsForm } from "@/components/master/PlatformSettingsForm";

export default async function Page() {
  const { supabase } = await requireMasterPage();
  const settings = await getPlatformSettings(supabase);

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-6 py-8">
      <div>
        <h1 className="text-2xl font-black tracking-tight text-graphite">Configurações da plataforma</h1>
        <p className="mt-0.5 text-sm font-medium text-text-muted">Parâmetros globais do MenuNext.</p>
      </div>

      <PlatformSettingsForm settings={settings} />
    </div>
  );
}
