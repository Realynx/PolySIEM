"use client";

import dynamic from "next/dynamic";

/**
 * The chat dock (markdown renderer, sanitizer, composer, speech hooks) is
 * mounted by the dashboard layout on every page. Loading it as its own chunk
 * after hydration keeps that weight off every page's critical path.
 */
export const ChatDockLazy = dynamic(
  () => import("@/components/chat/chat-dock").then((mod) => mod.ChatDock),
  { ssr: false },
);
