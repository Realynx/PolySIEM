import { describe, expect, it } from "vitest";
import { DEFAULT_NETWORK_INSIGHT_WIDGETS } from "./default-widgets";
import {
  defaultNetworkInsightLayout,
  moveNetworkInsightWidget,
  parseNetworkInsightLayout,
  reconcileNetworkInsightLayout,
  reorderNetworkInsightWidgets,
  updateNetworkInsightWidget,
} from "./layout";
import type { NetworkInsightWidgetDefinition } from "./types";

const definitions: NetworkInsightWidgetDefinition[] = [
  {
    id: "traffic",
    title: "Traffic",
    description: "",
    defaultSize: "wide",
    allowedSizes: ["half", "wide", "full"],
    defaultConfig: { limit: 5, legend: true },
    settings: [
      { key: "limit", label: "Rows", type: "select" },
      { key: "legend", label: "Legend", type: "toggle" },
    ],
    render: () => null,
  },
  {
    id: "alerts",
    title: "Alerts",
    description: "",
    defaultSize: "half",
    defaultConfig: {},
    render: () => null,
  },
];

describe("Network Insights widget layout", () => {
  it("ships a balanced default dashboard", () => {
    expect(
      DEFAULT_NETWORK_INSIGHT_WIDGETS.map(({ id, defaultSize }) => [id, defaultSize]),
    ).toEqual([
      ["overview", "full"],
      ["traffic-origins", "wide"],
      ["traffic-mix", "compact"],
      ["alert-stream", "half"],
      ["top-visitors", "half"],
      ["tunnel-activity", "wide"],
      ["infrastructure-pulse", "compact"],
    ]);
  });

  it("creates independent registry defaults", () => {
    const first = defaultNetworkInsightLayout(definitions);
    const second = defaultNetworkInsightLayout(definitions);
    first.items[0].config.limit = 10;
    expect(second.items[0].config.limit).toBe(5);
  });

  it("sanitizes persistence and appends newly registered widgets", () => {
    expect(
      reconcileNetworkInsightLayout(
        {
          version: 0,
          items: [
            {
              id: "traffic",
              visible: false,
              size: "compact",
              config: { limit: 10, legend: false, injected: "no" },
            },
            { id: "traffic", visible: true },
            { id: "removed-widget", visible: true },
          ],
        },
        definitions,
      ),
    ).toEqual({
      version: 1,
      items: [
        {
          id: "traffic",
          visible: false,
          size: "wide",
          config: { limit: 10, legend: false },
        },
        {
          id: "alerts",
          visible: true,
          size: "half",
          config: {},
        },
      ],
    });
  });

  it("falls back cleanly when saved JSON is corrupt", () => {
    expect(parseNetworkInsightLayout("not-json", definitions)).toEqual(
      defaultNetworkInsightLayout(definitions),
    );
  });

  it("supports accessible moves, drag reordering, visibility and config", () => {
    const base = defaultNetworkInsightLayout(definitions);
    expect(moveNetworkInsightWidget(base, "alerts", -1).items.map((item) => item.id)).toEqual([
      "alerts",
      "traffic",
    ]);
    expect(
      reorderNetworkInsightWidgets(base, "traffic", "alerts").items.map((item) => item.id),
    ).toEqual(["alerts", "traffic"]);
    expect(
      reorderNetworkInsightWidgets(base, "alerts", "traffic").items.map((item) => item.id),
    ).toEqual(["alerts", "traffic"]);
    const updated = updateNetworkInsightWidget(base, "traffic", {
      visible: false,
      config: { limit: 12 },
    });
    expect(updated.items[0]).toMatchObject({
      visible: false,
      config: { limit: 12, legend: true },
    });
  });
});
