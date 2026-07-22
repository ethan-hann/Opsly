/**
 * Shared remark/rehype configuration for all markdown rendering surfaces.
 *
 * Import from here so the editor's built-in preview pane and the standalone
 * MarkdownPreview component always run the same plugin pipeline and produce
 * identical output.
 */

import { useEffect, useRef, useState } from "react";
import React from "react";
import { useTranslation } from "react-i18next";
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
    // remark-github-blockquote-alert transforms [!NOTE] blockquotes into
    // <div class="markdown-alert markdown-alert-note"> elements with an SVG
    // octicon title.  div/svg/path are not in the defaultSchema so they would
    // be stripped, leaving bare unstyled paragraphs.
    "div",
    "svg",
    "path",
  ],
  attributes: {
    ...defaultSchema.attributes,
    // hast-util-sanitize uses HAST property names (camelCase), NOT HTML
    // attribute names.  The defaultSchema "*" list does NOT include "className"
    // (the HAST name for the HTML "class" attribute), so rehypeSanitize strips
    // class from every element — breaking all class-based callout detection.
    // Adding "className" here restores it globally.
    "*": [
      ...(defaultSchema.attributes?.["*"] ?? []),
      "className",
    ],
    blockquote: [
      ...(defaultSchema.attributes?.blockquote ?? []),
      // data-callout is set by remarkCallouts as the hProperties key
      // "data-callout" (kept hyphenated — mdast-util-to-hast does not
      // camelCase hProperties keys).  "data*" catches it either way.
      "data-callout",
      "data*",
    ],
    // Allow the attributes the alert plugin stamps on its elements.
    // The library's copyElement() sets properties.class (HTML attribute form,
    // not the HAST camelCase "className"), so both names must be allowed for
    // the copy button's class to survive rehypeSanitize.
    // "data*" covers the data-code attribute copyElement also sets.
    div:  ["className", "class", "dir", "data*"],
    p:    [...(defaultSchema.attributes?.p    ?? []), "dir"],
    svg:  ["className", "viewBox", "width", "height", "ariaHidden"],
    path: ["d"],
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

// Module-level singleton — mermaid.initialize() must only be called once.
// Calling it per-component in mermaid 11 resets the internal render queue and
// causes every concurrent diagram to fail silently.
let _mermaidReady: Promise<typeof import("mermaid").default> | null = null;
function getMermaid() {
  if (!_mermaidReady) {
    _mermaidReady = import("mermaid").then((mod) => {
      const m = mod.default;
      // "antiscript" was removed in mermaid 11; "loose" is the safe replacement.
      m.initialize({ startOnLoad: false, securityLevel: "loose", suppressErrorRendering: true });
      return m;
    });
  }
  return _mermaidReady;
}

export function MermaidBlock({ code }: { code: string }) {
  const { t } = useTranslation();
  // The mermaid target div must ALWAYS be in the DOM so elRef is never null
  // when the useEffect fires.  We hide/show it with CSS instead of conditional
  // rendering so mermaid.run() always has a real, attached element to write into.
  const elRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<"loading" | "done" | "error">("loading");

  useEffect(() => {
    const el = elRef.current;
    if (!el) return;
    let cancelled = false;
    setStatus("loading");

    getMermaid()
      .then(async (mermaid) => {
        try {
          // Validate syntax first so we surface parse errors before touching DOM.
          await mermaid.parse(code.trim());
          // Set diagram source as text content; mermaid.run() replaces it with SVG.
          el.textContent = code.trim();
          el.removeAttribute("data-processed");
          await mermaid.run({ nodes: [el], suppressErrors: false });
          if (!cancelled) setStatus("done");
        } catch (err) {
          console.error("[MermaidBlock] render error:", err);
          if (!cancelled) setStatus("error");
        }
      })
      .catch((err) => {
        console.error("[MermaidBlock] mermaid load error:", err);
        if (!cancelled) setStatus("error");
      });

    return () => { cancelled = true; };
  }, [code]);

  return (
    <>
      {status === "loading" && (
        <div className="bg-muted rounded-md p-4 text-xs text-muted-foreground animate-pulse my-2">
          {t('markdown.renderingDiagram')}
        </div>
      )}
      {status === "error" && (
        <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2.5 my-3 text-xs text-destructive">
          <span className="mt-0.5 shrink-0">⚠</span>
          <div>
            <p className="font-medium">{t('markdown.invalidMermaid')}</p>
            <p className="text-destructive/70 mt-0.5">
              {t('markdown.fixDiagram')}
            </p>
          </div>
        </div>
      )}
      {/* Always mounted — mermaid.run() writes SVG into this element in-place.
          Must NOT use display:none (Tailwind "hidden") while rendering: D3 cannot
          measure elements that are removed from layout, producing translate(NaN).
          Instead we position it off-screen so it has real computed dimensions. */}
      <div
        ref={elRef}
        className="mermaid my-4 overflow-x-auto flex justify-center"
        style={status !== "done" ? {
          position: "absolute",
          visibility: "hidden",
          pointerEvents: "none",
          width: "100%",
        } : undefined}
      />
    </>
  );
}

// ── Highlight remark plugin (==text== → <mark>) ───────────────────────────────
// remark-gfm and remark-supersub do not understand ==...== syntax.  This plugin
// walks every text node and splits it on ==...== pairs, replacing each pair with
// a <mark> HAST node so the sanitize pass (which already allows <mark>) lets it
// through to the browser.

type MdastNode = {
  type: string;
  children?: MdastNode[];
  value?: string;
  data?: Record<string, unknown>;
};

function processHighlight(parent: MdastNode): void {
  if (!parent.children) return;

  // Recurse depth-first so nested structures are already settled before we
  // inspect this level's text nodes.
  for (const child of parent.children) {
    processHighlight(child);
  }

  const next: MdastNode[] = [];
  for (const child of parent.children) {
    if (child.type !== "text" || !child.value || !child.value.includes("==")) {
      next.push(child);
      continue;
    }

    // Split on ==...== with a capturing group so alternating parts are
    // [plain, marked, plain, marked, …].
    const parts = child.value.split(/(==.+?==)/s);
    if (parts.length === 1) {
      next.push(child);
      continue;
    }

    parts.forEach((part, idx) => {
      if (idx % 2 === 0) {
        // Plain text segment — only push if non-empty.
        if (part) next.push({ type: "text", value: part });
      } else {
        // Matched ==...== segment — strip the delimiters and wrap in <mark>.
        next.push({
          type: "mark",
          data: { hName: "mark" },
          children: [{ type: "text", value: part.slice(2, -2) }],
        });
      }
    });
  }

  parent.children = next;
}

export function remarkHighlight() {
  return (tree: MdastNode) => processHighlight(tree);
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
  // sky-500 (cyan-adjacent) avoids the dark-navy appearance blue-500 gives on dark stone backgrounds
  NOTE:    { icon: "ℹ️", border: "border-sky-500",    bg: "bg-sky-500/8",    label: "text-sky-600 dark:text-sky-300" },
  TIP:     { icon: "💡", border: "border-green-500",  bg: "bg-green-500/8",  label: "text-green-600 dark:text-green-400" },
  WARNING: { icon: "⚠️", border: "border-yellow-500", bg: "bg-yellow-500/8", label: "text-yellow-600 dark:text-yellow-400" },
  CAUTION: { icon: "🚨", border: "border-red-500",    bg: "bg-red-500/8",    label: "text-red-600 dark:text-red-400" },
} as const;

export type CalloutType = keyof typeof CALLOUT_CONFIG;

// ── Shared plugin arrays ──────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
// remarkGfm is configured with singleTilde:false so that ~text~ is NOT consumed
// as GFM strikethrough — leaving it for remark-supersub to render as <sub>.
// GFM strikethrough still works with ~~text~~ (double tilde).
export const remarkPlugins: any[] = [[remarkGfm, { singleTilde: false }], remarkSupersub, remarkHighlight, remarkCallouts];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const rehypePlugins: any[] = [rehypeRaw, [rehypeSanitize, sanitizeSchema]];

// ── Shared component renderers ────────────────────────────────────────────────
// Pass these as the `components` prop to ReactMarkdown (and to
// MDEditor's previewOptions.components) so both rendering surfaces are identical.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
// Recursively extract plain text from a React node tree.
// String() on an array of React elements produces "[object Object],..." so we
// walk children ourselves to collect only the string leaves.
function extractNodeText(node: React.ReactNode): string {
  if (typeof node === "string") return node;
  if (typeof node === "number" || typeof node === "boolean") return String(node);
  if (Array.isArray(node)) return node.map(extractNodeText).join("");
  if (React.isValidElement(node)) {
    const el = node as React.ReactElement<{ children?: React.ReactNode }>;
    return extractNodeText(el.props.children);
  }
  return "";
}

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
      // child.props.children may be a React node tree, not a plain string.
      // String() on an array of React elements produces "[object Object],..."
      // so we walk the tree to collect text leaves instead.
      const code = extractNodeText(child.props.children).replace(/\n$/, "");
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

  // ==text== highlight — yellow background that works in both light and dark mode
  mark: ({ children }: React.HTMLAttributes<HTMLElement>) => (
    <mark className="bg-yellow-200 dark:bg-yellow-500/30 text-yellow-900 dark:text-yellow-200 rounded px-0.5">
      {children}
    </mark>
  ),

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

  // Divs — intercept the <div class="markdown-alert markdown-alert-note"> that
  // remark-github-blockquote-alert (pre-pended by @uiw/react-markdown-preview)
  // emits for [!NOTE] / [!TIP] / [!WARNING] / [!CAUTION] / [!IMPORTANT].
  // The library also adds a <p class="markdown-alert-title"> child with an SVG
  // octicon and the type label; we filter that out and render our own header so
  // the callout appearance is identical to the standalone MarkdownPreview path.
  div: ({
    children,
    className,
    ...props
  }: React.HTMLAttributes<HTMLDivElement>) => {
    const match =
      typeof className === "string"
        ? className.match(/\bmarkdown-alert-([a-z]+)\b/)
        : null;
    const alertType = match?.[1]?.toUpperCase();
    const calloutType =
      alertType && alertType in CALLOUT_CONFIG
        ? (alertType as CalloutType)
        : null;

    if (!calloutType) {
      return <div className={className} {...props}>{children}</div>;
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
          {React.Children.map(children, (child) => {
            // Skip the library's own title paragraph — we rendered ours above
            if (
              React.isValidElement(child) &&
              typeof (child.props as { className?: string }).className ===
                "string" &&
              (child.props as { className: string }).className.includes(
                "markdown-alert-title",
              )
            ) {
              return null;
            }
            return child;
          })}
        </div>
      </div>
    );
  },
};
