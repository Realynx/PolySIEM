import { FootprintMap } from "@/components/topology/footprint-map";
import { loadFootprintInput } from "@/lib/topology/footprint-data";
import { deriveFootprint, focusFootprintGraph } from "@/lib/topology/footprint";

/** A compact, asset-scoped footprint for inventory inspection pages. */
export async function FocusedFootprint({ targetId }: { targetId: string }) {
  const graph = await loadFootprintInput()
    .then((input) => focusFootprintGraph(deriveFootprint(input), targetId))
    .catch(() => null);
  if (!graph) return null;

  return (
    <section
      className="mb-6 space-y-3"
      aria-labelledby="network-footprint-heading"
    >
      <div>
        <h2
          id="network-footprint-heading"
          className="text-sm font-medium uppercase tracking-wider text-muted-foreground"
        >
          Network footprint
        </h2>
        <p className="mt-1 text-xs text-muted-foreground">
          This asset&apos;s network placement, reachable paths, and inbound
          exposure.
        </p>
      </div>
      <FootprintMap
        graph={graph}
        heightClassName="h-[52vh] min-h-[420px]"
        storageKey={`polysiem:footprint:inspection:${targetId}:positions:v1`}
      />
    </section>
  );
}
