import type { Element, ElementContent, Root, RootContent, Text } from "hast";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import { cn } from "@/lib/utils";
import { splitTextOnToken, type NodeEmbedKind } from "@/lib/docs/node-embed";
import { normalizeDocHref } from "@/lib/docs/links";
import { NodeEmbed } from "./node-embed";

/** Tags whose text is literal — embed tokens inside them stay as plain text. */
const SKIP_TAGS = new Set(["code", "pre", "a"]);

function embedElement(kind: NodeEmbedKind, id: string): Element {
  return {
    type: "element",
    tagName: "node-embed",
    properties: { dataKind: kind, dataId: id },
    children: [],
  };
}

/**
 * Recursively replace `{{node:kind:id}}` tokens inside text nodes with a
 * `<node-embed data-kind data-id>` element, skipping code/link contexts. Runs
 * before rehype-sanitize, which is extended to allow exactly this element.
 */
function replaceEmbedTokens<T extends RootContent | ElementContent>(
  children: T[],
  insideSkip: boolean,
): T[] {
  const out: T[] = [];
  for (const child of children) {
    if (child.type === "element") {
      const el = child as Element;
      el.children = replaceEmbedTokens(el.children, insideSkip || SKIP_TAGS.has(el.tagName));
      out.push(child);
    } else if (child.type === "text" && !insideSkip) {
      const segments = splitTextOnToken((child as Text).value);
      if (segments.length === 1 && segments[0].type === "text") {
        out.push(child);
      } else {
        for (const seg of segments) {
          const node =
            seg.type === "text"
              ? ({ type: "text", value: seg.value } satisfies Text)
              : embedElement(seg.kind, seg.id);
          out.push(node as unknown as T);
        }
      }
    } else {
      out.push(child);
    }
  }
  return out;
}

function rehypeNodeEmbed() {
  return (tree: Root): void => {
    tree.children = replaceEmbedTokens(tree.children, false);
  };
}

/**
 * Sanitizer schema extended with ONLY the `<node-embed>` element and its two
 * data attributes — nothing else new is allowed through.
 */
const sanitizeSchema: typeof defaultSchema = {
  ...defaultSchema,
  tagNames: [...(defaultSchema.tagNames ?? []), "node-embed"],
  attributes: {
    ...defaultSchema.attributes,
    "node-embed": ["dataKind", "dataId"],
  },
};

/** react-markdown's Components type is keyed by intrinsic tags; spread in the
 * custom `node-embed` override so it type-checks while the standard overrides
 * keep their contextual typing. */
const embedComponents = {
  "node-embed": ({ node }: { node?: Element }) => {
    const props = (node?.properties ?? {}) as { dataKind?: unknown; dataId?: unknown };
    const kind = typeof props.dataKind === "string" ? props.dataKind : "";
    const id = typeof props.dataId === "string" ? props.dataId : "";
    return <NodeEmbed kind={kind} id={id} />;
  },
};

/**
 * Sanitized GFM markdown renderer, styled with theme tokens (no typography
 * plugin installed). Works in both server and client components.
 */
export function Markdown({ content, className }: { content: string; className?: string }) {
  if (!content.trim()) {
    return <p className={cn("text-sm text-muted-foreground italic", className)}>No content yet.</p>;
  }
  return (
    <div className={cn("min-w-0 text-sm leading-7", className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeNodeEmbed, [rehypeSanitize, sanitizeSchema]]}
        components={{
          ...embedComponents,
          h1: ({ children }) => (
            <h1 className="mt-8 mb-4 border-b pb-2 text-2xl font-semibold tracking-tight first:mt-0">
              {children}
            </h1>
          ),
          h2: ({ children }) => (
            <h2 className="mt-8 mb-3 text-xl font-semibold tracking-tight first:mt-0">{children}</h2>
          ),
          h3: ({ children }) => (
            <h3 className="mt-6 mb-2 text-base font-semibold tracking-tight first:mt-0">{children}</h3>
          ),
          h4: ({ children }) => (
            <h4 className="mt-4 mb-2 text-sm font-semibold first:mt-0">{children}</h4>
          ),
          p: ({ children }) => <p className="mb-4 last:mb-0">{children}</p>,
          a: ({ href, children }) => (
            <a
              href={normalizeDocHref(href)}
              className="font-medium text-primary underline underline-offset-4 hover:opacity-80"
              target={href?.startsWith("http") ? "_blank" : undefined}
              rel={href?.startsWith("http") ? "noreferrer" : undefined}
            >
              {children}
            </a>
          ),
          ul: ({ children }) => <ul className="mb-4 list-disc space-y-1 pl-6 last:mb-0">{children}</ul>,
          ol: ({ children }) => <ol className="mb-4 list-decimal space-y-1 pl-6 last:mb-0">{children}</ol>,
          li: ({ children }) => <li className="[&>ul]:mb-0 [&>ol]:mb-0">{children}</li>,
          blockquote: ({ children }) => (
            <blockquote className="mb-4 border-l-2 border-border pl-4 text-muted-foreground italic last:mb-0">
              {children}
            </blockquote>
          ),
          code: ({ className: codeClass, children }) => {
            const isBlock = typeof codeClass === "string" && codeClass.includes("language-");
            if (isBlock) return <code className={codeClass}>{children}</code>;
            return (
              <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[0.8em]">{children}</code>
            );
          },
          pre: ({ children }) => (
            <pre className="mb-4 overflow-x-auto rounded-lg border bg-muted p-4 font-mono text-xs leading-relaxed last:mb-0">
              {children}
            </pre>
          ),
          table: ({ children }) => (
            <div className="mb-4 overflow-x-auto rounded-lg border last:mb-0">
              <table className="w-full border-collapse text-sm">{children}</table>
            </div>
          ),
          thead: ({ children }) => <thead className="bg-muted/50">{children}</thead>,
          th: ({ children }) => (
            <th className="border-b px-3 py-2 text-left font-medium whitespace-nowrap">{children}</th>
          ),
          td: ({ children }) => <td className="border-b px-3 py-2 align-top last:border-b-0">{children}</td>,
          hr: () => <hr className="my-6 border-border" />,
          img: ({ src, alt }) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={typeof src === "string" ? src : undefined} alt={alt ?? ""} className="my-4 max-w-full rounded-lg border" />
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
