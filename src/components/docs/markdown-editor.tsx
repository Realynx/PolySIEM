"use client";

import { useRef, useState, type ReactNode } from "react";
import { useTheme } from "next-themes";
import { markdown as markdownLang } from "@codemirror/lang-markdown";
import CodeMirror, { type ReactCodeMirrorRef } from "@uiw/react-codemirror";
import {
  Bold,
  Code,
  Columns2,
  Eye,
  Heading2,
  Italic,
  Link2,
  List,
  SquarePen,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { AiAssistMenu, type AiAssistMenuProps } from "@/components/ai";
import { serializeNodeToken } from "@/lib/docs/node-embed";
import { Markdown } from "./markdown";
import { NodePicker } from "./node-picker";

type ViewMode = "write" | "preview" | "split";

export interface MarkdownEditorProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  /** Overrides the built-in AI assist menu with custom toolbar content. */
  aiSlot?: ReactNode;
  /** Enables "Generate description" in the AI menu, seeded with this entity's facts. */
  entity?: AiAssistMenuProps["entity"];
  minHeightClass?: string;
}

/**
 * CodeMirror-backed markdown editor with formatting shortcuts and a live
 * preview (toggle or split view).
 */
export function MarkdownEditor({
  value,
  onChange,
  placeholder = "Write markdown…",
  aiSlot,
  entity,
  minHeightClass = "min-h-64",
}: MarkdownEditorProps) {
  const { resolvedTheme } = useTheme();
  const [mode, setMode] = useState<ViewMode>("write");
  const cmRef = useRef<ReactCodeMirrorRef>(null);

  const surround = (before: string, after = before, placeholderText = "text") => {
    const view = cmRef.current?.view;
    if (!view) return;
    const { from, to } = view.state.selection.main;
    const selected = view.state.sliceDoc(from, to) || placeholderText;
    view.dispatch({
      changes: { from, to, insert: `${before}${selected}${after}` },
      selection: { anchor: from + before.length, head: from + before.length + selected.length },
    });
    view.focus();
  };

  const linePrefix = (prefix: string) => {
    const view = cmRef.current?.view;
    if (!view) return;
    const line = view.state.doc.lineAt(view.state.selection.main.from);
    view.dispatch({ changes: { from: line.from, to: line.from, insert: prefix } });
    view.focus();
  };

  const insertAtCursor = (text: string) => {
    const view = cmRef.current?.view;
    if (!view) return;
    const { from, to } = view.state.selection.main;
    view.dispatch({
      changes: { from, to, insert: text },
      selection: { anchor: from + text.length },
    });
    view.focus();
  };

  const formatActions: { label: string; icon: ReactNode; run: () => void }[] = [
    { label: "Bold", icon: <Bold />, run: () => surround("**") },
    { label: "Italic", icon: <Italic />, run: () => surround("*") },
    { label: "Inline code", icon: <Code />, run: () => surround("`", "`", "code") },
    { label: "Link", icon: <Link2 />, run: () => surround("[", "](https://)", "title") },
    { label: "Heading", icon: <Heading2 />, run: () => linePrefix("## ") },
    { label: "Bullet list", icon: <List />, run: () => linePrefix("- ") },
  ];

  const viewModes: { mode: ViewMode; label: string; icon: ReactNode; className?: string }[] = [
    { mode: "write", label: "Write", icon: <SquarePen /> },
    { mode: "preview", label: "Preview", icon: <Eye /> },
    { mode: "split", label: "Split view", icon: <Columns2 />, className: "hidden lg:inline-flex" },
  ];

  const editorPane = (
    <CodeMirror
      ref={cmRef}
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      theme={resolvedTheme === "dark" ? "dark" : "light"}
      extensions={[markdownLang()]}
      basicSetup={{ lineNumbers: false, foldGutter: false, highlightActiveLine: false }}
      className={cn("text-sm [&_.cm-editor]:bg-transparent [&_.cm-editor]:outline-none [&_.cm-scroller]:font-mono", minHeightClass, "[&_.cm-editor]:h-full")}
    />
  );

  const previewPane = (
    <div className={cn("overflow-y-auto p-4", minHeightClass)}>
      <Markdown content={value} />
    </div>
  );

  return (
    <div className="overflow-hidden rounded-lg border bg-background">
      <div className="flex flex-wrap items-center gap-1 border-b bg-muted/40 px-2 py-1.5">
        {formatActions.map((action) => (
          <Tooltip key={action.label}>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={action.label}
                disabled={mode === "preview"}
                onClick={action.run}
              >
                {action.icon}
              </Button>
            </TooltipTrigger>
            <TooltipContent>{action.label}</TooltipContent>
          </Tooltip>
        ))}
        <NodePicker
          disabled={mode === "preview"}
          onInsert={(kind, id) => insertAtCursor(serializeNodeToken(kind, id))}
        />
        <Separator orientation="vertical" className="mx-1 h-5" />
        {viewModes.map((vm) => (
          <Tooltip key={vm.mode}>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant={mode === vm.mode ? "secondary" : "ghost"}
                size="icon-sm"
                aria-label={vm.label}
                className={vm.className}
                onClick={() => setMode(vm.mode)}
              >
                {vm.icon}
              </Button>
            </TooltipTrigger>
            <TooltipContent>{vm.label}</TooltipContent>
          </Tooltip>
        ))}
        <div className="ml-auto flex items-center gap-1">
          {aiSlot ?? (
            <AiAssistMenu
              getText={() => value}
              onResult={(text, mode) =>
                onChange(mode === "append" ? (value.trim() ? `${value.trimEnd()}\n\n${text}` : text) : text)
              }
              entity={entity}
            />
          )}
        </div>
      </div>
      {mode === "split" ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 lg:divide-x">
          <div className="min-w-0">{editorPane}</div>
          <div className="min-w-0">{previewPane}</div>
        </div>
      ) : mode === "preview" ? (
        previewPane
      ) : (
        editorPane
      )}
    </div>
  );
}
