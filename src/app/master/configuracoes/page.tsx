import { requireMasterPage, getPlatformSettings, getPlatformRequireAal2 } from "@/lib/tenant";
import { RequireAal2Card } from "@/components/master/RequireAal2Card";
import { PlatformSettingsForm } from "@/components/master/PlatformSettingsForm";

export default async function Page() {
  const { supabase } = await requireMasterPage();
  const [settings, requireAal2] = await Promise.all([getPlatformSettings(supabase), getPlatformRequireAal2(supabase)]);

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-6 py-8">
      <div>
        <h1 className="text-headline-lg text-graphite">Configurações da plataforma</h1>
        <p className="mt-0.5 text-body-md text-text-muted">Parâmetros globais do MenuNext.</p>
      </div>

      <PlatformSettingsForm settings={settings} />
      {requireAal2 !== null && <RequireAal2Card enabled={requireAal2} />}
    </div>
  );
}
