/**
 * MentionTextarea — a Textarea wrapper that shows a floating member
 * autocomplete list when the user types `@`.
 *
 * Token format (stored in comment content):
 *   Individual: @[userId:Display Name]
 *   Broadcast:  @[everyone]
 *
 * Both are parsed and rendered as styled chips by renderCommentContent().
 */

import { useState, useRef, useCallback } from "react";
import { Textarea } from "@/components/ui/textarea";
import type { OrgMemberInfo } from "@workspace/api-client-react";

interface MentionTextareaProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  members: OrgMemberInfo[];
  autoFocus?: boolean;
}

/** Build the token that gets stored in comment content. */
export function buildMemberToken(member: OrgMemberInfo): string {
  const name =
    [member.firstName, member.lastName].filter(Boolean).join(" ") ||
    member.email ||
    member.userId;
  return `@[${member.userId}:${name}]`;
}

export function MentionTextarea({
  value,
  onChange,
  placeholder,
  className,
  members,
  autoFocus,
}: MentionTextareaProps) {
  // mentionQuery: string after `@` that we're filtering by (null = not active)
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  // where the `@` character sits in the current value
  const [mentionStart, setMentionStart] = useState<number>(-1);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  /** Inspect the text and cursor position; open/update/close the mention picker. */
  const detectMention = useCallback((text: string, cursorPos: number) => {
    const before = text.slice(0, cursorPos);
    const atIdx = before.lastIndexOf("@");
    if (atIdx === -1) {
      setMentionQuery(null);
      setMentionStart(-1);
      return;
    }
    const query = before.slice(atIdx + 1);
    // A space closes the mention (user finished typing a word)
    if (query.includes(" ")) {
      setMentionQuery(null);
      setMentionStart(-1);
      return;
    }
    setMentionQuery(query);
    setMentionStart(atIdx);
  }, []);

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newVal = e.target.value;
    const cursor = e.target.selectionStart ?? newVal.length;
    onChange(newVal);
    detectMention(newVal, cursor);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (mentionQuery !== null && e.key === "Escape") {
      setMentionQuery(null);
      setMentionStart(-1);
    }
  };

  /** Replace the `@<query>` segment with the chosen token. */
  const insertMention = (token: string) => {
    if (mentionStart === -1) return;
    const cursorPos = textareaRef.current?.selectionStart ?? value.length;
    const before = value.slice(0, mentionStart);
    const after = value.slice(cursorPos);
    const newVal = before + token + " " + after;
    onChange(newVal);
    setMentionQuery(null);
    setMentionStart(-1);
    // Restore focus and place caret after the inserted token
    setTimeout(() => {
      if (textareaRef.current) {
        const pos = before.length + token.length + 1;
        textareaRef.current.focus();
        textareaRef.current.setSelectionRange(pos, pos);
      }
    }, 0);
  };

  const q = mentionQuery ?? "";
  const ql = q.toLowerCase();

  // @everyone appears when query is empty or when "everyone" starts with the typed chars
  const showEveryone = q === "" || "everyone".startsWith(ql);

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

  const showPopover =
    mentionQuery !== null && (showEveryone || filteredMembers.length > 0);

  return (
    <div className="relative">
      <Textarea
        ref={textareaRef}
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        className={className}
        autoFocus={autoFocus}
      />

      {showPopover && (
        <div className="absolute z-50 bottom-full left-0 mb-1 w-full max-h-52 overflow-auto rounded-md border border-border bg-popover shadow-lg">
          {showEveryone && (
            /* onMouseDown + preventDefault keeps textarea focus intact */
            <button
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                insertMention("@[everyone]");
              }}
              className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-accent hover:text-accent-foreground text-sm transition-colors"
            >
              <span className="font-semibold text-primary">
                @everyone
              </span>
              <span className="text-xs text-muted-foreground">
                Notify all members
              </span>
            </button>
          )}

          {filteredMembers.map((m) => {
            const name =
              [m.firstName, m.lastName].filter(Boolean).join(" ") ||
              m.email ||
              m.userId;
            return (
              <button
                key={m.userId}
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  insertMention(buildMemberToken(m));
                }}
                className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-accent hover:text-accent-foreground text-sm transition-colors"
              >
                <span className="font-medium">{name}</span>
                {m.email && (
                  <span className="text-xs text-muted-foreground truncate">
                    {m.email}
                  </span>
                )}
              </button>
            );
          })}

          {filteredMembers.length === 0 && !showEveryone && (
            <p className="px-3 py-2 text-xs text-muted-foreground">
              No members found
            </p>
          )}
        </div>
      )}
    </div>
  );
}
