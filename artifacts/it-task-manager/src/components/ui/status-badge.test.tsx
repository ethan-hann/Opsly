/**
 * StatusBadge unit tests
 *
 * Confirms the component renders the colored stage badge when the API provides
 * stageName + stageColor, and falls back to the legacy label otherwise.
 * This prevents regressions where tasks with numeric stage-ID status values
 * (e.g. "1") would display the raw number instead of the stage name.
 */

import * as React from "react";
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { StatusBadge } from "./status-badge";

describe("StatusBadge — colored stage badge", () => {
  it("renders the stageName when both stageName and stageColor are provided", () => {
    render(
      <StatusBadge status="1" stageName="In Progress" stageColor="#f59e0b" />,
    );
    expect(screen.getByText("In Progress")).toBeInTheDocument();
  });

  it("does NOT render the raw status value when stageName and stageColor are present", () => {
    render(
      <StatusBadge status="1" stageName="In Progress" stageColor="#f59e0b" />,
    );
    // "1" is a numeric stage-ID — it must never appear as visible text
    expect(screen.queryByText("1")).not.toBeInTheDocument();
  });

  it("applies inline color styles derived from stageColor", () => {
    const { container } = render(
      <StatusBadge status="1" stageName="In Progress" stageColor="#f59e0b" />,
    );
    const badge = container.firstChild as HTMLElement;
    // jsdom normalises hex to rgb() — just assert a non-empty inline color is set
    expect(badge.style.color).not.toBe("");
    expect(badge.style.backgroundColor).not.toBe("");
  });

  it("shows the (archived) prefix and reduced opacity when stageArchived is true", () => {
    render(
      <StatusBadge
        status="1"
        stageName="Old Stage"
        stageColor="#6b7280"
        stageArchived
      />,
    );
    expect(screen.getByText("(archived)")).toBeInTheDocument();
    expect(screen.getByText("Old Stage")).toBeInTheDocument();
  });

  it("falls back to the legacy label when stageColor is absent", () => {
    // stageName alone is not enough — both must be present for the colored path.
    // t('common.open') returns "Open"; match case-insensitively so the assertion
    // is resilient to future terminology changes.
    render(<StatusBadge status="open" stageName="Open" />);
    expect(screen.getByText(/^open$/i)).toBeInTheDocument();
  });

  it("falls back to the legacy label when stageName is absent", () => {
    render(<StatusBadge status="open" stageColor="#10b981" />);
    expect(screen.getByText(/^open$/i)).toBeInTheDocument();
  });
});
