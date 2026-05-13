import type { Theme } from "@mariozechner/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@mariozechner/pi-tui";
import type { FlowState, StepResult, StepStatus } from "./types";

// ── Layout Constants ──────────────────────────────────────

export const CARDS_PER_PAGE = 9;
const CARD_GAP = 1;

// ── Icons ─────────────────────────────────────────────────

const VIEWPORT_ICON: Record<string, string> = {
  desktop: "🖥 ",
  mobile: "📱",
};

const STATUS_ICON: Record<string, string> = {
  idle: "○",
  running: "●",
  passed: "✓",
  failed: "✗",
};

const STATUS_COLOR: Record<string, string> = {
  idle: "dim",
  running: "accent",
  passed: "success",
  failed: "error",
};

const RESULT_ICON: Record<StepStatus, string> = {
  pending: "○",
  running: "◌",
  pass: "✓",
  fail: "✗",
  skip: "⊘",
};

const RESULT_COLOR: Record<StepStatus, string> = {
  pending: "muted",
  running: "accent",
  pass: "success",
  fail: "error",
  skip: "dim",
};

// ── Safe padding helper ───────────────────────────────────

/** Pad a string to fit exactly `targetWidth` visible characters. */
function padToWidth(content: string, targetWidth: number): string {
  const vis = visibleWidth(content);
  if (vis >= targetWidth) return truncateToWidth(content, targetWidth);
  return content + " ".repeat(targetWidth - vis);
}

// ═══════════════════════════════════════════════════════════
// 1. CARD GRID RENDERING
// ═══════════════════════════════════════════════════════════

/**
 * Render a single flow card. Every line is exactly `cardWidth` visible chars.
 * Returns array of 6 strings.
 */
function renderCard(
  flow: FlowState,
  selected: boolean,
  cardWidth: number,
  theme: Theme,
): string[] {
  if (cardWidth < 10) {
    // Too narrow — return minimal card
    return [
      truncateToWidth(flow.name, cardWidth),
      truncateToWidth(flow.status, cardWidth),
      "",
      "",
      "",
      "",
    ];
  }

  const innerW = cardWidth - 2; // space between borders
  const contentW = Math.max(1, innerW - 2); // internal padding
  const borderColor = selected ? "accent" : "dim";
  const b = (s: string) => theme.fg(borderColor, s);

  const lines: string[] = [];

  // Top border: ┌───┐
  lines.push(b("┌") + b("─".repeat(innerW)) + b("┐"));

  // Row 1: icon + #N + name
  const icon = VIEWPORT_ICON[flow.viewport] || "";
  const header = `${icon}#${flow.id} ${flow.name}`;
  lines.push(
    b("│") + " " +
    padToWidth(theme.fg("accent", theme.bold(header)), contentW) +
    " " + b("│"),
  );

  // Row 2: status
  const color = STATUS_COLOR[flow.status];
  const statusText = theme.fg(color, `${STATUS_ICON[flow.status]} ${flow.status}`);
  lines.push(
    b("│") + " " + padToWidth(statusText, contentW) + " " + b("│"),
  );

  // Row 3: test count
  const countText = theme.fg("dim", `${flow.testCount} test${flow.testCount !== 1 ? "s" : ""}`);
  lines.push(
    b("│") + " " + padToWidth(countText, contentW) + " " + b("│"),
  );

  // Row 4: description
  const desc = flow.description || "(no description)";
  lines.push(
    b("│") + " " + padToWidth(theme.fg("muted", desc), contentW) + " " + b("│"),
  );

  // Bottom border: └───┘
  lines.push(b("└") + b("─".repeat(innerW)) + b("┘"));

  // Safety: truncate every line to cardWidth
  return lines.map((l) => truncateToWidth(l, cardWidth));
}

/**
 * Renders the full card grid for a given page of flows.
 * Every output line is guaranteed ≤ width.
 */
