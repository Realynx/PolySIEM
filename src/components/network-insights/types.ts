import type { ReactNode } from "react";
import type { NetworkInsightsResponse } from "@/lib/types";

export type NetworkInsightWidgetSize = "compact" | "half" | "wide" | "full";
export type NetworkInsightWidgetConfigValue = string | number | boolean;
export type NetworkInsightWidgetConfig = Record<string, NetworkInsightWidgetConfigValue>;

export interface NetworkInsightWidgetSetting {
  key: string;
  label: string;
  type: "toggle" | "select";
  options?: { value: string | number; label: string }[];
}

export interface NetworkInsightWidgetRenderProps {
  data: NetworkInsightsResponse;
  config: NetworkInsightWidgetConfig;
  windowLabel?: string;
}

/**
 * Plugin contract for one Network Insights visualization. Definitions are
 * data-only except for `render`, so layout persistence never serializes React.
 */
export interface NetworkInsightWidgetDefinition {
  id: string;
  title: string;
  description: string;
  defaultSize: NetworkInsightWidgetSize;
  allowedSizes?: readonly NetworkInsightWidgetSize[];
  defaultConfig: NetworkInsightWidgetConfig;
  settings?: readonly NetworkInsightWidgetSetting[];
  render(props: NetworkInsightWidgetRenderProps): ReactNode;
}

/** Identity helper that gives custom widgets a discoverable extension point. */
export function defineNetworkInsightWidget(
  definition: NetworkInsightWidgetDefinition,
): NetworkInsightWidgetDefinition {
  return definition;
}

export interface NetworkInsightWidgetLayoutItem {
  id: string;
  visible: boolean;
  size: NetworkInsightWidgetSize;
  config: NetworkInsightWidgetConfig;
}

export interface NetworkInsightWidgetLayout {
  version: 1;
  items: NetworkInsightWidgetLayoutItem[];
}
