/**
 * MarkdownEditor — thin wrapper around @uiw/react-md-editor with built-in
 * mention autocomplete.
 *
 * When `members` is supplied the editor detects `@` in the textarea, shows a
 * floating picker, and inserts a canonical @[userId:Name] / @[everyone] token
 * on click, Enter, or Tab.  Pressing Tab auto-completes the currently
 * highlighted entry; ↑/↓ arrows navigate; Escape closes the picker.
 *
 * The picker is rendered via a React portal at document.body so that
 * `overflow-hidden` on the editor wrapper (applied by callers for sizing)
 * does not clip it.
 */

import MDEditor from "@uiw/react-md-editor";
import "@uiw/react-md-editor/markdown-editor.css";
import { useEffect, useLayoutEffect, useState, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";
import { remarkPlugins, rehypePlugins, previewComponents } from "./markdown-config";
import type { OrgMemberInfo } from "@workspace/api-client-react";

// ── Token helpers ─────────────────────────────────────────────────────────────

function buildMemberToken(member: OrgMemberInfo): string {
  const name =
    [member.firstName, member.lastName].filter(Boolean).join(" ") ||
    member.email ||
    member.userId;
  return `@[${member.userId}:${name}]`;
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface PickerItem {
  token: string;
  label: string;
  sub?: string;
}

interface PickerRect {
  top: number;
  left: number;
  width: number;
}

interface MarkdownEditorProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  readOnly?: boolean;
  /**
   * Which pane the editor opens in by default.
   * - "edit"    — textarea only (default, good for compact usage)
   * - "live"    — side-by-side editor + preview
   * - "preview" — rendered output only (used when readOnly=true)
   */
  previewMode?: "edit" | "live" | "preview";
  /** Org members to offer in the @mention picker. Omit to disable mentions. */
  members?: OrgMemberInfo[];
}

// ── Dark-mode helper ──────────────────────────────────────────────────────────

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

// ── Component ─────────────────────────────────────────────────────────────────

export function MarkdownEditor({
  value,
  onChange,
  placeholder,
  className,
  readOnly = false,
  previewMode = "edit",
  members = [],
}: MarkdownEditorProps) {
  const colorMode = useColorMode();
  const wrapperRef = useRef<HTMLDivElement>(null);

  // ── Mention state ──────────────────────────────────────────────────────────
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionStart, setMentionStart] = useState<number>(-1);
  const [selectedIdx, setSelectedIdx] = useState<number>(0);
  // Position of the picker popup (fixed, relative to viewport)
  const [pickerRect, setPickerRect] = useState<PickerRect | null>(null);

  /** Open/update/close the mention picker based on cursor position. */
  const detectMention = useCallback((text: string, cursorPos: number) => {
    const before = text.slice(0, cursorPos);
    const atIdx = before.lastIndexOf("@");
    if (atIdx === -1) {
      setMentionQuery(null);
      setMentionStart(-1);
      return;
    }
    const query = before.slice(atIdx + 1);
    // A space or newline closes the picker
    if (query.includes(" ") || query.includes("\n")) {
      setMentionQuery(null);
      setMentionStart(-1);
      return;
    }
    setMentionQuery(query);
    setMentionStart(atIdx);
    setSelectedIdx(0);
  }, []);

  /** Replace the `@<query>` segment with the chosen token. */
  const insertMention = useCallback(
    (token: string) => {
      if (mentionStart === -1) return;
      const ta = wrapperRef.current?.querySelector<HTMLTextAreaElement>("textarea");
      const cursorPos = ta?.selectionStart ?? value.length;
      const before = value.slice(0, mentionStart);
      const after = value.slice(cursorPos);
      const newVal = before + token + " " + after;
      onChange(newVal);
      setMentionQuery(null);
      setMentionStart(-1);
      setTimeout(() => {
        const ta2 = wrapperRef.current?.querySelector<HTMLTextAreaElement>("textarea");
        if (ta2) {
          const pos = before.length + token.length + 1;
          ta2.focus();
          ta2.setSelectionRange(pos, pos);
        }
      }, 0);
    },
    [mentionStart, value, onChange],
  );

  // ── Build filtered picker items ────────────────────────────────────────────
  const hasMentions = members.length > 0;
  const q = mentionQuery ?? "";
  const ql = q.toLowerCase();

  const showEveryone =
    mentionQuery !== null && (q === "" || "everyone".startsWith(ql));

  const filteredMembers =
    mentionQuery !== null
      ? members.filter((m) => {
          const name =
            [m.firstName, m.lastName].filter(Boolean).join(" ") || m.email || "";
          return (
            name.toLowerCase().includes(ql) ||
            (m.email ?? "").toLowerCase().includes(ql)
          );
        })
      : [];

  const pickerItems: PickerItem[] = [
    ...(showEveryone
      ? [{ token: "@[everyone]", label: "@everyone", sub: "Notify all members" }]
      : []),
    ...filteredMembers.map((m) => {
      const name =
        [m.firstName, m.lastName].filter(Boolean).join(" ") ||
        m.email ||
        m.userId;
      return { token: buildMemberToken(m), label: name, sub: m.email ?? undefined };
    }),
  ];

  const showPicker = hasMentions && mentionQuery !== null && pickerItems.length > 0;

  // ── Compute picker position whenever it becomes visible ───────────────────
  useLayoutEffect(() => {
    if (!showPicker) {
      setPickerRect(null);
      return;
    }
    const wrapper = wrapperRef.current;
    if (!wrapper) return;
    const rect = wrapper.getBoundingClientRect();
    setPickerRect({
      // Position the picker just above the editor wrapper
      top: rect.top,
      left: rect.left,
      width: rect.width,
    });
  }, [showPicker]);

  // ── textareaProps handlers ─────────────────────────────────────────────────
  // These are spread directly onto the <textarea> inside MDEditor.

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (!showPicker) return;
      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          setSelectedIdx((i) => (i + 1) % pickerItems.length);
          break;
        case "ArrowUp":
          e.preventDefault();
          setSelectedIdx((i) => (i - 1 + pickerItems.length) % pickerItems.length);
          break;
        case "Tab":
        case "Enter":
          e.preventDefault();
          insertMention(pickerItems[selectedIdx]?.token ?? "");
          break;
        case "Escape":
          e.preventDefault();
          setMentionQuery(null);
          setMentionStart(-1);
          break;
      }
    },
    [showPicker, pickerItems, selectedIdx, insertMention],
  );

  const handleKeyUp = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      // Skip keys already handled by keyDown
      if (["ArrowUp", "ArrowDown", "Tab", "Enter", "Escape"].includes(e.key)) return;
      const ta = e.currentTarget;
      detectMention(ta.value, ta.selectionStart ?? ta.value.length);
    },
    [detectMention],
  );

  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLTextAreaElement>) => {
      const ta = e.currentTarget;
      detectMention(ta.value, ta.selectionStart ?? ta.value.length);
    },
    [detectMention],
  );

  // ── Render ─────────────────────────────────────────────────────────────────

  const resolvedPreview: "edit" | "live" | "preview" = readOnly
    ? "preview"
    : previewMode;

  return (
    <div
      ref={wrapperRef}
      data-color-mode={colorMode}
      className={cn("relative", className)}
    >
      <MDEditor
        value={value}
        onChange={(v) => onChange(v ?? "")}
        preview={resolvedPreview}
        height="100%"
        visibleDragbar={false}
        previewOptions={{
          remarkPlugins,
          rehypePlugins,
          components: previewComponents,
        }}
        textareaProps={{
          placeholder,
          onKeyDown: handleKeyDown,
          onKeyUp: handleKeyUp,
          onClick: handleClick,
        }}
      />

      {/* ── Mention picker (portal, so overflow-hidden on wrapper can't clip it) ── */}
      {showPicker &&
        pickerRect &&
        createPortal(
          <div
            style={{
              position: "fixed",
              top: pickerRect.top,
              left: pickerRect.left,
              width: pickerRect.width,
              transform: "translateY(-100%) translateY(-4px)",
              zIndex: 9999,
            }}
            className="max-h-52 overflow-auto rounded-md border border-border bg-popover shadow-lg"
          >
            {pickerItems.map((item, idx) => (
              <button
                key={item.token}
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  insertMention(item.token);
                }}
                className={cn(
                  "w-full flex items-center gap-2 px-3 py-2 text-left text-sm transition-colors",
                  idx === selectedIdx
                    ? "bg-accent text-accent-foreground"
                    : "hover:bg-accent hover:text-accent-foreground",
                )}
              >
                <span
                  className={cn(
                    "font-medium",
                    item.label.startsWith("@") && "text-primary",
                  )}
                >
                  {item.label}
                </span>
                {item.sub && (
                  <span className="text-xs text-muted-foreground truncate">
                    {item.sub}
                  </span>
                )}
              </button>
            ))}
          </div>,
          document.body,
        )}
    </div>
  );
}
