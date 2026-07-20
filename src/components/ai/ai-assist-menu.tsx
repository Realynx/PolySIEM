"use client";

import { useEffect, useState } from "react";
import { FileText, ListTree, PenLine, Sparkles, WandSparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { AiResultBar } from "@/components/ai/ai-result-bar";
import { useAiModels, useAiStream, type AiTask } from "@/components/ai/use-ai-stream";

export interface AiAssistMenuProps {
  /** Returns the current text of the field this menu assists. */
  getText: () => string;
  /** Receives the accepted AI text and how to apply it. */
  onResult: (text: string, mode: "replace" | "append") => void;
  /** When set, enables "Generate description" from the entity's inventory facts. */
  entity?: { type: "device" | "vm" | "container" | "network" | "service"; id: string };
  className?: string;
}

const TEXT_TASKS: Array<{ task: AiTask; label: string; icon: typeof PenLine }> = [
  { task: "improve", label: "Improve writing", icon: WandSparkles },
  { task: "summarize", label: "Summarize", icon: ListTree },
  { task: "continue", label: "Continue writing", icon: PenLine },
];

/**
 * Self-contained AI assist dropdown for text fields. Renders nothing when the
 * AI integration is disabled (checked via /api/ai/models, cached 5 minutes).
 */
export function AiAssistMenu({ getText, onResult, entity, className }: AiAssistMenuProps) {
  const { data } = useAiModels();
  const stream = useAiStream();
  const [panelOpen, setPanelOpen] = useState(false);
  const [hasText, setHasText] = useState(false);

  useEffect(() => {
    if (stream.status === "error" && stream.error) toast.error(stream.error);
  }, [stream.status, stream.error]);

  if (!data?.enabled) return null;

  const runTask = (task: AiTask) => {
    setPanelOpen(true);
    if (task === "describe_entity") {
      void stream.start(task, { entity });
    } else {
      void stream.start(task, { text: getText() });
    }
  };

  const close = () => {
    setPanelOpen(false);
    stream.reset();
  };

  const accept = (mode: "replace" | "append") => {
    onResult(stream.text, mode);
    close();
  };

  return (
    <Popover
      open={panelOpen}
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <PopoverAnchor asChild>
        <span className={cn("inline-flex", className)}>
          <DropdownMenu
            onOpenChange={(open) => {
              if (open) setHasText(getText().trim().length > 0);
            }}
          >
            <DropdownMenuTrigger asChild>
              <Button type="button" variant="outline" size="sm" aria-label="AI assist">
                <Sparkles data-icon="inline-start" /> AI
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              {entity && (
                <>
                  <DropdownMenuItem onSelect={() => runTask("describe_entity")}>
                    <FileText /> Generate description
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                </>
              )}
              {TEXT_TASKS.map(({ task, label, icon: Icon }) => (
                <DropdownMenuItem key={task} disabled={!hasText} onSelect={() => runTask(task)}>
                  <Icon /> {label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </span>
      </PopoverAnchor>
      <PopoverContent
        align="end"
        className="w-96 max-w-[90vw]"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <AiResultBar
          status={stream.status}
          text={stream.text}
          error={stream.error}
          onAccept={() => accept("replace")}
          onAppend={() => accept("append")}
          onDiscard={close}
          onCancel={stream.cancel}
        />
      </PopoverContent>
    </Popover>
  );
}
