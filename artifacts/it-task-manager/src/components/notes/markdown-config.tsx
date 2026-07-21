/**
 * Shared remark/rehype configuration for all markdown rendering surfaces.
 *
 * Import from here so the editor's built-in preview pane and the standalone
 * MarkdownPreview component always run the same plugin pipeline and produce
 * identical output.
 */

import { useEffect, useState } from "react";
import React from "react";
import remarkGfm from "remark-gfm";
import remarkSupersub from "remark-supersub";
import rehypeRaw from "rehype-raw";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import { cn } from "@/lib/utils";

// ── Sanitization schema ───────────────────────────────────────────────────────
// Extend the default safe-HTML allowlist with presentational tags used by the
// editor toolbar (<kbd>, <mark>, <sub>, <sup>).  All dangerous elements
// (script, style, iframe, object …) and event-handler attributes (on*) remain
// blocked by the defaultSchema.
// data-callout is permitted on <blockquote> so the remarkCallouts plugin's
// hProperties survive the sanitize pass.
export const sanitizeSchema = {
  ...defaultSchema,
  tagNames: [
    ...(defaultSchema.tagNames ?? []),
    "kbd",
    "mark",
    "sub",
    "sup",
  ],
  attributes: {
    ...defaultSchema.attributes,
    blockquote: [
      ...(defaultSchema.attributes?.blockquote ?? []),
      "data-callout",
    ],
  },
};

