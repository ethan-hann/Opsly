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

