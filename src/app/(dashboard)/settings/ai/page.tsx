import { requirePageAdmin } from "@/lib/auth/guards";
import {
  getEmbeddingConfig,
  getOllamaConfig,
  sanitizeAiConfig,
  sanitizeEmbeddingConfig,
} from "@/lib/settings";
import { isMobileView } from "@/lib/device";
import { PageHeader } from "@/components/shared/page-header";
import { AiSettingsForm } from "@/components/settings/ai-settings-form";
import { EmbeddingSettingsForm } from "@/components/settings/embedding-settings-form";
import { MobileSettingsSubpage } from "@/components/mobile/pages/settings/settings-subpage";

export const metadata = { title: "AI assistant" };
export const dynamic = "force-dynamic";

export default async function AiSettingsPage() {
  await requirePageAdmin();
  const [ollamaConfig, embeddingConfig] = await Promise.all([
    getOllamaConfig(),
    getEmbeddingConfig(),
  ]);

  // Sanitize so encrypted provider keys are never serialized to the client.
  const forms = (
    <div className="space-y-6">
      <AiSettingsForm initialConfig={sanitizeAiConfig(ollamaConfig)} />
      <EmbeddingSettingsForm initialConfig={sanitizeEmbeddingConfig(embeddingConfig)} />
    </div>
  );

  if (await isMobileView()) {
    return <MobileSettingsSubpage title="AI assistant">{forms}</MobileSettingsSubpage>;
  }

  return (
    <div>
      <PageHeader
        title="AI assistant"
        description="Use local Ollama or connect OpenAI, DeepSeek, Anthropic, or Azure OpenAI for PolySIEM AI features."
      />
      {forms}
    </div>
  );
}
