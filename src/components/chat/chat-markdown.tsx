"use client";

import Link from "next/link";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSanitize from "rehype-sanitize";
import { cn } from "@/lib/utils";

/**
 * Compact sanitized markdown for chat bubbles. Mirrors the docs renderer's
 * styling (theme tokens, no typography plugin) at chat scale; relative links
 * use next/link so entity references navigate in-app.
 */
export function ChatMarkdown({
  content,
  className,
  compact = false,
}: {
  content: string;
  className?: string;
  /** Keep headings and block spacing at the surrounding small-text scale. */
  compact?: boolean;
}) {
  return (
    <div
      className={cn(
        "min-w-0",
        compact ? "text-xs leading-relaxed" : "text-sm leading-6",
        className,
      )}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeSanitize]}
        components={{
          h1: ({ children }) => (
            <h3
              className={cn(
                "font-semibold tracking-tight first:mt-0",
                compact ? "mt-2 mb-1 text-xs" : "mt-4 mb-2 text-base",
              )}
            >
              {children}
            </h3>
          ),
          h2: ({ children }) => (
            <h4
              className={cn(
                "font-semibold tracking-tight first:mt-0",
                compact ? "mt-2 mb-1 text-xs" : "mt-4 mb-2 text-sm",
              )}
            >
              {children}
            </h4>
          ),
          h3: ({ children }) => (
            <h5
              className={cn(
                "font-semibold first:mt-0",
                compact ? "mt-2 mb-1 text-xs" : "mt-3 mb-1.5 text-sm",
              )}
            >
              {children}
            </h5>
          ),
          h4: ({ children }) => (
            <h6
              className={cn(
                "font-medium first:mt-0",
                compact ? "mt-2 mb-1 text-xs" : "mt-3 mb-1.5 text-sm",
              )}
            >
              {children}
            </h6>
          ),
          p: ({ children }) => (
            <p className={compact ? "mb-1.5 last:mb-0" : "mb-3 last:mb-0"}>{children}</p>
          ),
          a: ({ href, children }) => {
            if (href && href.startsWith("/")) {
              return (
                <Link
                  href={href}
                  className="font-medium text-primary underline underline-offset-4 hover:opacity-80"
                >
                  {children}
                </Link>
              );
            }
            return (
              <a
                href={href}
                className="font-medium text-primary underline underline-offset-4 hover:opacity-80"
                target={href?.startsWith("http") ? "_blank" : undefined}
                rel={href?.startsWith("http") ? "noreferrer" : undefined}
              >
                {children}
              </a>
            );
          },
          ul: ({ children }) => (
            <ul
              className={cn(
                "list-disc last:mb-0",
                compact ? "mb-1.5 space-y-0.5 pl-4" : "mb-3 space-y-1 pl-5",
              )}
            >
              {children}
            </ul>
          ),
          ol: ({ children }) => (
            <ol
              className={cn(
                "list-decimal last:mb-0",
                compact ? "mb-1.5 space-y-0.5 pl-4" : "mb-3 space-y-1 pl-5",
              )}
            >
              {children}
            </ol>
          ),
          li: ({ children }) => <li className="[&>ul]:mb-0 [&>ol]:mb-0">{children}</li>,
          blockquote: ({ children }) => (
            <blockquote
              className={cn(
                "border-l-2 border-border text-muted-foreground italic last:mb-0",
                compact ? "mb-1.5 pl-2" : "mb-3 pl-3",
              )}
            >
              {children}
            </blockquote>
          ),
          code: ({ className: codeClass, children }) => {
            const isBlock = typeof codeClass === "string" && codeClass.includes("language-");
            if (isBlock) return <code className={codeClass}>{children}</code>;
            return (
              <code className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]">{children}</code>
            );
          },
          pre: ({ children }) => (
            <pre
              className={cn(
                "overflow-x-auto rounded-lg border bg-muted font-mono leading-relaxed last:mb-0",
                compact ? "mb-1.5 p-2 text-[0.7rem]" : "mb-3 p-3 text-xs",
              )}
            >
              {children}
            </pre>
          ),
          table: ({ children }) => (
            <div
              className={cn(
                "overflow-x-auto rounded-lg border last:mb-0",
                compact ? "mb-1.5" : "mb-3",
              )}
            >
              <table className="w-full border-collapse text-xs">{children}</table>
            </div>
          ),
          thead: ({ children }) => <thead className="bg-muted/50">{children}</thead>,
          th: ({ children }) => (
            <th className="border-b px-2 py-1.5 text-left font-medium whitespace-nowrap">{children}</th>
          ),
          td: ({ children }) => (
            <td className="border-b px-2 py-1.5 align-top last:border-b-0">{children}</td>
          ),
          hr: () => <hr className={cn("border-border", compact ? "my-2" : "my-4")} />,
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
