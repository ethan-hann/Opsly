/**
 * MarkdownEditor — thin wrapper around @uiw/react-md-editor.
 *
 * Preserves the existing prop API (value / onChange / placeholder /
 * className / readOnly) so all consumer files need zero prop-level changes.
 *
 * The editor's built-in preview pane and the standalone MarkdownPreview
 * component share the same remark/rehype plugin pipeline via markdown-config.ts,
 * so both surfaces render identically.
 */

import MDEditor from "@uiw/react-md-editor";
import "@uiw/react-md-editor/markdown-editor.css";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { remarkPlugins, rehypePlugins, previewComponents } from "./markdown-config";

interface MarkdownEditorProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  readOnly?: boolean;
}

/**
 * Detect the current color mode by inspecting the `dark` class on
 * <html> (set by the app's ThemeProvider), and watch for changes.
 */
function useColorMode(): "light" | "dark" {
  const [colorMode, setColorMode] = useState<"light" | "dark">(() =>
    typeof document !== "undefined" &&
    document.documentElement.classList.contains("dark")
      ? "dark"
      : "light",
  );

  useEffect(() => {
    const observer = new MutationObserver(() => {
      setColorMode(
        document.documentElement.classList.contains("dark") ? "dark" : "light",
      );
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });
    return () => observer.disconnect();
  }, []);

  return colorMode;
}

export function MarkdownEditor({
  value,
  onChange,
  placeholder,
  className,
  readOnly = false,
}: MarkdownEditorProps) {
  const colorMode = useColorMode();

  return (
    // data-color-mode drives @uiw/react-md-editor's own light/dark theming.
    <div data-color-mode={colorMode} className={cn("wmde-markdown-var", className)}>
      <MDEditor
        value={value}
        onChange={(v) => onChange(v ?? "")}
        preview={readOnly ? "preview" : "edit"}
        // Fill the wrapper's height; the parent (className) controls the size.
        height="100%"
        // Hide the drag-bar resizer — layout is controlled externally.
        visibleDragbar={false}
        previewOptions={{
          remarkPlugins,
          rehypePlugins,
          components: previewComponents,
        }}
        textareaProps={{ placeholder }}
      />
    </div>
  );
}
