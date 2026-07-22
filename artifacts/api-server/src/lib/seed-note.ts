/**
 * Seed a showcase scratchpad note for every new organization.
 *
 * The note is created under the org owner's user ID with `public_read`
 * visibility ("Shared (read)") so all members can see it immediately.
 * Its content demonstrates every markdown feature the editor supports.
 */

import { db, notesTable } from "@workspace/db";

const SHOWCASE_TITLE = "📝 Markdown Feature Showcase";

const SHOWCASE_CONTENT = `# Markdown Feature Showcase

Welcome to your team scratchpad! This note demonstrates every formatting feature available in the editor.

---

## Text Formatting

Regular text, **bold**, *italic*, ~~strikethrough~~, and ==highlighted== text can all appear inline.

Combine them: ***bold and italic***, **==bold highlight==**, and *==italic highlight==*.

---

## Superscript & Subscript

Chemical formulas use subscript: H~2~O, CO~2~, C~6~H~12~O~6~

Math uses superscript: E = mc^2^, a^2^ + b^2^ = c^2^

---

## Callouts

> [!NOTE]
> Use **Note** callouts for helpful context that readers shouldn't skip.

> [!TIP]
> Use **Tip** callouts for pro tips and best practices.

> [!WARNING]
> Use **Warning** callouts when something could go wrong.

> [!CAUTION]
> Use **Caution** callouts for destructive or irreversible actions.

---

## Code

Inline code: \`const greeting = "Hello, world!";\`

Keyboard shortcuts: Press <kbd>Ctrl</kbd>+<kbd>S</kbd> to save, <kbd>Cmd</kbd>+<kbd>K</kbd> to open search.

\`\`\`typescript
// A typed function — syntax highlighting coming soon
function greet(name: string): string {
  return \`Hello, \${name}!\`;
}

console.log(greet("Team"));
\`\`\`

\`\`\`bash
# Shell example
pnpm install
pnpm run dev
\`\`\`

---

## Mermaid Diagrams

\`\`\`mermaid
flowchart LR
  A[User] --> B[Task Created]
  B --> C{Assigned}
  C -- Yes --> D[Assignee Notified]
  C -- No --> E[Sits in Backlog]
  D --> F[Work Begins]
\`\`\`

---

## Tables

| Feature | Syntax | Renders as |
|---|---|---|
| Highlight | \`==text==\` | ==highlighted== |
| Superscript | \`^text^\` | x^2^ |
| Subscript | \`~text~\` | H~2~O |
| Bold | \`**text**\` | **bold** |
| Italic | \`*text*\` | *italic* |
| Strikethrough | \`~~text~~\` | ~~struck~~ |
| Inline code | <code>&#96;code&#96;</code> | \`code\` |

---

## Lists

### Unordered
- First item
- Second item
  - Nested item
  - Another nested item
- Third item

### Ordered
1. Step one — set up your workspace
2. Step two — invite your team
3. Step three — create your first project

### Task list
- [x] Install the app
- [x] Create an org
- [ ] Invite teammates
- [ ] Create your first task

---

## Blockquotes

> "The best tool is the one your team actually uses."
>
> — Someone wise

---

## Links

[Visit the documentation](https://example.com) or reference a task directly in a comment.

---

## Horizontal Rule

Use three dashes on their own line:

---

Feel free to edit or delete this note — it's just here to help you get started!
`;

/**
 * Insert the showcase scratchpad note for a freshly created org.
 * The note is owned by the org creator (passed as `ownerId`) and visible to
 * all org members in read-only mode.
 */
export async function seedDefaultNote(
  orgId: string,
  ownerId: string,
): Promise<void> {
  await db.insert(notesTable).values({
    orgId,
    createdBy: ownerId,
    title: SHOWCASE_TITLE,
    content: SHOWCASE_CONTENT,
    visibility: "public_read",
  });
}
