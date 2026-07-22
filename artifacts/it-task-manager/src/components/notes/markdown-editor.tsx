/**
 * MarkdownEditor — thin wrapper around @uiw/react-md-editor with built-in
 * mention autocomplete and / reference picker.
 *
 * Typing `@` opens the @mention picker (requires `members` prop).
 * Typing `/` opens the reference picker which searches tasks and projects.
 *
 * Both pickers are rendered via React portals at document.body so that
 * `overflow-hidden` wrappers cannot clip them. They are positioned at the
 * exact cursor location using the mirror-div technique (picker-utils.ts) and
 * flip above or below the caret depending on available viewport space.
 *
 * Inserting a reference inserts a `#[task:ID:Title]` or `#[project:ID:Name]`
 * canonical token; the remarkProcessTokens plugin (markdown-config.tsx)
 * converts those tokens to styled chips in all preview surfaces uniformly.
 */

import MDEditor from "@uiw/react-md-editor";
import "@uiw/react-md-editor/markdown-editor.css";
import { useEffect, useLayoutEffect, useState, useRef, useCallback } from "react";
import { cn } from "@/lib/utils";
import { remarkPlugins, rehypePlugins, previewComponents } from "./markdown-config";
import { MarkdownPreview } from "./markdown-preview";
import type { OrgMemberInfo } from "@workspace/api-client-react";
import { MentionPicker, type MentionItem } from "./mention-picker";
import { ReferencePicker, buildReferenceItems, type RefType } from "./reference-picker";
import { computePickerRect, detectReferenceContext, PICKER_MAX_WIDTH, type PickerRect } from "./picker-utils";
import { useGetReferences } from "@workspace/api-client-react";

// ── Token helpers ─────────────────────────────────────────────────────────────

