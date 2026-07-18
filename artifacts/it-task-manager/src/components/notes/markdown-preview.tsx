import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";

interface MarkdownPreviewProps {
  content: string;
  className?: string;
}

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
        className="prose prose-sm dark:prose-invert max-w-none"
        components={{
          // Render GFM task-list checkboxes properly
          input: ({ checked, ...props }) => (
            <input
              type="checkbox"
              checked={checked}
              readOnly
              className="mr-1.5 accent-primary"
              {...props}
            />
          ),
          // Code blocks with subtle background
          pre: ({ children, ...props }) => (
            <pre
              className="bg-muted rounded-md p-3 overflow-x-auto text-xs font-mono"
              {...props}
            >
              {children}
            </pre>
          ),
          code: ({ children, className: cls, ...props }) => {
            const isBlock = cls?.includes("language-");
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
          // Tables
          table: ({ children }) => (
            <div className="overflow-x-auto my-4">
              <table className="w-full border-collapse border border-border text-sm">
                {children}
              </table>
            </div>
          ),
          th: ({ children }) => (
            <th className="border border-border px-3 py-1.5 text-left bg-muted font-semibold">
              {children}
            </th>
          ),
          td: ({ children }) => (
            <td className="border border-border px-3 py-1.5">{children}</td>
          ),
          // Blockquotes
          blockquote: ({ children }) => (
            <blockquote className="border-l-4 border-primary/40 pl-4 text-muted-foreground italic my-3">
              {children}
            </blockquote>
          ),
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
export function openPreviewWindow(title: string, content: string) {
  const win = window.open("", "md-preview", "width=760,height=600,resizable=yes,scrollbars=yes");
  if (!win) return;

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>${escHtml(title)} — Preview</title>
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
  </style>
</head>
<body>${markdownToHtmlFallback(content)}</body>
</html>`;

  win.document.open();
  win.document.write(html);
  win.document.close();
  win.document.title = `${title} — Preview`;
}

function escHtml(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Minimal markdown-to-HTML for the popup window (no React available there).
 * Good enough for headings, bold, italic, code, lists, blockquote, hr, links.
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
  // Inline code
  html = html.replace(/`([^`]+)`/g, "<code>$1</code>");
  // Links
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
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
