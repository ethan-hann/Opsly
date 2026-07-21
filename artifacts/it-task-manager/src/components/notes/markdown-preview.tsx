/**
 * MarkdownPreview — read-only rendered markdown using react-markdown.
 *
 * Shares the remark/rehype plugin pipeline with MarkdownEditor via
 * markdown-config.ts so both surfaces produce identical output.
 */

import ReactMarkdown from "react-markdown";
import { cn } from "@/lib/utils";
import {
  remarkPlugins,
  rehypePlugins,
  previewComponents,
} from "./markdown-config";

interface MarkdownPreviewProps {
  content: string;
  className?: string;
}

export function MarkdownPreview({ content, className }: MarkdownPreviewProps) {
  if (!content.trim()) {
    return (
      <div
        className={cn(
          "flex items-center justify-center text-muted-foreground/50 text-sm",
          className,
        )}
      >
        Preview will appear here
      </div>
    );
  }

  return (
    <div className={cn("overflow-y-auto px-6 py-5", className)}>
      <ReactMarkdown
        remarkPlugins={remarkPlugins}
        rehypePlugins={rehypePlugins}
        className="prose prose-sm dark:prose-invert max-w-none"
        components={previewComponents}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

// ── Preview window utility ────────────────────────────────────────────────────

/**
 * Escape a string for safe interpolation inside an HTML context.
 */
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Opens a popup window containing the raw markdown (pre-formatted).
 * Call this when the user chooses "New Window" dock mode.
 */
// eslint-disable-next-line react-refresh/only-export-components -- utility co-located with the component by design
export function openPreviewWindow(title: string, content: string) {
  const win = window.open("", "_blank", "width=800,height=600");
  if (!win) return;

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
