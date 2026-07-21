import { useRef, useCallback, useState, useEffect, useMemo } from "react";
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

// ─── Language picker options ─────────────────────────────────────────────────

const LANGUAGES = [
  { label: "Plain (no tag)", value: "" },
  { label: "Python", value: "python" },
  { label: "JavaScript", value: "javascript" },
  { label: "TypeScript", value: "typescript" },
  { label: "Bash / Shell", value: "bash" },
  { label: "SQL", value: "sql" },
  { label: "JSON", value: "json" },
  { label: "YAML", value: "yaml" },
  { label: "HTML", value: "html" },
  { label: "CSS", value: "css" },
  { label: "Go", value: "go" },
  { label: "Rust", value: "rust" },
  { label: "Java", value: "java" },
  { label: "C", value: "c" },
  { label: "C++", value: "cpp" },
  { label: "Mermaid", value: "mermaid" },
];

const CALLOUTS = [
  { label: "Note", value: "NOTE", icon: "ℹ️" },
  { label: "Tip", value: "TIP", icon: "💡" },
  { label: "Warning", value: "WARNING", icon: "⚠️" },
  { label: "Caution", value: "CAUTION", icon: "🚨" },
];

// ─── Pure helpers (no React) ──────────────────────────────────────────────────

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

function insertCodeBlock(
  textarea: HTMLTextAreaElement,
  lang: string,
  onChange: (v: string) => void,
) {
  const fence = lang ? "```" + lang : "```";
  const { selectionStart, value } = textarea;
  const before = value.slice(0, selectionStart);
  const after = value.slice(selectionStart);
  const newline = before.length > 0 && !before.endsWith("\n") ? "\n" : "";
  const text = `${fence}\n\n\`\`\``;
  const newValue = `${before}${newline}${text}\n${after}`;
  onChange(newValue);
  requestAnimationFrame(() => {
    textarea.focus();
    // Place cursor on the blank line between the fences
    const cursorPos = before.length + newline.length + fence.length + 1;
    textarea.setSelectionRange(cursorPos, cursorPos);
  });
}

function insertTable(
  textarea: HTMLTextAreaElement,
  onChange: (v: string) => void,
) {
  const { selectionStart, value } = textarea;
  const before = value.slice(0, selectionStart);
  const after = value.slice(selectionStart);
  const nl = before.length > 0 && !before.endsWith("\n") ? "\n" : "";
  const header = "| Column 1 | Column 2 | Column 3 |";
  const sep    = "| -------- | -------- | -------- |";
  const row    = "| Cell     | Cell     | Cell     |";
  const text   = `${header}\n${sep}\n${row}`;
  const newValue = `${before}${nl}${text}\n${after}`;
  onChange(newValue);
  requestAnimationFrame(() => {
    textarea.focus();
    // Select "Cell" text in the first data cell
    const base = before.length + nl.length + header.length + 1 + sep.length + 1;
    const cellStart = base + 2; // skip "| "
    textarea.setSelectionRange(cellStart, cellStart + 4); // "Cell"
  });
}

function insertCallout(
  textarea: HTMLTextAreaElement,
  variant: string,
  onChange: (v: string) => void,
) {
  const { selectionStart, value } = textarea;
  const before = value.slice(0, selectionStart);
  const after = value.slice(selectionStart);
  const nl = before.length > 0 && !before.endsWith("\n") ? "\n" : "";
  const header = `> [!${variant}]`;
  const contentPrefix = "\n> ";
  const text = header + contentPrefix;
  const newValue = `${before}${nl}${text}\n${after}`;
  onChange(newValue);
  requestAnimationFrame(() => {
    textarea.focus();
    const cursorPos = before.length + nl.length + text.length;
    textarea.setSelectionRange(cursorPos, cursorPos);
  });
}

function doIndentLine(
  textarea: HTMLTextAreaElement,
  onChange: (v: string) => void,
) {
  const { selectionStart, value } = textarea;
  const lineStart = value.lastIndexOf("\n", selectionStart - 1) + 1;
  const newValue = `${value.slice(0, lineStart)}  ${value.slice(lineStart)}`;
  onChange(newValue);
  requestAnimationFrame(() => {
    textarea.focus();
    textarea.setSelectionRange(selectionStart + 2, selectionStart + 2);
  });
}

