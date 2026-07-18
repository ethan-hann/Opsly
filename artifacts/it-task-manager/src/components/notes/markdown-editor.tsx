import { useRef, useCallback } from "react";
import { cn } from "@/lib/utils";

interface MarkdownEditorProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  readOnly?: boolean;
}

type WrapConfig = { prefix: string; suffix: string; placeholder: string };
type LineConfig = { prefix: string };

function insertWrap(
  textarea: HTMLTextAreaElement,
  { prefix, suffix, placeholder }: WrapConfig,
  onChange: (v: string) => void,
) {
  const { selectionStart: start, selectionEnd: end, value } = textarea;
  const selected = value.slice(start, end) || placeholder;
  const before = value.slice(0, start);
  const after = value.slice(end);
  const newValue = `${before}${prefix}${selected}${suffix}${after}`;
  onChange(newValue);
  // Restore selection after React re-render
  requestAnimationFrame(() => {
    textarea.focus();
    const newStart = start + prefix.length;
    const newEnd = newStart + selected.length;
    textarea.setSelectionRange(newStart, newEnd);
  });
}

function insertLinePrefix(
  textarea: HTMLTextAreaElement,
  { prefix }: LineConfig,
  onChange: (v: string) => void,
) {
  const { selectionStart, value } = textarea;
  const lineStart = value.lastIndexOf("\n", selectionStart - 1) + 1;
  const newValue = `${value.slice(0, lineStart)}${prefix}${value.slice(lineStart)}`;
  onChange(newValue);
  requestAnimationFrame(() => {
    textarea.focus();
    textarea.setSelectionRange(selectionStart + prefix.length, selectionStart + prefix.length);
  });
}

function insertBlock(
  textarea: HTMLTextAreaElement,
  text: string,
  onChange: (v: string) => void,
) {
  const { selectionStart, value } = textarea;
  const before = value.slice(0, selectionStart);
  const after = value.slice(selectionStart);
  const newline = before.length > 0 && !before.endsWith("\n") ? "\n" : "";
  const newValue = `${before}${newline}${text}\n${after}`;
  onChange(newValue);
  requestAnimationFrame(() => {
    textarea.focus();
    const pos = before.length + newline.length + text.length + 1;
    textarea.setSelectionRange(pos, pos);
  });
}

export function MarkdownEditor({ value, onChange, placeholder, className, readOnly }: MarkdownEditorProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const wrap = useCallback((cfg: WrapConfig) => {
    if (textareaRef.current) insertWrap(textareaRef.current, cfg, onChange);
  }, [onChange]);

  const linePrefix = useCallback((cfg: LineConfig) => {
    if (textareaRef.current) insertLinePrefix(textareaRef.current, cfg, onChange);
  }, [onChange]);

  const block = useCallback((text: string) => {
    if (textareaRef.current) insertBlock(textareaRef.current, text, onChange);
  }, [onChange]);

  const handleTab = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== "Tab") return;
    e.preventDefault();
    const ta = e.currentTarget;
    const { selectionStart, selectionEnd, value: v } = ta;
    const newValue = `${v.slice(0, selectionStart)}  ${v.slice(selectionEnd)}`;
    onChange(newValue);
    requestAnimationFrame(() => {
      ta.setSelectionRange(selectionStart + 2, selectionStart + 2);
    });
  };

  return (
    <div className={cn("flex flex-col h-full", className)}>
      {/* Toolbar */}
      <div className={cn("flex items-center gap-0.5 px-3 py-1.5 border-b border-border bg-card flex-wrap shrink-0", readOnly && "pointer-events-none opacity-40")}>
        <ToolBtn title="Bold (Ctrl+B)" onClick={() => wrap({ prefix: "**", suffix: "**", placeholder: "bold text" })}>
          <strong className="text-xs">B</strong>
        </ToolBtn>
        <ToolBtn title="Italic (Ctrl+I)" onClick={() => wrap({ prefix: "_", suffix: "_", placeholder: "italic text" })}>
          <em className="text-xs">I</em>
        </ToolBtn>
        <ToolBtn title="Strikethrough" onClick={() => wrap({ prefix: "~~", suffix: "~~", placeholder: "strikethrough" })}>
          <s className="text-xs">S</s>
        </ToolBtn>
        <ToolBtn title="Inline code" onClick={() => wrap({ prefix: "`", suffix: "`", placeholder: "code" })}>
          <span className="text-xs font-mono">`c`</span>
        </ToolBtn>
        <Sep />
        <ToolBtn title="Heading 1" onClick={() => linePrefix({ prefix: "# " })}>
          <span className="text-xs font-mono">H1</span>
        </ToolBtn>
        <ToolBtn title="Heading 2" onClick={() => linePrefix({ prefix: "## " })}>
          <span className="text-xs font-mono">H2</span>
        </ToolBtn>
        <ToolBtn title="Heading 3" onClick={() => linePrefix({ prefix: "### " })}>
          <span className="text-xs font-mono">H3</span>
        </ToolBtn>
        <Sep />
        <ToolBtn title="Bullet list" onClick={() => linePrefix({ prefix: "- " })}>
          <span className="text-xs">• List</span>
        </ToolBtn>
        <ToolBtn title="Numbered list" onClick={() => linePrefix({ prefix: "1. " })}>
          <span className="text-xs">1. List</span>
        </ToolBtn>
        <ToolBtn title="Checklist item" onClick={() => linePrefix({ prefix: "- [ ] " })}>
          <span className="text-xs">☐ Task</span>
        </ToolBtn>
        <Sep />
        <ToolBtn title="Blockquote" onClick={() => linePrefix({ prefix: "> " })}>
          <span className="text-xs">❝</span>
        </ToolBtn>
        <ToolBtn title="Code block" onClick={() => block("```\n\n```")}>
          <span className="text-xs font-mono">{"</>"}</span>
        </ToolBtn>
        <ToolBtn title="Horizontal rule" onClick={() => block("---")}>
          <span className="text-xs">─</span>
        </ToolBtn>
        <ToolBtn title="Link" onClick={() => wrap({ prefix: "[", suffix: "](url)", placeholder: "link text" })}>
          <span className="text-xs">🔗</span>
        </ToolBtn>
      </div>

      {/* Textarea */}
      <textarea
        ref={textareaRef}
        value={value}
        onChange={(e) => !readOnly && onChange(e.target.value)}
        onKeyDown={readOnly ? undefined : handleTab}
        readOnly={readOnly}
        placeholder={placeholder ?? "Write in Markdown…\n\n# Heading\n**bold**, _italic_, `code`\n- bullet list\n1. numbered list"}
        spellCheck
        className={cn(
          "flex-1 w-full resize-none bg-background text-foreground",
          "font-mono text-sm leading-relaxed p-4",
          "focus:outline-none placeholder:text-muted-foreground/50",
          "scrollbar-thin",
          readOnly && "cursor-default select-text",
        )}
      />
    </div>
  );
}

function Sep() {
  return <div className="w-px h-4 bg-border mx-1 shrink-0" />;
}

function ToolBtn({
  onClick,
  title,
  children,
}: {
  onClick: () => void;
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onMouseDown={(e) => {
        e.preventDefault(); // keep textarea focus
        onClick();
      }}
      title={title}
      className="px-2 py-0.5 rounded text-xs font-mono transition-colors select-none text-muted-foreground hover:text-foreground hover:bg-accent"
    >
      {children}
    </button>
  );
}
