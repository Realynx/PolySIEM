"use client";

import { memo } from "react";
import { cn } from "@/lib/utils";
import type { AgentToolCall } from "@/lib/ai/agent/contract";
import { ChatMarkdown } from "./chat-markdown";
import { ToolCallList } from "./tool-call-chip";

interface ChatMessageProps {
  role: "user" | "assistant";
  content: string;
  toolCalls?: AgentToolCall[];
  /** True while this assistant turn is still streaming in. */
  streaming?: boolean;
}

/** One transcript turn. User turns are right-aligned bubbles; assistant turns are full width. */
export const ChatMessageView = memo(function ChatMessageView({
  role,
  content,
  toolCalls,
  streaming = false,
}: ChatMessageProps) {
  if (role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-2xl rounded-br-md bg-primary px-3.5 py-2 text-sm leading-6 whitespace-pre-wrap text-primary-foreground">
          {content}
        </div>
      </div>
    );
  }

  const hasTools = Boolean(toolCalls && toolCalls.length > 0);
  const thinking = streaming && !content && !hasTools;

  return (
    <div className="flex flex-col gap-2" aria-live={streaming ? "polite" : undefined}>
      {hasTools && <ToolCallList calls={toolCalls!} />}
      {thinking ? (
        <p className="text-sm text-muted-foreground">
          Thinking
          <span className="animate-pulse motion-reduce:animate-none">…</span>
        </p>
      ) : content ? (
        <div className={cn(streaming && "[&>div>*:last-child]:after:ml-0.5 [&>div>*:last-child]:after:inline-block [&>div>*:last-child]:after:h-[1em] [&>div>*:last-child]:after:w-0.5 [&>div>*:last-child]:after:translate-y-[0.15em] [&>div>*:last-child]:after:animate-pulse [&>div>*:last-child]:after:bg-foreground/70 [&>div>*:last-child]:after:content-[''] motion-reduce:[&>div>*:last-child]:after:animate-none")}>
          <ChatMarkdown content={content} />
        </div>
      ) : null}
    </div>
  );
});