function buildMemberToken(member: OrgMemberInfo): string {
  const name = [member.firstName, member.lastName].filter(Boolean).join(" ");
  if (name) {
    // Named member: append email as a third field so the renderer produces a
    // mailto: link while showing the display name.
    const emailSuffix = member.email ? `:${member.email}` : "";
    return `@[${member.userId}:${name}${emailSuffix}]`;
  }
  // No real name — use email as the display value; the renderer will derive
  // the label from the email's local-part (e.g. "testing@corp.com" → "@testing").
  const displayName = member.email || member.userId;
  return `@[${member.userId}:${displayName}]`;
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface MarkdownEditorProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  readOnly?: boolean;
  /**
   * Which pane the editor opens in by default.
   * - "edit"    — textarea only (default)
   * - "live"    — side-by-side editor + preview
   * - "preview" — rendered output only (readOnly=true)
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
  const [mentionIdx, setMentionIdx] = useState<number>(0);
  const [mentionRect, setMentionRect] = useState<PickerRect | null>(null);

  // ── Reference picker state ─────────────────────────────────────────────────
  const [refQuery, setRefQuery] = useState<string | null>(null);
  const [refStart, setRefStart] = useState<number>(-1);
  const [refFilterType, setRefFilterType] = useState<RefType>("all");
  const [refSelectedIdx, setRefSelectedIdx] = useState<number>(0);
  const [refPickerRect, setRefPickerRect] = useState<PickerRect | null>(null);

  // ── Reference data (fetched while picker is open) ─────────────────────────
  const { data: refData } = useGetReferences(
    { q: refQuery || undefined, type: refFilterType, limit: 20 },
    {
      query: {
        enabled: refQuery !== null,
        staleTime: 5_000,
        queryKey: ["getReferences", refFilterType, refQuery],
      },
    },
  );

  const refItems = buildReferenceItems(
    refData?.tasks ?? [],
    refData?.projects ?? [],
  );
  const showRefPicker = refQuery !== null;

  // ── Textarea accessor ──────────────────────────────────────────────────────
  const getTextarea = useCallback(
    () =>
      wrapperRef.current?.querySelector<HTMLTextAreaElement>("textarea") ?? null,
    [],
  );

  // ── Build filtered mention items ──────────────────────────────────────────
  const hasMentions = members.length > 0;
  const q = mentionQuery ?? "";
  const ql = q.toLowerCase();

  const showEveryone =
    mentionQuery !== null && (q === "" || "everyone".startsWith(ql));

  const filteredMembers =
    mentionQuery !== null
      ? members.filter((m) => {
          const name =
            [m.firstName, m.lastName].filter(Boolean).join(" ") ||
            m.email ||
            "";
          return (
            name.toLowerCase().includes(ql) ||
            (m.email ?? "").toLowerCase().includes(ql)
          );
        })
      : [];

  const mentionItems: MentionItem[] = [
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

  const showPicker =
    hasMentions && mentionQuery !== null && mentionItems.length > 0;

  // ── Picker position updates ───────────────────────────────────────────────
  // Recompute whenever picker visibility or query changes so the popup tracks
  // the cursor as the user types the search query.

  useLayoutEffect(() => {
    if (!showPicker) { setMentionRect(null); return; }
    const ta = getTextarea();
    if (!ta) return;
    setMentionRect(computePickerRect(ta, ta.selectionStart ?? ta.value.length, 320));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showPicker, mentionQuery]);

  useLayoutEffect(() => {
    if (!showRefPicker) { setRefPickerRect(null); return; }
    const ta = getTextarea();
    if (!ta) return;
    setRefPickerRect(
      computePickerRect(ta, ta.selectionStart ?? ta.value.length, PICKER_MAX_WIDTH),
    );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showRefPicker, refQuery]);

  // ── Trigger detection ─────────────────────────────────────────────────────

  const detectMention = useCallback((text: string, cursorPos: number) => {
    const before = text.slice(0, cursorPos);
    const atIdx = before.lastIndexOf("@");
    if (atIdx === -1) { setMentionQuery(null); setMentionStart(-1); return; }
    const query = before.slice(atIdx + 1);
    if (query.includes(" ") || query.includes("\n")) {
      setMentionQuery(null); setMentionStart(-1); return;
    }
    setMentionQuery(query);
    setMentionStart(atIdx);
    setMentionIdx(0);
  }, []);

  /**
   * Open/update/close the reference picker using the shared
   * `detectReferenceContext` utility which guards against URL/path false
   * positives (only activates when `/` follows whitespace or start-of-text).
   */
  const detectReference = useCallback((text: string, cursorPos: number) => {
    const ctx = detectReferenceContext(text, cursorPos);
    if (!ctx.active) { setRefQuery(null); setRefStart(-1); return; }
    setRefQuery(ctx.query);
    setRefStart(ctx.slashIdx);
    setRefSelectedIdx(0);
  }, []);

  // ── Token insertion ───────────────────────────────────────────────────────

  const insertMention = useCallback(
    (token: string) => {
      if (mentionStart === -1) return;
      const ta = getTextarea();
      const cursorPos = ta?.selectionStart ?? value.length;
      const before = value.slice(0, mentionStart);
      const after = value.slice(cursorPos);
      onChange(before + token + " " + after);
      setMentionQuery(null);
      setMentionStart(-1);
      setTimeout(() => {
        const ta2 = getTextarea();
        if (ta2) {
          const pos = before.length + token.length + 1;
          ta2.focus();
          ta2.setSelectionRange(pos, pos);
        }
      }, 0);
    },
    [mentionStart, value, onChange, getTextarea],
  );

  /**
   * Replace the `/query` typed by the user with the selected token.
   * The stored token begins with `#` regardless of the `/` trigger.
   */
  const insertReference = useCallback(
    (token: string) => {
      if (refStart === -1) return;
      const ta = getTextarea();
      const cursorPos = ta?.selectionStart ?? value.length;
      const before = value.slice(0, refStart);
      const after = value.slice(cursorPos);
      onChange(before + token + " " + after);
      setRefQuery(null);
      setRefStart(-1);
      setTimeout(() => {
        const ta2 = getTextarea();
        if (ta2) {
          const pos = before.length + token.length + 1;
          ta2.focus();
          ta2.setSelectionRange(pos, pos);
        }
      }, 0);
    },
    [refStart, value, onChange, getTextarea],
  );

  // ── Keyboard handlers ─────────────────────────────────────────────────────

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      // ── Reference picker navigation ──
      if (showRefPicker && refItems.length > 0) {
        switch (e.key) {
          case "ArrowDown":
            e.preventDefault();
            setRefSelectedIdx((i) => (i + 1) % refItems.length);
            return;
          case "ArrowUp":
            e.preventDefault();
            setRefSelectedIdx((i) => (i - 1 + refItems.length) % refItems.length);
            return;
          case "Tab":
          case "Enter":
            e.preventDefault();
            insertReference(refItems[refSelectedIdx]?.token ?? "");
            return;
          case "Escape":
            e.preventDefault();
            setRefQuery(null);
            setRefStart(-1);
            return;
        }
      } else if (showRefPicker) {
        if (e.key === "Escape") {
          e.preventDefault();
          setRefQuery(null);
          setRefStart(-1);
          return;
        }
      }

      // ── Mention picker navigation ──
      if (!showPicker) return;
      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          setMentionIdx((i) => (i + 1) % mentionItems.length);
          break;
        case "ArrowUp":
          e.preventDefault();
          setMentionIdx((i) => (i - 1 + mentionItems.length) % mentionItems.length);
          break;
        case "Tab":
        case "Enter":
          e.preventDefault();
          insertMention(mentionItems[mentionIdx]?.token ?? "");
          break;
        case "Escape":
          e.preventDefault();
          setMentionQuery(null);
          setMentionStart(-1);
          break;
      }
    },
    [
      showPicker, showRefPicker,
      mentionItems, refItems,
      mentionIdx, refSelectedIdx,
      insertMention, insertReference,
    ],
  );

  const handleKeyUp = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (["ArrowUp", "ArrowDown", "Tab", "Enter", "Escape"].includes(e.key)) return;
      const ta = e.currentTarget;
      const text = ta.value;
      const cursor = ta.selectionStart ?? text.length;
      const before = text.slice(0, cursor);

      // Whichever trigger appears closest (rightmost) to the cursor wins.
      const lastAt = before.lastIndexOf("@");
      const lastSlash = before.lastIndexOf("/");

      if (lastSlash > lastAt) {
        detectReference(text, cursor);
        setMentionQuery(null);
        setMentionStart(-1);
      } else {
        detectMention(text, cursor);
        setRefQuery(null);
        setRefStart(-1);
      }
    },
    [detectMention, detectReference],
  );

  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLTextAreaElement>) => {
      const ta = e.currentTarget;
      detectMention(ta.value, ta.selectionStart ?? ta.value.length);
      detectReference(ta.value, ta.selectionStart ?? ta.value.length);
    },
    [detectMention, detectReference],
  );

  // ── Render ────────────────────────────────────────────────────────────────

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
        components={{
          // MDEditor always overrides `source` in previewOptions after
          // spreading — our preprocessContent() call never reaches the
          // internal preview.  The `components.preview` escape hatch gives us
          // full control: MDEditor calls preview(rawSource) and renders whatever
          // React element we return, so we can run preprocessContent() ourselves
          // before handing the string to our own MarkdownPreview.
          preview: (source) => (
            <MarkdownPreview content={source} className="overflow-visible p-3" />
          ),
        }}
        textareaProps={{
          placeholder,
          onKeyDown: handleKeyDown,
          onKeyUp: handleKeyUp,
          onClick: handleClick,
        }}
      />

      {/* @mention picker — portal so overflow-hidden cannot clip it */}
      {showPicker && mentionRect && (
        <MentionPicker
          items={mentionItems}
          selectedIdx={mentionIdx}
          pickerRect={mentionRect}
          onSelect={insertMention}
        />
      )}

      {/* / reference picker — portal */}
      {showRefPicker && refPickerRect && (
        <ReferencePicker
          query={refQuery ?? ""}
          filterType={refFilterType}
          selectedIdx={refSelectedIdx}
          pickerRect={refPickerRect}
          onSelect={insertReference}
          onClose={() => { setRefQuery(null); setRefStart(-1); }}
          onFilterChange={setRefFilterType}
          onSelectedIdxChange={setRefSelectedIdx}
        />
      )}
    </div>
  );
}