// ── SVG sanitizer ─────────────────────────────────────────────────────────────
// Strip script elements, event-handler attributes, and javascript: URLs from
// Mermaid SVG output before inserting it into the DOM.
export function sanitizeSvg(svg: string): string {
  return svg
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/\s+on\w+\s*=\s*(['"])[^'"]*\1/gi, "")
    .replace(/href\s*=\s*(['"])javascript:[^'"]*\1/gi, 'href=""')
    .replace(/xlink:href\s*=\s*(['"])javascript:[^'"]*\1/gi, 'xlink:href=""');
}

// ── Mermaid block ─────────────────────────────────────────────────────────────

export function MermaidBlock({ code }: { code: string }) {
  const [svg, setSvg] = useState<string | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    import("mermaid")
      .then(async (mod) => {
        const mermaid = mod.default;
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: "antiscript",
          suppressErrorRendering: true,
        });
        try {
          await mermaid.parse(code.trim());
          const id = `mermaid-${Math.random().toString(36).slice(2, 9)}`;
          const { svg: rendered } = await mermaid.render(id, code.trim());
          if (!cancelled) setSvg(sanitizeSvg(rendered));
        } catch {
          document
            .querySelectorAll('[id^="mermaid-"], [id^="d"][id*="mermaid"]')
            .forEach((el) => el.remove());
          if (!cancelled) setError(true);
        }
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [code]);

  if (error) {
    return (
      <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2.5 my-3 text-xs text-destructive">
        <span className="mt-0.5 shrink-0">⚠</span>
        <div>
          <p className="font-medium">Invalid Mermaid syntax</p>
          <p className="text-destructive/70 mt-0.5">
            Fix the diagram code to see a preview.
          </p>
        </div>
      </div>
    );
  }

  if (svg === null) {
    return (
      <div className="bg-muted rounded-md p-4 text-xs text-muted-foreground animate-pulse my-2">
        Rendering diagram…
      </div>
    );
  }

  return (
    <div
      className="my-4 overflow-x-auto flex justify-center"
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}

// ── Callout remark plugin ─────────────────────────────────────────────────────
// Walks the MDAST looking for blockquotes whose first text node starts with
// [!NOTE], [!TIP], [!WARNING], or [!CAUTION].  When found it stamps
// node.data.hProperties['data-callout'] so the attribute survives the
// remark→rehype→sanitize pipeline, then strips the [!TYPE] prefix from the
// rendered content.

type AstNode = {
  type: string;
  children?: AstNode[];
  value?: string;
  data?: Record<string, unknown>;
};

const CALLOUT_RE = /^\[!(NOTE|TIP|WARNING|CAUTION)\]\n?/i;

function walkForCallouts(node: AstNode): void {
  if (!node.children) return;
  for (const child of node.children) {
    if (child.type === "blockquote") processCalloutBlockquote(child);
    else walkForCallouts(child);
  }
}

function processCalloutBlockquote(node: AstNode): void {
  const children = node.children ?? [];
  const firstPara = children.find((c) => c.type === "paragraph");
  if (!firstPara?.children?.length) return;

  const firstText = firstPara.children[0];
  if (firstText.type !== "text" || !firstText.value) return;

  const m = firstText.value.match(CALLOUT_RE);
  if (!m) return;

  const type = m[1].toUpperCase();
  node.data ??= {};
  // Stamp both data-callout and a CSS class so the type survives any
  // downstream sanitization pass.  data-callout requires our extended
  // sanitizeSchema; className ("class") is allowed on all elements by every
  // sanitize schema including @uiw/react-markdown-preview's internal one.
  (node.data as { hProperties?: Record<string, string> }).hProperties = {
    "data-callout": type,
    className: `callout callout-${type.toLowerCase()}`,
  };

  const stripped = firstText.value.replace(CALLOUT_RE, "").trimStart();
  if (stripped) {
    firstText.value = stripped;
  } else {
    firstPara.children.shift();
    if (firstPara.children.length === 0) {
      const idx = children.indexOf(firstPara);
      if (idx !== -1) children.splice(idx, 1);
    }
  }
}

export function remarkCallouts() {
  return (tree: AstNode) => walkForCallouts(tree);
}

// ── Callout configuration ─────────────────────────────────────────────────────

export const CALLOUT_CONFIG = {
  NOTE:    { icon: "ℹ️", border: "border-blue-500",   bg: "bg-blue-500/8",   label: "text-blue-600 dark:text-blue-400" },
  TIP:     { icon: "💡", border: "border-green-500",  bg: "bg-green-500/8",  label: "text-green-600 dark:text-green-400" },
  WARNING: { icon: "⚠️", border: "border-yellow-500", bg: "bg-yellow-500/8", label: "text-yellow-600 dark:text-yellow-400" },
  CAUTION: { icon: "🚨", border: "border-red-500",    bg: "bg-red-500/8",    label: "text-red-600 dark:text-red-400" },
} as const;

export type CalloutType = keyof typeof CALLOUT_CONFIG;

// ── Shared plugin arrays ──────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const remarkPlugins: any[] = [remarkGfm, remarkSupersub, remarkCallouts];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const rehypePlugins: any[] = [rehypeRaw, [rehypeSanitize, sanitizeSchema]];

// ── Shared component renderers ────────────────────────────────────────────────
// Pass these as the `components` prop to ReactMarkdown (and to
// MDEditor's previewOptions.components) so both rendering surfaces are identical.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const previewComponents: Record<string, React.ComponentType<any>> = {
  // GFM checkboxes
  input: ({ checked, ...props }: React.InputHTMLAttributes<HTMLInputElement>) => (
    <input
      type="checkbox"
      checked={checked}
      readOnly
      className="mr-1.5 accent-primary"
      {...props}
    />
  ),

  // Code blocks — detect mermaid; fall back to styled <pre>
  pre: ({
    children,
    ...props
  }: React.HTMLAttributes<HTMLPreElement>) => {
    const child = React.Children.toArray(children)[0] as React.ReactElement<{
      className?: string;
      children?: React.ReactNode;
    }> | undefined;
    if (
      React.isValidElement(child) &&
      child.props.className?.includes("language-mermaid")
    ) {
      const code = String(child.props.children ?? "").replace(/\n$/, "");
      return <MermaidBlock code={code} />;
    }
    return (
      <pre
        className="bg-muted rounded-md p-3 overflow-x-auto text-xs font-mono"
        {...props}
      >
        {children}
      </pre>
    );
  },

  code: ({
    children,
    className: cls,
    ...props
  }: React.HTMLAttributes<HTMLElement>) => {
    const isBlock = (cls as string | undefined)?.includes("language-");
    return isBlock ? (
      <code className={cn("font-mono", cls)} {...props}>
        {children}
      </code>
    ) : (
      <code
        className="bg-muted px-1.5 py-0.5 rounded text-xs font-mono"
        {...props}
      >
        {children}
      </code>
    );
  },

  kbd: ({ children }: React.HTMLAttributes<HTMLElement>) => (
    <kbd className="px-1.5 py-0.5 text-xs font-mono bg-muted border border-border/80 rounded shadow-[0_1px_1px_rgba(0,0,0,0.15)] not-italic">
      {children}
    </kbd>
  ),

  table: ({ children }: React.HTMLAttributes<HTMLTableElement>) => (
    <div className="overflow-x-auto my-4">
      <table className="w-full border-collapse border border-border text-sm">
        {children}
      </table>
    </div>
  ),
  th: ({ children }: React.HTMLAttributes<HTMLTableCellElement>) => (
    <th className="border border-border px-3 py-1.5 text-left bg-muted font-semibold">
      {children}
    </th>
  ),
  td: ({ children }: React.HTMLAttributes<HTMLTableCellElement>) => (
    <td className="border border-border px-3 py-1.5">{children}</td>
  ),

  // Blockquotes — render GitHub-style callouts when the node was tagged by
  // remarkCallouts.  We check two signals in priority order:
  //   1. data-callout="NOTE" — set by our extended sanitizeSchema; survives in
  //      react-markdown's own pipeline.
  //   2. className contains "callout-note" — class is allowed on all elements
  //      by every sanitize schema, so this survives @uiw/react-markdown-preview's
  //      internal sanitization pass too.
  blockquote: ({
    children,
    className,
    ...props
  }: React.HTMLAttributes<HTMLQuoteElement>) => {
    const dataCallout = (props as Record<string, unknown>)[
      "data-callout"
    ] as string | undefined;

    // Extract type from className="callout callout-note" → "NOTE"
    const classCallout = typeof className === "string"
      ? (className.match(/\bcallout-([a-z]+)\b/) ?? [])[1]?.toUpperCase()
      : undefined;

    const raw = dataCallout ?? classCallout;
    const calloutType =
      raw && raw in CALLOUT_CONFIG ? (raw as CalloutType) : null;

    if (!calloutType) {
      return (
        <blockquote className="border-l-4 border-primary/40 pl-4 text-muted-foreground italic my-3">
          {children}
        </blockquote>
      );
    }

    const cfg = CALLOUT_CONFIG[calloutType];
    return (
      <div
        className={cn(
          "rounded-md border-l-4 px-4 py-3 my-4",
          cfg.border,
          cfg.bg,
        )}
      >
        <div
          className={cn(
            "flex items-center gap-1.5 text-xs font-semibold mb-1.5",
            cfg.label,
          )}
        >
          <span>{cfg.icon}</span>
          <span>{calloutType}</span>
        </div>
        <div className="text-sm [&>p:first-child]:mt-0 [&>p:last-child]:mb-0">
          {children}
        </div>
      </div>
    );
  },
};
