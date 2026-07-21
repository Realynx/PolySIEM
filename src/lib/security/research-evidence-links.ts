export type ResearchEvidenceReference = {
  id: string;
  provider: string;
  kind: string;
  status: "success" | "error" | "unavailable";
  title: string;
  summary: string | null;
  capturedAt: string;
};

function escapeMarkdown(value: string) {
  return value.replace(/([\\`*_[\]<>])/g, "\\$1").replace(/\r?\n/g, " ");
}

/** Turn Obsidian-style evidence references into safe Markdown for preview. */
export function expandEvidenceReferences(content: string, evidence: ResearchEvidenceReference[]) {
  const byId = new Map(evidence.map((item) => [item.id, item]));
  return content.replace(
    /(!?)\[\[evidence:([\w-]+)(?:\|([^\]]+))?\]\]/g,
    (_token, embedMarker: string, id: string, customLabel?: string) => {
      const item = byId.get(id);
      const label = escapeMarkdown(customLabel?.trim() || item?.title || "Unavailable evidence");
      const target = `#evidence-${id}`;
      if (!embedMarker) return `[${label}](${target})`;

      if (!item) return `\n> **Evidence unavailable:** [${label}](${target})\n`;

      const summary = escapeMarkdown(item.summary || "Captured provider result with no summary.");
      const captured = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(item.capturedAt));
      return `\n> **Evidence · [${label}](${target})**  \n> ${summary}  \n> ${escapeMarkdown(item.provider)} · ${escapeMarkdown(item.kind)} · ${escapeMarkdown(captured)}\n`;
    },
  );
}
