"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import {
  AlertCircle,
  Maximize2,
  Minimize2,
  RotateCw,
  Sparkles,
  SquarePen,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "@/components/ui/sheet";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { ChatMessage } from "@/lib/ai/agent/contract";
import { cn } from "@/lib/utils";
import { shouldExpandAssistant } from "./chat-layout";
import { buildChatContext } from "./context";
import { ChatComposer } from "./chat-composer";
import { ChatEmptyState } from "./chat-empty-state";
import { ChatMessageView } from "./chat-message";
import { useChatStream } from "./use-chat-stream";

const STORAGE_KEY = "polysiem:chat:v1";
const STORED_MESSAGE_CAP = 100;

interface StoredChat {
  open: boolean;
  messages: ChatMessage[];
}

function readStoredChat(): StoredChat | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    const candidate = parsed as Partial<StoredChat>;
    if (!Array.isArray(candidate.messages)) return null;
    return { open: candidate.open === true, messages: candidate.messages as ChatMessage[] };
  } catch {
    return null;
  }
}

/**
 * Global AI chat dock: floating launcher (bottom-right) + right-side slide-over
 * panel. Mounted once in the dashboard layout; toggle with Ctrl/Cmd+J.
 */
export function ChatDock() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  // sessionStorage is read in an effect (not initial state) to stay SSR-safe.
  const [restored, setRestored] = useState(false);
  const { state, retryable, send, retry, stop, reset, hydrate } = useChatStream();
  const [input, setInput] = useState("");

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const nearBottomRef = useRef(true);
  const autoExpandedResponseRef = useRef(0);

  // Restore persisted dock state once on mount.
  useEffect(() => {
    const stored = readStoredChat();
    if (stored) {
      if (stored.messages.length > 0) hydrate(stored.messages);
      if (stored.open) setOpen(true);
    }
    setRestored(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persist open state + transcript so a full page load doesn't lose the chat.
  useEffect(() => {
    if (!restored) return;
    try {
      const payload: StoredChat = {
        open,
        messages: state.messages.slice(-STORED_MESSAGE_CAP),
      };
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    } catch {
      // Storage full / unavailable — the dock still works, it just won't survive reloads.
    }
  }, [restored, open, state.messages]);

  // Global shortcut: Ctrl/Cmd+J toggles the dock (palette owns Ctrl+K).
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.key === "j" || e.key === "J") && (e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey) {
        e.preventDefault();
        setOpen((v) => !v);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const streaming = state.status === "streaming";

  const handleSend = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || streaming) return;
      nearBottomRef.current = true;
      send(trimmed, buildChatContext(pathname));
      setInput("");
    },
    [send, streaming, pathname],
  );

  // Auto-scroll while streaming, but only when the user is already at the bottom.
  const draftContent = state.draft?.content ?? "";
  const draftToolCount = state.draft?.toolCalls.length ?? 0;
  useEffect(() => {
    const el = scrollRef.current;
    if (el && nearBottomRef.current) el.scrollTop = el.scrollHeight;
  }, [state.messages, draftContent, draftToolCount, state.error, open, expanded]);

  const assistantMessages = state.messages.filter(
    (message) => message.role === "assistant",
  );
  const responseOrdinal =
    assistantMessages.length + (state.draft !== null ? 1 : 0);
  const activeAssistantContent =
    state.draft?.content ?? assistantMessages.at(-1)?.content ?? "";

  // Promote once per assistant turn. Keeping the ordinal stable as a draft is
  // finalized prevents a manual collapse from immediately bouncing open again.
  useEffect(() => {
    if (
      open &&
      responseOrdinal > 0 &&
      autoExpandedResponseRef.current !== responseOrdinal &&
      shouldExpandAssistant(activeAssistantContent)
    ) {
      autoExpandedResponseRef.current = responseOrdinal;
      setExpanded(true);
    }
  }, [activeAssistantContent, open, responseOrdinal]);

  const hasConversation = state.messages.length > 0 || state.draft !== null;

  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={() => setOpen(true)}
            aria-label="Ask PolySIEM (Ctrl+J)"
            className="fixed right-4 bottom-[calc(1rem+var(--dock-offset,0px))] z-40 flex size-11 items-center justify-center rounded-full border border-primary/20 bg-primary text-primary-foreground shadow-lg outline-none transition-transform hover:scale-105 focus-visible:ring-3 focus-visible:ring-ring/50 motion-reduce:transition-none motion-reduce:hover:scale-100 print:hidden"
          >
            <Sparkles className="size-5" aria-hidden />
          </button>
        </TooltipTrigger>
        <TooltipContent side="left">Ask PolySIEM (Ctrl+J)</TooltipContent>
      </Tooltip>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent
          side="right"
          showCloseButton={false}
          data-expanded={expanded ? "true" : "false"}
          className={cn(
            "gap-0 overflow-hidden p-0 data-[side=right]:w-full motion-reduce:transition-none data-[side=right]:sm:w-[420px] data-[side=right]:sm:max-w-[420px] sm:transition-[top,right,bottom,width,max-width,height,border-radius,transform,box-shadow] sm:duration-500 sm:ease-[cubic-bezier(0.22,1,0.36,1)] sm:will-change-[top,right,width,height,transform]",
            expanded &&
              "sm:!top-1/2 sm:!right-1/2 sm:!bottom-auto sm:!h-[min(88svh,860px)] sm:!w-[min(900px,calc(100vw-3rem))] sm:!max-w-none sm:!translate-x-1/2 sm:!-translate-y-1/2 sm:rounded-2xl sm:border sm:shadow-2xl sm:shadow-primary/10 no-gpu:sm:shadow-md",
          )}
        >
          <div
            className={cn(
              "flex items-center gap-2 border-b px-4 py-3 transition-colors duration-500",
              expanded && "bg-primary/[0.035]",
            )}
          >
            <div className="flex size-7 items-center justify-center rounded-full bg-primary/10 text-primary">
              <Sparkles className="size-4" aria-hidden />
            </div>
            <div className="min-w-0 flex-1">
              <SheetTitle className="truncate text-sm">PolySIEM Assistant</SheetTitle>
              <SheetDescription className="sr-only">
                Chat with the PolySIEM AI assistant. It can search your lab and research security
                events.
              </SheetDescription>
            </div>
            {hasConversation && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => {
                      reset();
                      setInput("");
                      setExpanded(false);
                      autoExpandedResponseRef.current = 0;
                    }}
                    aria-label="New chat"
                  >
                    <SquarePen />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">New chat</TooltipContent>
              </Tooltip>
            )}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => setExpanded((value) => !value)}
                  aria-label={
                    expanded ? "Return chat to side panel" : "Expand chat"
                  }
                  aria-pressed={expanded}
                  className="hidden transition-transform duration-300 sm:inline-flex"
                >
                  {expanded ? <Minimize2 /> : <Maximize2 />}
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                {expanded ? "Return to side panel" : "Expand chat"}
              </TooltipContent>
            </Tooltip>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => setOpen(false)}
              aria-label="Close chat"
            >
              <X />
            </Button>
          </div>

          <div
            ref={scrollRef}
            onScroll={(e) => {
              const el = e.currentTarget;
              nearBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
            }}
            className="flex-1 overflow-y-auto overscroll-contain"
          >
            {hasConversation ? (
              <div
                className={cn(
                  "mx-auto flex w-full flex-col gap-4 px-4 py-4 transition-[max-width,padding] duration-500 ease-out",
                  expanded ? "max-w-3xl sm:px-6 sm:py-6" : "max-w-none",
                )}
              >
                {state.messages.map((message, index) => (
                  <ChatMessageView
                    key={index}
                    role={message.role}
                    content={message.content}
                    toolCalls={message.toolCalls}
                  />
                ))}
                {state.draft && (
                  <ChatMessageView
                    role="assistant"
                    content={state.draft.content}
                    toolCalls={state.draft.toolCalls}
                    streaming
                  />
                )}
                {state.status === "error" && state.error && (
                  <div
                    role="alert"
                    className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
                  >
                    <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
                    <div className="min-w-0 flex-1 space-y-2">
                      <p>{state.error}</p>
                      {retryable && (
                        <Button
                          variant="outline"
                          size="xs"
                          onClick={() => retry(buildChatContext(pathname))}
                          className="text-foreground"
                        >
                          <RotateCw /> Retry
                        </Button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <ChatEmptyState onPrompt={handleSend} />
            )}
          </div>

          <ChatComposer
            value={input}
            onValueChange={setInput}
            onSend={() => handleSend(input)}
            onStop={stop}
            streaming={streaming}
            autoFocus={open}
          />
        </SheetContent>
      </Sheet>
    </>
  );
}
