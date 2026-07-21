import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MarkdownPreview } from "./markdown-preview";

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