function doOutdentLine(
  textarea: HTMLTextAreaElement,
  onChange: (v: string) => void,
) {
  const { selectionStart, value } = textarea;
  const lineStart = value.lastIndexOf("\n", selectionStart - 1) + 1;
  const lineContent = value.slice(lineStart);
  if (lineContent.startsWith("  ")) {
    const newValue = `${value.slice(0, lineStart)}${lineContent.slice(2)}`;
    onChange(newValue);
    requestAnimationFrame(() => {
      textarea.focus();
      textarea.setSelectionRange(Math.max(lineStart, selectionStart - 2), Math.max(lineStart, selectionStart - 2));
    });
  } else if (lineContent.startsWith(" ")) {
    const newValue = `${value.slice(0, lineStart)}${lineContent.slice(1)}`;
    onChange(newValue);
    requestAnimationFrame(() => {
      textarea.focus();
      textarea.setSelectionRange(Math.max(lineStart, selectionStart - 1), Math.max(lineStart, selectionStart - 1));
    });
  }
}

// ─── Component ───────────────────────────────────────────────────────────────

export function MarkdownEditor({ value, onChange, placeholder, className, readOnly }: MarkdownEditorProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Picker state
  const langPickerRef = useRef<HTMLDivElement>(null);
  const calloutPickerRef = useRef<HTMLDivElement>(null);
  const [langPickerOpen, setLangPickerOpen] = useState(false);
  const [calloutPickerOpen, setCalloutPickerOpen] = useState(false);

  // Find & Replace state
  const [findReplaceOpen, setFindReplaceOpen] = useState(false);
  const [findText, setFindText] = useState("");
  const [replaceText, setReplaceText] = useState("");
  const [matchIdx, setMatchIdx] = useState(0);

  // Close pickers on outside click
  useEffect(() => {
    if (!langPickerOpen && !calloutPickerOpen) return;
    function handler(e: MouseEvent) {
      if (langPickerOpen && langPickerRef.current && !langPickerRef.current.contains(e.target as Node)) {
        setLangPickerOpen(false);
      }
      if (calloutPickerOpen && calloutPickerRef.current && !calloutPickerRef.current.contains(e.target as Node)) {
        setCalloutPickerOpen(false);
      }
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [langPickerOpen, calloutPickerOpen]);

  // Reset match index when find text changes
  useEffect(() => { setMatchIdx(0); }, [findText]);

  // ─── Computed matches for Find & Replace ───────────────────────────────────
  const matches = useMemo(() => {
    if (!findText) return [] as number[];
    const positions: number[] = [];
    let idx = 0;
    while ((idx = value.indexOf(findText, idx)) !== -1) {
      positions.push(idx);
      idx += findText.length;
    }
    return positions;
  }, [value, findText]);

  // ─── Callbacks ─────────────────────────────────────────────────────────────
  const wrap = useCallback((cfg: WrapConfig) => {
    if (textareaRef.current) insertWrap(textareaRef.current, cfg, onChange);
  }, [onChange]);

  const linePrefix = useCallback((cfg: LineConfig) => {
    if (textareaRef.current) insertLinePrefix(textareaRef.current, cfg, onChange);
  }, [onChange]);

  const block = useCallback((text: string) => {
    if (textareaRef.current) insertBlock(textareaRef.current, text, onChange);
  }, [onChange]);

  const codeBlock = useCallback((lang: string) => {
    if (textareaRef.current) insertCodeBlock(textareaRef.current, lang, onChange);
  }, [onChange]);

  const table = useCallback(() => {
    if (textareaRef.current) insertTable(textareaRef.current, onChange);
  }, [onChange]);

  const callout = useCallback((variant: string) => {
    if (textareaRef.current) insertCallout(textareaRef.current, variant, onChange);
  }, [onChange]);

  const indent = useCallback(() => {
    if (textareaRef.current) doIndentLine(textareaRef.current, onChange);
  }, [onChange]);

  const outdent = useCallback(() => {
    if (textareaRef.current) doOutdentLine(textareaRef.current, onChange);
  }, [onChange]);

  // ─── Find & Replace helpers ────────────────────────────────────────────────
  function selectMatch(idx: number) {
    if (!textareaRef.current || !matches.length || !findText) return;
    const safeIdx = ((idx % matches.length) + matches.length) % matches.length;
    setMatchIdx(safeIdx);
    requestAnimationFrame(() => {
      if (!textareaRef.current) return;
      textareaRef.current.focus();
      textareaRef.current.setSelectionRange(matches[safeIdx], matches[safeIdx] + findText.length);
    });
  }

  function nextMatch() { selectMatch(matchIdx + 1); }
  function prevMatch() { selectMatch(matchIdx - 1); }

  function replaceMatch() {
    if (!textareaRef.current || !matches.length || !findText) return;
    const safeIdx = ((matchIdx % matches.length) + matches.length) % matches.length;
    const pos = matches[safeIdx];
    const newValue = value.slice(0, pos) + replaceText + value.slice(pos + findText.length);
    onChange(newValue);
    requestAnimationFrame(() => nextMatch());
  }

  function replaceAll() {
    if (!findText) return;
    onChange(value.split(findText).join(replaceText));
  }

  // ─── Keyboard handler ──────────────────────────────────────────────────────
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const isMod = e.ctrlKey || e.metaKey;

    if (e.key === "Tab") {
      e.preventDefault();
      if (e.shiftKey) {
        outdent();
      } else {
        const ta = e.currentTarget;
        const { selectionStart, selectionEnd, value: v } = ta;
        const newValue = `${v.slice(0, selectionStart)}  ${v.slice(selectionEnd)}`;
        onChange(newValue);
        requestAnimationFrame(() => ta.setSelectionRange(selectionStart + 2, selectionStart + 2));
      }
      return;
    }

    if (!isMod) return;

    const key = e.key.toLowerCase();

    if (key === "b") { e.preventDefault(); wrap({ prefix: "**", suffix: "**", placeholder: "bold text" }); }
    else if (key === "i") { e.preventDefault(); wrap({ prefix: "_", suffix: "_", placeholder: "italic text" }); }
    else if (key === "k") {
      e.preventDefault();
      if (e.shiftKey) setLangPickerOpen(true);
      else wrap({ prefix: "[", suffix: "](url)", placeholder: "link text" });
    }
    else if (e.key === "`") { e.preventDefault(); wrap({ prefix: "`", suffix: "`", placeholder: "code" }); }
    else if (key === "h") { e.preventDefault(); setFindReplaceOpen(v => !v); }
  };

  // ─── Picker item style ──────────────────────────────────────────────────────
  const pickerItemCls = "w-full text-left px-3 py-1.5 text-xs hover:bg-accent transition-colors flex items-center gap-2";

  return (
    <div className={cn("flex flex-col h-full", className)}>

      {/* ── Toolbar ──────────────────────────────────────────────────────── */}
      <div className={cn(
        "flex items-center gap-0.5 px-2 py-1.5 border-b border-border bg-card flex-wrap shrink-0",
        readOnly && "pointer-events-none opacity-40",
      )}>

        {/* Inline formatting */}
        <ToolBtn title="Bold (Ctrl+B)" onClick={() => wrap({ prefix: "**", suffix: "**", placeholder: "bold text" })}>
          <strong className="text-xs">B</strong>
        </ToolBtn>
        <ToolBtn title="Italic (Ctrl+I)" onClick={() => wrap({ prefix: "_", suffix: "_", placeholder: "italic text" })}>
          <em className="text-xs">I</em>
        </ToolBtn>
        <ToolBtn title="Strikethrough" onClick={() => wrap({ prefix: "~~", suffix: "~~", placeholder: "strikethrough" })}>
          <s className="text-xs">S</s>
        </ToolBtn>
        <ToolBtn title="Inline code (Ctrl+`)" onClick={() => wrap({ prefix: "`", suffix: "`", placeholder: "code" })}>
          <span className="text-xs font-mono">`c`</span>
        </ToolBtn>
        <ToolBtn title="Highlight (<mark>text</mark>)" onClick={() => wrap({ prefix: "<mark>", suffix: "</mark>", placeholder: "highlight" })}>
          <span className="text-xs font-bold" style={{ background: "linear-gradient(transparent 40%, #fde047 40%)" }}>H</span>
        </ToolBtn>
        <ToolBtn title="Superscript (<sup>text</sup>)" onClick={() => wrap({ prefix: "<sup>", suffix: "</sup>", placeholder: "sup" })}>
          <span className="text-xs">x<sup className="text-[9px]">2</sup></span>
        </ToolBtn>
        <ToolBtn title="Subscript (<sub>text</sub>)" onClick={() => wrap({ prefix: "<sub>", suffix: "</sub>", placeholder: "sub" })}>
          <span className="text-xs">x<sub className="text-[9px]">2</sub></span>
        </ToolBtn>
        <ToolBtn title="Keyboard key (<kbd>key</kbd>)" onClick={() => wrap({ prefix: "<kbd>", suffix: "</kbd>", placeholder: "key" })}>
          <span className="text-[10px] border border-current rounded px-0.5">⌨</span>
        </ToolBtn>

        <Sep />

        {/* Headings */}
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

        {/* Lists + indent */}
        <ToolBtn title="Bullet list" onClick={() => linePrefix({ prefix: "- " })}>
          <span className="text-xs">• List</span>
        </ToolBtn>
        <ToolBtn title="Numbered list" onClick={() => linePrefix({ prefix: "1. " })}>
          <span className="text-xs">1. List</span>
        </ToolBtn>
        <ToolBtn title="Checklist item" onClick={() => linePrefix({ prefix: "- [ ] " })}>
          <span className="text-xs">☐ Task</span>
        </ToolBtn>
        <ToolBtn title="Indent" onClick={indent}>
          <span className="text-xs">→</span>
        </ToolBtn>
        <ToolBtn title="Outdent (Shift+Tab)" onClick={outdent}>
          <span className="text-xs">←</span>
        </ToolBtn>

        <Sep />

        {/* Block elements */}
        <ToolBtn title="Blockquote" onClick={() => linePrefix({ prefix: "> " })}>
          <span className="text-xs">❝</span>
        </ToolBtn>

        {/* Code block — language picker */}
        <div ref={langPickerRef} className="relative">
          <ToolBtn title="Code block (Ctrl+Shift+K)" onClick={() => setLangPickerOpen(v => !v)}>
            <span className="text-xs font-mono">{"</>"}</span>
          </ToolBtn>
          {langPickerOpen && (
            <div className="absolute top-full left-0 mt-0.5 z-50 bg-popover border border-border rounded-md shadow-lg min-w-[160px] max-h-64 overflow-y-auto py-0.5">
              {LANGUAGES.map(lang => (
                <button
                  key={lang.value}
                  type="button"
                  onMouseDown={(e) => { e.preventDefault(); codeBlock(lang.value); setLangPickerOpen(false); }}
                  className={pickerItemCls}
                >
                  {lang.label}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Callout — variant picker */}
        <div ref={calloutPickerRef} className="relative">
          <ToolBtn title="Callout block" onClick={() => setCalloutPickerOpen(v => !v)}>
            <span className="text-xs">💬</span>
          </ToolBtn>
          {calloutPickerOpen && (
            <div className="absolute top-full left-0 mt-0.5 z-50 bg-popover border border-border rounded-md shadow-lg min-w-[140px] py-0.5">
              {CALLOUTS.map(c => (
                <button
                  key={c.value}
                  type="button"
                  onMouseDown={(e) => { e.preventDefault(); callout(c.value); setCalloutPickerOpen(false); }}
                  className={pickerItemCls}
                >
                  <span>{c.icon}</span>
                  <span>{c.label}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        <ToolBtn title="Horizontal rule" onClick={() => block("---")}>
          <span className="text-xs">─</span>
        </ToolBtn>
        <ToolBtn title="Link (Ctrl+K)" onClick={() => wrap({ prefix: "[", suffix: "](url)", placeholder: "link text" })}>
          <span className="text-xs">🔗</span>
        </ToolBtn>
        <ToolBtn title="Image" onClick={() => wrap({ prefix: "![", suffix: "](image-url)", placeholder: "alt text" })}>
          <span className="text-xs">🖼</span>
        </ToolBtn>
        <ToolBtn title="Table" onClick={table}>
          <span className="text-xs font-mono">⊞</span>
        </ToolBtn>
        <ToolBtn title="Mermaid diagram" onClick={() => codeBlock("mermaid")}>
          <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="3" width="6" height="4" rx="1"/>
            <rect x="15" y="3" width="6" height="4" rx="1"/>
            <rect x="9" y="17" width="6" height="4" rx="1"/>
            <line x1="9" y1="5" x2="15" y2="5"/>
            <line x1="6" y1="7" x2="12" y2="17"/>
            <line x1="18" y1="7" x2="12" y2="17"/>
          </svg>
        </ToolBtn>

        <Sep />

        {/* Find & Replace toggle */}
        <ToolBtn title="Find & Replace (Ctrl+H)" onClick={() => setFindReplaceOpen(v => !v)}>
          <span className={cn("text-xs", findReplaceOpen && "text-primary")}>🔍</span>
        </ToolBtn>
      </div>

      {/* ── Find & Replace bar ────────────────────────────────────────────── */}
      {findReplaceOpen && (
        <div className="flex items-center gap-1.5 px-3 py-2 border-b border-border bg-muted/30 flex-wrap shrink-0">
          <input
            type="text"
            placeholder="Find"
            value={findText}
            onChange={(e) => setFindText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.preventDefault(); nextMatch(); }
              if (e.key === "Escape") setFindReplaceOpen(false);
            }}
            className="h-6 px-2 text-xs border border-border rounded bg-background w-32 focus:outline-none focus:ring-1 focus:ring-primary"
          />
          <input
            type="text"
            placeholder="Replace"
            value={replaceText}
            onChange={(e) => setReplaceText(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Escape") setFindReplaceOpen(false); }}
            className="h-6 px-2 text-xs border border-border rounded bg-background w-32 focus:outline-none focus:ring-1 focus:ring-primary"
          />
          <span className="text-xs text-muted-foreground shrink-0 tabular-nums">
            {matches.length > 0
              ? `${Math.min(matchIdx + 1, matches.length)} / ${matches.length}`
              : findText ? "0 / 0" : ""}
          </span>
          <FRBtn onClick={prevMatch} title="Previous match" disabled={!matches.length}>◀</FRBtn>
          <FRBtn onClick={nextMatch} title="Next match (Enter)" disabled={!matches.length}>▶</FRBtn>
          <FRBtn onClick={replaceMatch} title="Replace current" disabled={!matches.length}>Replace</FRBtn>
          <FRBtn onClick={replaceAll} title="Replace all occurrences" disabled={!matches.length || !findText}>Replace All</FRBtn>
          <button
            type="button"
            onClick={() => setFindReplaceOpen(false)}
            title="Close (Esc)"
            className="ml-auto p-0.5 text-muted-foreground hover:text-foreground transition-colors"
          >
            <span className="text-xs">✕</span>
          </button>
        </div>
      )}

      {/* ── Textarea ──────────────────────────────────────────────────────── */}
      <textarea
        ref={textareaRef}
        value={value}
        onChange={(e) => !readOnly && onChange(e.target.value)}
        onKeyDown={readOnly ? undefined : handleKeyDown}
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

// ─── Sub-components ───────────────────────────────────────────────────────────

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

function FRBtn({
  onClick,
  title,
  disabled,
  children,
}: {
  onClick: () => void;
  title?: string;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      disabled={disabled}
      className="h-6 px-2 text-xs rounded border border-border bg-background hover:bg-accent transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
    >
      {children}
    </button>
  );
}
