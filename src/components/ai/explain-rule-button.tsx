"use client";

import { useState } from "react";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { AiResultBar } from "@/components/ai/ai-result-bar";
import { useAiModels, useAiStream } from "@/components/ai/use-ai-stream";

export interface ExplainRuleButtonProps {
  ruleId: string;
  className?: string;
}

/**
 * Sparkles icon button that streams a plain-English explanation of a firewall
 * rule into a popover. Renders nothing when the AI integration is disabled.
 */
export function ExplainRuleButton({ ruleId, className }: ExplainRuleButtonProps) {
  const { data } = useAiModels();
  const stream = useAiStream();
  const [open, setOpen] = useState(false);

  if (!data?.enabled) return null;

  const onOpenChange = (next: boolean) => {
    setOpen(next);
    if (next) {
      void stream.start("explain_rule", { entity: { type: "firewall_rule", id: ruleId } });
    } else {
      stream.reset();
    }
  };

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="Explain this rule with AI"
          className={cn("text-muted-foreground", className)}
        >
          <Sparkles />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-96 max-w-[90vw]">
        <PopoverTitle>Rule explanation</PopoverTitle>
        <AiResultBar
          status={stream.status}
          text={stream.text}
          error={stream.error}
          onDiscard={() => onOpenChange(false)}
          onCancel={stream.cancel}
          readOnly
        />
      </PopoverContent>
    </Popover>
  );
}