export function renderCardGrid(
  flows: FlowState[],
  currentPage: number,
  selectedFlowId: number | null,
  width: number,
  theme: Theme,
): string[] {
  if (flows.length === 0) {
    const innerW = Math.max(1, width - 2);
    const msg = "No test flows found. Add .agentic-tests/tests.yaml";
    return [
      truncateToWidth(theme.fg("dim", "┌" + "─".repeat(innerW) + "┐"), width),
      truncateToWidth(
        theme.fg("dim", "│") + " " + theme.fg("muted", msg) +
        " ".repeat(Math.max(0, innerW - visibleWidth(msg) - 1)) +
        theme.fg("dim", "│"),
        width,
      ),
      truncateToWidth(theme.fg("dim", "└" + "─".repeat(innerW) + "┘"), width),
    ];
  }

  const totalPages = Math.ceil(flows.length / CARDS_PER_PAGE);
  const startIdx = currentPage * CARDS_PER_PAGE;
  const pageFlows = flows.slice(startIdx, startIdx + CARDS_PER_PAGE);

  // Determine grid layout
  const cols = width >= 90 ? 3 : width >= 60 ? 2 : 1;
  const totalGap = (cols - 1) * CARD_GAP;
  const cardWidth = Math.max(14, Math.floor((width - totalGap) / cols));

  const gridLines: string[] = [];

  for (let row = 0; row < Math.ceil(pageFlows.length / cols); row++) {
    const rowFlows = pageFlows.slice(row * cols, row * cols + cols);
    const cards: string[][] = rowFlows.map((f) =>
      renderCard(f, f.id === selectedFlowId, cardWidth, theme),
    );

    // Pad to full row
    while (cards.length < cols) {
      cards.push(Array(6).fill(" ".repeat(cardWidth)));
    }

    const cardHeight = cards[0]!.length;
    for (let line = 0; line < cardHeight; line++) {
      const joined = cards
        .map((card) => card[line] || " ".repeat(cardWidth))
        .join(" ".repeat(CARD_GAP));
      gridLines.push(truncateToWidth(joined, width));
    }
  }

  // Navigation bar
  gridLines.push("");
  gridLines.push(truncateToWidth(renderNavBar(currentPage, totalPages, theme), width));

  return gridLines;
}

function renderNavBar(page: number, totalPages: number, theme: Theme): string {
  const left = page > 0 ? theme.fg("accent", "←") : theme.fg("dim", "←");
  const right = page < totalPages - 1 ? theme.fg("accent", "→") : theme.fg("dim", "→");
  const info = theme.fg("dim", `Page ${page + 1}/${totalPages}`);
  return `${left} ${info} ${right}`;
}

// ═══════════════════════════════════════════════════════════
// 2. RESULTS LIST RENDERING
// ═══════════════════════════════════════════════════════════

export function renderResultsList(
  results: StepResult[],
  flowName: string | null,
  isRunning: boolean,
  width: number,
  theme: Theme,
): string[] {
  if (!flowName && results.length === 0) return [];

  const lines: string[] = [];
  const innerW = Math.max(1, width - 2);
  const border = (s: string) => theme.fg("dim", s);

  // ── Header border (safe: uses innerW) ──
  const label = " Results ";
  const labelLen = visibleWidth(label);
  const remaining = Math.max(0, innerW - labelLen);
  const leftDash = Math.floor(remaining / 2);
  const rightDash = remaining - leftDash;
  lines.push(truncateToWidth(
    border("┌") + border("─".repeat(leftDash)) + border(label) + border("─".repeat(rightDash)) + border("┐"),
    width,
  ));

  // ── Flow name ──
  if (flowName) {
    const prefix = isRunning ? theme.fg("accent", "● ") : theme.fg("success", "✓ ");
    const content = prefix + flowName;
    lines.push(truncateToWidth(
      border("│") + " " + padToWidth(content, innerW) + " " + border("│"),
      width,
    ));
    lines.push(truncateToWidth(
      border("│") + " ".repeat(innerW) + " " + border("│"),
      width,
    ));
  }

  // ── Results ──
  if (results.length === 0) {
    const msg = "No results yet. Press Ctrl+N to run a flow.";
    lines.push(truncateToWidth(
      border("│") + " " + padToWidth(theme.fg("muted", msg), innerW) + " " + border("│"),
      width,
    ));
  } else {
    for (const r of results) {
      const color = RESULT_COLOR[r.status];
      const icon = RESULT_ICON[r.status];
      const stepPart = theme.fg(color, `${icon} ${r.step}`);

      let durPart = "";
      if (r.status !== "pending" && r.status !== "running" && r.durationMs > 0) {
        durPart = theme.fg("dim", ` (${formatDuration(r.durationMs)})`);
      } else if (r.status === "running") {
        durPart = theme.fg("accent", " ...");
      }

      const line = stepPart + durPart;
      lines.push(truncateToWidth(
        border("│") + " " + padToWidth(line, innerW) + " " + border("│"),
        width,
      ));

      // Failure details (indented)
      if (r.status === "fail" && r.details) {
        const detailW = Math.max(1, innerW - 4);
        for (const dl of r.details.split("; ").slice(0, 3)) {
          lines.push(truncateToWidth(
            border("│") + "    " + padToWidth(theme.fg("error", dl), detailW) + " " + border("│"),
            width,
          ));
        }
      }
    }
  }

  // ── Bottom border ──
  lines.push(truncateToWidth(
    border("└") + border("─".repeat(innerW)) + border("┘"),
    width,
  ));

  return lines;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const min = Math.floor(ms / 60000);
  const sec = Math.round((ms % 60000) / 1000);
  return `${min}m ${sec}s`;
}
