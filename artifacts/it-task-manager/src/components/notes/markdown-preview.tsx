import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import React from "react";
import { cn } from "@/lib/utils";

interface MarkdownPreviewProps {
  content: string;
  className?: string;
}

// ─── Sanitization schema ──────────────────────────────────────────────────────
// Extend the default safe-HTML allowlist with a handful of presentational
// elements used by the editor (<kbd>, <mark>, <sub>, <sup>).  All dangerous
// elements (script, style, iframe, object …) and event-handler attributes
// (on*) remain blocked by the defaultSchema.
// data-callout is permitted on <blockquote> so the callout remark plugin's
// hProperties survive the sanitize pass.
const sanitizeSchema = {
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

// ─── SVG sanitizer ────────────────────────────────────────────────────────────
// Strip script elements, event-handler attributes, and javascript: URLs from
// SVG output before inserting it into the DOM.
function sanitizeSvg(svg: string): string {
  return svg
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/\s+on\w+\s*=\s*(['"])[^'"]*\1/gi, "")
    .replace(/href\s*=\s*(['"])javascript:[^'"]*\1/gi, 'href=""')
    .replace(/xlink:href\s*=\s*(['"])javascript:[^'"]*\1/gi, 'xlink:href=""');
}

// ─── Mermaid block ────────────────────────────────────────────────────────────

function MermaidBlock({ code }: { code: string }) {
  const [svg, setSvg] = useState<string | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    import("mermaid")
      .then(async (mod) => {
        const mermaid = mod.default;
        mermaid.initialize({
          startOnLoad: false,
          // "antiscript" blocks JS execution inside diagrams while still
          // rendering most diagram types — safer than "loose".
          securityLevel: "antiscript",
          // Suppress mermaid's own error rendering into the document body.
          suppressErrorRendering: true,
        });
        try {
          // parse() throws on syntax errors before we ever call render(),
          // preventing mermaid from injecting its error SVG into the DOM.
          await mermaid.parse(code.trim());
          const id = `mermaid-${Math.random().toString(36).slice(2, 9)}`;
          const { svg: rendered } = await mermaid.render(id, code.trim());
          if (!cancelled) setSvg(sanitizeSvg(rendered));
        } catch {
          // Clean up any orphaned elements mermaid may have injected.
          document.querySelectorAll('[id^="mermaid-"], [id^="d"][id*="mermaid"]').forEach(el => el.remove());
          if (!cancelled) setError(true);
        }
      })
      .catch(() => { if (!cancelled) setError(true); });
    return () => { cancelled = true; };
  }, [code]);

  if (error) {
    return (
      <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2.5 my-3 text-xs text-destructive">
        <span className="mt-0.5 shrink-0">⚠</span>
        <div>
          <p className="font-medium">Invalid Mermaid syntax</p>
          <p className="text-destructive/70 mt-0.5">Fix the diagram code to see a preview.</p>
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

// ─── Callout remark plugin ────────────────────────────────────────────────────
// Walks the MDAST (Markdown AST) looking for blockquotes whose first text
// starts with [!NOTE], [!TIP], [!WARNING], or [!CAUTION].  When found:
//   • stamps node.data.hProperties['data-callout'] = TYPE so the attribute
//     survives the remark→rehype→sanitize pipeline
//   • strips the [!TYPE] prefix from the first text node so the rendered
//     content is clean
// This runs before rehype, avoiding the fragile React-children manipulation
// that caused markers to remain visible.

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
  const firstPara = children.find(c => c.type === "paragraph");
  if (!firstPara?.children?.length) return;

  const firstText = firstPara.children[0];
  if (firstText.type !== "text" || !firstText.value) return;

  const m = firstText.value.match(CALLOUT_RE);
  if (!m) return;

  const type = m[1].toUpperCase();

  // Stamp hProperties so the attribute survives rehype-sanitize.
  node.data ??= {};
  (node.data as { hProperties?: Record<string, string> }).hProperties = {
    "data-callout": type,
  };

  // Strip [!TYPE] from the first text node.
  const stripped = firstText.value.replace(CALLOUT_RE, "").trimStart();
  if (stripped) {
    firstText.value = stripped;
  } else {
    // The whole first text node is just the marker — remove it.
    firstPara.children.shift();
    // If that empties the paragraph, remove the paragraph too.
    if (firstPara.children.length === 0) {
      const idx = children.indexOf(firstPara);
      if (idx !== -1) children.splice(idx, 1);
    }
  }
}

function remarkCallouts() {
  return (tree: AstNode) => walkForCallouts(tree);
}

// ─── Callout configuration ────────────────────────────────────────────────────

const CALLOUT_CONFIG = {
  NOTE:    { icon: "ℹ️", border: "border-blue-500",   bg: "bg-blue-500/8",   label: "text-blue-600 dark:text-blue-400" },
  TIP:     { icon: "💡", border: "border-green-500",  bg: "bg-green-500/8",  label: "text-green-600 dark:text-green-400" },
  WARNING: { icon: "⚠️", border: "border-yellow-500", bg: "bg-yellow-500/8", label: "text-yellow-600 dark:text-yellow-400" },
  CAUTION: { icon: "🚨", border: "border-red-500",    bg: "bg-red-500/8",    label: "text-red-600 dark:text-red-400" },
} as const;

type CalloutType = keyof typeof CALLOUT_CONFIG;

// ─── Main component ───────────────────────────────────────────────────────────

export function MarkdownPreview({ content, className }: MarkdownPreviewProps) {
  if (!content.trim()) {
    return (
      <div className={cn("flex items-center justify-center text-muted-foreground/50 text-sm", className)}>
        Preview will appear here
      </div>
    );
  }

  return (
    <div className={cn("overflow-y-auto px-6 py-5", className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkCallouts]}
        // rehype-raw parses author-supplied raw HTML; rehype-sanitize
        // immediately strips anything dangerous (script, event handlers,
        // javascript: URLs) while keeping safe presentational tags.
        rehypePlugins={[rehypeRaw, [rehypeSanitize, sanitizeSchema]]}
        className="prose prose-sm dark:prose-invert max-w-none"
        components={{
          // GFM checkboxes
          input: ({ checked, ...props }) => (
            <input
              type="checkbox"
              checked={checked}
              readOnly
              className="mr-1.5 accent-primary"
              {...props}
            />
          ),

          // Code blocks — detect mermaid; fallback to styled <pre>
          pre: ({ children, ...props }) => {
            const child = React.Children.toArray(children)[0] as React.ReactElement<{
              className?: string;
              children?: React.ReactNode;
            }> | undefined;
            if (React.isValidElement(child) && child.props.className?.includes("language-mermaid")) {
              const code = String(child.props.children ?? "").replace(/\n$/, "");
              return <MermaidBlock code={code} />;
            }
            return (
              <pre className="bg-muted rounded-md p-3 overflow-x-auto text-xs font-mono" {...props}>
                {children}
              </pre>
            );
          },

          code: ({ children, className: cls, ...props }) => {
            const isBlock = cls?.includes("language-");
            return isBlock ? (
              <code className={cn("font-mono", cls)} {...props}>{children}</code>
            ) : (
              <code className="bg-muted px-1.5 py-0.5 rounded text-xs font-mono" {...props}>{children}</code>
            );
          },

          // Keyboard key badge (allowed by sanitizeSchema)
          kbd: ({ children }) => (
            <kbd className="px-1.5 py-0.5 text-xs font-mono bg-muted border border-border/80 rounded shadow-[0_1px_1px_rgba(0,0,0,0.15)] not-italic">
              {children}
            </kbd>
          ),

          // Tables
          table: ({ children }) => (
            <div className="overflow-x-auto my-4">
              <table className="w-full border-collapse border border-border text-sm">{children}</table>
            </div>
          ),
          th: ({ children }) => (
            <th className="border border-border px-3 py-1.5 text-left bg-muted font-semibold">{children}</th>
          ),
          td: ({ children }) => (
            <td className="border border-border px-3 py-1.5">{children}</td>
          ),

          // Blockquotes — render GitHub-flavoured callouts via data-callout
          // stamped by the remarkCallouts plugin, plain blockquotes otherwise.
          blockquote: ({ children, ...props }) => {
            const dataCallout = (props as Record<string, unknown>)["data-callout"] as string | undefined;
            const calloutType = dataCallout && dataCallout in CALLOUT_CONFIG
              ? (dataCallout as CalloutType)
              : null;

            if (!calloutType) {
              return (
                <blockquote className="border-l-4 border-primary/40 pl-4 text-muted-foreground italic my-3">
                  {children}
                </blockquote>
              );
            }

            const cfg = CALLOUT_CONFIG[calloutType];
            return (
              <div className={cn("rounded-md border-l-4 px-4 py-3 my-4", cfg.border, cfg.bg)}>
                <div className={cn("flex items-center gap-1.5 text-xs font-semibold mb-1.5", cfg.label)}>
                  <span>{cfg.icon}</span>
                  <span>{calloutType}</span>
                </div>
                <div className="text-sm [&>p:first-child]:mt-0 [&>p:last-child]:mb-0">
                  {children}
                </div>
              </div>
            );
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

/**
 * Opens a popup window containing the rendered markdown.
 * Call this when the user chooses "New Window" dock mode.
 */
// eslint-disable-next-line react-refresh/only-export-components -- utility co-located with the component by design
/**
 * Escape a string for safe interpolation inside an HTML context.
 * Covers all five HTML special characters so user-controlled content cannot
 * inject tags, close existing tags, or inject script via attribute values.
 */
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function openPreviewWindow(title: string, content: string) {
  const win = window.open("", "_blank", "width=800,height=600");
  if (!win) return;

  // Use DOM APIs for the title (never interpolated into raw HTML).
  // The body <pre> content is fully HTML-escaped before being passed to
  // document.write so that no user-supplied value can inject markup or script.
  const safeTitle = escapeHtml(title);
  const safeContent = escapeHtml(content);

  win.document.write(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>${safeTitle} \u2014 Preview</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 800px; margin: 2rem auto; padding: 0 1rem; }
    pre { background: #f5f5f5; padding: 1rem; border-radius: 6px; overflow-x: auto; }
    code { font-family: monospace; background: #f5f5f5; padding: 0.2em 0.4em; border-radius: 3px; }
    blockquote { border-left: 4px solid #ccc; margin: 0; padding-left: 1rem; color: #666; }
    table { border-collapse: collapse; width: 100%; }
    th, td { border: 1px solid #ddd; padding: 0.5rem; text-align: left; }
    th { background: #f5f5f5; }
    img { max-width: 100%; }
  </style>
</head>
<body>
  <pre style="white-space:pre-wrap">${safeContent}</pre>
</body>
</html>`);
  win.document.close();
}
