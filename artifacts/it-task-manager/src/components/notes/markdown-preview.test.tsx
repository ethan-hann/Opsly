import { describe, it, expect } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MarkdownPreview } from "./markdown-preview";

// ---------------------------------------------------------------------------
// Markdown-syntax rendering (the three toolbar formats that bypass HTML input)
// ---------------------------------------------------------------------------
describe("MarkdownPreview — markdown-syntax highlight / super / subscript", () => {
  it("renders ==text== as a <mark> element", async () => {
    render(<MarkdownPreview content="This is ==highlighted== text." />);
    expect(await screen.findByText(/highlighted/)).toBeTruthy();
    const el = document.querySelector("mark");
    expect(el).not.toBeNull();
    expect(el?.textContent).toBe("highlighted");
  });

  it("renders multiple ==...== spans in one paragraph", async () => {
    render(<MarkdownPreview content="==one== and ==two==" />);
    const marks = document.querySelectorAll("mark");
    expect(marks).toHaveLength(2);
    expect(marks[0].textContent).toBe("one");
    expect(marks[1].textContent).toBe("two");
  });

  it("renders ^text^ as a <sup> element", async () => {
    render(<MarkdownPreview content="x^2^ is a square." />);
    expect(await screen.findByText(/square/)).toBeTruthy();
    const el = document.querySelector("sup");
    expect(el).not.toBeNull();
    expect(el?.textContent).toBe("2");
  });

  it("renders ~text~ as a <sub> element", async () => {
    render(<MarkdownPreview content="H~2~O is water." />);
    expect(await screen.findByText(/water/)).toBeTruthy();
    const el = document.querySelector("sub");
    expect(el).not.toBeNull();
    expect(el?.textContent).toBe("2");
  });

  it("does not confuse ~~strikethrough~~ with ~subscript~", async () => {
    render(<MarkdownPreview content="~~struck~~ and H~2~O" />);
    // GFM strikethrough → <del>
    const del = document.querySelector("del");
    expect(del).not.toBeNull();
    expect(del?.textContent).toBe("struck");
    // subscript → <sub>
    const sub = document.querySelector("sub");
    expect(sub).not.toBeNull();
    expect(sub?.textContent).toBe("2");
  });
});

describe("MarkdownPreview — toolbar format rendering", () => {
  it("renders <mark> highlight tags inserted by the toolbar", async () => {
    render(<MarkdownPreview content="This is <mark>highlighted</mark> text." />);
    // The sanitizer allows <mark>; the text inside should be visible.
    expect(await screen.findByText(/highlighted/)).toBeTruthy();
    const el = document.querySelector("mark");
    expect(el).not.toBeNull();
    expect(el?.textContent).toBe("highlighted");
  });

  it("renders <sup> superscript tags inserted by the toolbar", async () => {
    render(<MarkdownPreview content="x<sup>2</sup>" />);
    expect(await screen.findByText(/2/)).toBeTruthy();
    const el = document.querySelector("sup");
    expect(el).not.toBeNull();
    expect(el?.textContent).toBe("2");
  });

  it("renders <sub> subscript tags inserted by the toolbar", async () => {
    render(<MarkdownPreview content="H<sub>2</sub>O" />);
    expect(await screen.findByText(/H/)).toBeTruthy();
    const el = document.querySelector("sub");
    expect(el).not.toBeNull();
    expect(el?.textContent).toBe("2");
  });

  it("renders <kbd> keyboard-key tags inserted by the toolbar", async () => {
    render(<MarkdownPreview content="Press <kbd>Ctrl</kbd> to continue." />);
    expect(await screen.findByText(/Ctrl/)).toBeTruthy();
    const el = document.querySelector("kbd");
    expect(el).not.toBeNull();
    expect(el?.textContent).toBe("Ctrl");
  });

  it("strips dangerous script tags from user content", async () => {
    render(
      <MarkdownPreview content='Hello <script>window.__xss=1</script> world.' />,
    );
    expect(await screen.findByText(/Hello/)).toBeTruthy();
    // Script element must not be present in the DOM.
    expect(document.querySelector("script")).toBeNull();
    // Verify the injected side-effect did not run.
    expect((window as unknown as Record<string, unknown>).__xss).toBeUndefined();
  });

  it("does not process ==...== inside a raw HTML <code> element", async () => {
    // remark-gfm parses <code>==text==</code> as three sibling MDAST nodes:
    //   html("<code>")  text("==text==")  html("</code>")
    // The remarkHighlight plugin must NOT process the text node when htmlDepth > 0.
    // A two-column header is required so remark-gfm recognises the table.
    const { container } = render(
      <MarkdownPreview
        content={"| Feature | Syntax |\n|---|---|\n| Highlight | <code>==text==</code> |"}
      />,
    );
    // <code> element must contain literal "==text==" — no <mark> wrapping.
    await waitFor(() => {
      const code = container.querySelector("td code");
      expect(code).not.toBeNull();
      expect(code?.textContent).toBe("==text==");
      expect(container.querySelector("td mark")).toBeNull();
    });
  });

  it("still processes ==...== outside HTML elements after fixing the depth tracker", async () => {
    const { container } = render(<MarkdownPreview content="before ==marked== after" />);
    await waitFor(() => {
      const mark = container.querySelector("mark");
      expect(mark).not.toBeNull();
      expect(mark?.textContent).toBe("marked");
    });
  });

  // ── Backtick code spans preserve syntax characters in GFM table cells ────────
  // Using `...` (inlineCode MDAST nodes) keeps the content verbatim — none of
  // the remark plugins (remarkHighlight, remarkSupersub, remark-gfm inline)
  // process inlineCode nodes, so the syntax markers survive literally.
  const syntaxCases: [string, string][] = [
    ["`==text==`",  "==text=="],
    ["`^text^`",    "^text^"],
    ["`~text~`",    "~text~"],
    ["`**text**`",  "**text**"],
    ["`*text*`",    "*text*"],
    ["`~~text~~`",  "~~text~~"],
  ];

  for (const [mdSyntax, expected] of syntaxCases) {
    it(`backtick code span preserves literal "${expected}"`, async () => {
      const md = `| Feature | Syntax |\n|---|---|\n| test | ${mdSyntax} |`;
      const { container } = render(<MarkdownPreview content={md} />);
      await waitFor(() => {
        // The td should contain a <code> element with the exact literal text.
        const code = container.querySelector("td code");
        expect(code).not.toBeNull();
        expect(code?.textContent).toBe(expected);
      });
    });
  }

  it("strips on* event-handler attributes from user content", async () => {
    render(
      <MarkdownPreview content='<img src="x" onerror="window.__onerr=1" />' />,
    );
    // The image element (or nothing) should be in the DOM but without onerror.
    const img = document.querySelector("img");
    // Either stripped entirely or attribute removed.
    if (img) {
      expect(img.getAttribute("onerror")).toBeNull();
    }
    expect((window as unknown as Record<string, unknown>).__onerr).toBeUndefined();
  });
});
