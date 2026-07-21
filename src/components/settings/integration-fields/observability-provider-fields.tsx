import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ES_SETTINGS_DEFAULTS } from "../integration-form-model";
import type { IntegrationFieldsProps } from "./types";

export function ObservabilityProviderFields({ form, set }: IntegrationFieldsProps) {
  switch (form.type) {
    case "UNIFI":
      return (
        <div className="grid gap-2">
          <Label htmlFor="unifi-site">Site</Label>
          <Input id="unifi-site" value={form.unifiSite} onChange={(event) => set("unifiSite", event.target.value)} placeholder="default" className="max-w-48" />
          <p className="text-xs text-muted-foreground">
            Match the site name, internal reference, or UUID. <code>default</code> also selects the only site.
          </p>
        </div>
      );
    case "ELASTICSEARCH":
      return (
        <div className="space-y-4 rounded-md border p-3">
          <p className="text-sm font-medium">Log query settings</p>
          <div className="grid gap-2">
            <Label htmlFor="es-index">Index pattern</Label>
            <Input id="es-index" value={form.indexPattern} onChange={(event) => set("indexPattern", event.target.value)} placeholder={ES_SETTINGS_DEFAULTS.indexPattern} />
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <ElasticsearchField id="es-ts" label="Timestamp field" value={form.timestampField} placeholder={ES_SETTINGS_DEFAULTS.timestampField} onChange={(value) => set("timestampField", value)} />
            <ElasticsearchField id="es-level" label="Level field" value={form.levelField} placeholder={ES_SETTINGS_DEFAULTS.levelField} onChange={(value) => set("levelField", value)} />
            <ElasticsearchField id="es-message" label="Message field" value={form.messageField} placeholder={ES_SETTINGS_DEFAULTS.messageField} onChange={(value) => set("messageField", value)} />
            <ElasticsearchField id="es-host" label="Host field" value={form.hostField} placeholder={ES_SETTINGS_DEFAULTS.hostField} onChange={(value) => set("hostField", value)} />
          </div>
        </div>
      );
    default:
      return null;
  }
}

function ElasticsearchField({
  id,
  label,
  value,
  placeholder,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  placeholder: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} />
    </div>
  );
}
