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
  AnchorUrlProvider,
} from "./markdown-config";

interface MarkdownPreviewProps {
  content: string;
  className?: string;
  /** When supplied, heading anchor links produce a fully-qualified deep-link
   *  URL of the form `/notes?note=<noteId>#<headingSlug>` so users can copy
   *  a link that opens the correct note at the right section. */
  noteId?: number | string | null;
}

export function MarkdownPreview({ content, className, noteId }: MarkdownPreviewProps) {
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

  const inner = (
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

  if (noteId != null) {
    const buildUrl = (headingId: string) =>
      `${window.location.origin}${window.location.pathname}?note=${noteId}#${headingId}`;
    return <AnchorUrlProvider buildUrl={buildUrl}>{inner}</AnchorUrlProvider>;
  }

  return inner;
}

