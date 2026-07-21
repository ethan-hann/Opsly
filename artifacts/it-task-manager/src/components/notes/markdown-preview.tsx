import { useRef, useEffect, useState } from "react";
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
const sanitizeSchema = {
  ...defaultSchema,
  tagNames: [
    ...(defaultSchema.tagNames ?? []),
    "kbd",
    "mark",
    "sub",
    "sup",
  ],
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
  const divRef = useRef<HTMLDivElement>(null);
  const [svg, setSvg] = useState<string | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    import("mermaid")
      .then(async (mod) => {
        try {
          const mermaid = mod.default;
          mermaid.initialize({
            startOnLoad: false,
            // "antiscript" blocks JS execution inside diagrams while still
            // rendering most diagram types — safer than "loose".
            securityLevel: "antiscript",
          });
          const id = `mermaid-${Math.random().toString(36).slice(2, 9)}`;
          const { svg: rendered } = await mermaid.render(id, code.trim());
          if (!cancelled) setSvg(sanitizeSvg(rendered));
        } catch {
          if (!cancelled) setError(true);
        }
      })
      .catch(() => { if (!cancelled) setError(true); });
    return () => { cancelled = true; };
  }, [code]);

  if (error) {
    return (
      <pre className="bg-muted rounded-md p-3 overflow-x-auto text-xs font-mono border-l-4 border-destructive">
        <code>{code}</code>
      </pre>
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
      ref={divRef}
      className="my-4 overflow-x-auto flex justify-center"
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}

// ─── Callout configuration ────────────────────────────────────────────────────

const CALLOUT_CONFIG = {
  NOTE:    { icon: "ℹ️", border: "border-blue-500",   bg: "bg-blue-500/8",   label: "text-blue-600 dark:text-blue-400" },
  TIP:     { icon: "💡", border: "border-green-500",  bg: "bg-green-500/8",  label: "text-green-600 dark:text-green-400" },
  WARNING: { icon: "⚠️", border: "border-yellow-500", bg: "bg-yellow-500/8", label: "text-yellow-600 dark:text-yellow-400" },
  CAUTION: { icon: "🚨", border: "border-red-500",    bg: "bg-red-500/8",    label: "text-red-600 dark:text-red-400" },
} as const;

type CalloutType = keyof typeof CALLOUT_CONFIG;

function extractCallout(children: React.ReactNode): CalloutType | null {
  const arr = React.Children.toArray(children);
  const firstEl = arr.find(c => React.isValidElement(c)) as React.ReactElement<{ children?: React.ReactNode }> | undefined;
  if (!firstEl) return null;
  const paraChildren = React.Children.toArray(firstEl.props.children ?? []);
  const firstText = paraChildren.find(c => typeof c === "string") as string | undefined;
  if (!firstText) return null;
  const m = firstText.match(/^\[!(NOTE|TIP|WARNING|CAUTION)\]/i);
  return m ? (m[1].toUpperCase() as CalloutType) : null;
}

function stripCalloutMarker(children: React.ReactNode): React.ReactNode {
  const arr = React.Children.toArray(children);
  // rehype-raw inserts "\n" text nodes between block elements, so the first
  // paragraph may not be at index 0. Find the first actual React element.
  let markerStripped = false;
  return arr.map((child) => {
    if (!markerStripped && React.isValidElement(child)) {
      markerStripped = true;
      const el = child as React.ReactElement<{ children?: React.ReactNode }>;
      const paraChildren = React.Children.toArray(el.props.children ?? []);
      // Scan para children to strip the first string that starts with [!TYPE].
      let done = false;
      const next = paraChildren
        .map((pc) => {
          if (!done && typeof pc === "string") {
            done = true;
            return pc.replace(/^\[!(NOTE|TIP|WARNING|CAUTION)\]\n?/i, "").trimStart();
          }
          return pc;
        })
        .filter((pc) => pc !== "");
      return next.length > 0 ? React.cloneElement(el, {}, ...next) : null;
    }
    return child;
  }).filter(Boolean);
}

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
        remarkPlugins={[remarkGfm]}
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

          // Blockquotes — detect GitHub-flavoured callouts
          blockquote: ({ children }) => {
            const calloutType = extractCallout(children);
            if (!calloutType) {
              return (
                <blockquote className="border-l-4 border-primary/40 pl-4 text-muted-foreground italic my-3">
                  {children}
                </blockquote>
              );
            }
            const cfg = CALLOUT_CONFIG[calloutType];
            const cleanedChildren = stripCalloutMarker(children);
            return (
              <div className={cn("rounded-md border-l-4 px-4 py-3 my-4", cfg.border, cfg.bg)}>
                <div className={cn("flex items-center gap-1.5 text-xs font-semibold mb-1.5", cfg.label)}>
                  <span>{cfg.icon}</span>
                  <span>{calloutType}</span>
                </div>
                <div className="text-sm [&>p:first-child]:mt-0 [&>p:last-child]:mb-0">
                  {cleanedChildren}
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
export function openPreviewWindow(title: string, content: string) {
  const win = window.open("", "md-preview", "width=760,height=600,resizable=yes,scrollbars=yes");
  if (!win) return;

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>${escHtml(title)} - Preview</title>
  <style>
    :root { color-scheme: dark; }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background: #0f1117; color: #e2e8f0;
      padding: 2rem; font-size: 15px; line-height: 1.7;
    }
    h1,h2,h3,h4,h5,h6 { margin: 1.2em 0 0.4em; color: #f1f5f9; font-weight: 600; }
    h1 { font-size: 1.8em; border-bottom: 1px solid #334155; padding-bottom: .4em; }
    h2 { font-size: 1.4em; }
    h3 { font-size: 1.2em; }
    p  { margin: .8em 0; }
    a  { color: #38bdf8; }
    ul,ol { margin: .6em 0 .6em 1.4em; }
    li { margin: .25em 0; }
    code { background: #1e293b; padding: 2px 6px; border-radius: 4px; font-family: monospace; font-size: 0.88em; color: #7dd3fc; }
    pre  { background: #1e293b; border-radius: 6px; padding: 1em; overflow-x: auto; margin: .8em 0; }
    pre code { background: none; padding: 0; color: inherit; }
    blockquote { border-left: 3px solid #475569; padding-left: 1em; color: #94a3b8; margin: .8em 0; }
    table { border-collapse: collapse; width: 100%; margin: .8em 0; }
    th,td { border: 1px solid #334155; padding: .4em .75em; text-align: left; }
    th { background: #1e293b; font-weight: 600; }
    hr { border: none; border-top: 1px solid #334155; margin: 1.5em 0; }
    input[type=checkbox] { accent-color: #0ea5e9; margin-right: 4px; }
    img { max-width: 100%; border-radius: 4px; }
    kbd { background: #1e293b; border: 1px solid #475569; border-radius: 3px; padding: 1px 5px; font-family: monospace; font-size: 0.85em; box-shadow: 0 1px 1px rgba(0,0,0,.2); }
    mark { background: #fde04780; color: inherit; padding: 0 2px; border-radius: 2px; }
  </style>
</head>
<body>${markdownToHtmlFallback(content)}</body>
</html>`;

  win.document.open();
  win.document.write(html);
  win.document.close();
  win.document.title = `${title} - Preview`;
}

function escHtml(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Minimal markdown-to-HTML for the popup window (no React available there).
 */
function markdownToHtmlFallback(md: string): string {
  let html = escHtml(md);

  // Fenced code blocks
  html = html.replace(/```[\s\S]*?```/g, (m) => {
    const inner = m.slice(3, -3).replace(/^[^\n]*\n/, "");
    return `<pre><code>${inner}</code></pre>`;
  });
  // Headings
  html = html.replace(/^### (.+)$/gm, "<h3>$1</h3>");
  html = html.replace(/^## (.+)$/gm, "<h2>$1</h2>");
  html = html.replace(/^# (.+)$/gm, "<h1>$1</h1>");
  // HR
  html = html.replace(/^---$/gm, "<hr>");
  // Blockquote
  html = html.replace(/^&gt; (.+)$/gm, "<blockquote>$1</blockquote>");
  // Bold / italic
  html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/_(.+?)_/g, "<em>$1</em>");
  html = html.replace(/~~(.+?)~~/g, "<s>$1</s>");
  // Highlight
  html = html.replace(/==(.+?)==/g, "<mark>$1</mark>");
  // Inline code
  html = html.replace(/`([^`]+)`/g, "<code>$1</code>");
  // Links
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
  // Kbd — match the escaped form produced by escHtml
  html = html.replace(/&lt;kbd&gt;(.+?)&lt;\/kbd&gt;/g, "<kbd>$1</kbd>");
  // Lists
  html = html.replace(/^- \[ \] (.+)$/gm, '<li><input type="checkbox" disabled> $1</li>');
  html = html.replace(/^- \[x\] (.+)$/gm, '<li><input type="checkbox" checked disabled> $1</li>');
  html = html.replace(/^- (.+)$/gm, "<li>$1</li>");
  html = html.replace(/^(\d+)\. (.+)$/gm, "<li>$2</li>");
  // Wrap consecutive <li> in <ul>
  html = html.replace(/(<li>[\s\S]*?<\/li>(\n|$))+/g, "<ul>$&</ul>");
  // Paragraphs
  html = html.replace(/\n\n+/g, "</p><p>");
  html = `<p>${html}</p>`;
  html = html.replace(/<p>(<h[1-6]>|<\/h[1-6]>|<ul>|<\/ul>|<li>|<\/li>|<pre>|<\/pre>|<hr>|<blockquote>)/g, "$1");
  html = html.replace(/(<\/h[1-6]>|<\/ul>|<\/li>|<\/pre>|<hr>|<\/blockquote>)<\/p>/g, "$1");

  return html;
}
