import {
  type TUI,
  Text,
  Spacer,
  Image,
  SelectList,
  type SelectItem,
  Key,
  matchesKey,
} from "@mariozechner/pi-tui";
import type { Theme } from "@mariozechner/pi-coding-agent";
import { DynamicBorder } from "@mariozechner/pi-coding-agent";
import type { StuckContext, StuckAction, StuckResult } from "./types";

// ── Select Items ──────────────────────────────────────────

const STUCK_ITEMS: SelectItem[] = [
  {
    value: "retry",
    label: "🔄 Retry with different approach",
    description: "Let the agent try again with an alternative strategy",
  },
  {
    value: "manual",
    label: "📋 Give me manual instructions",
    description: "You describe what to do; the agent continues",
  },
  {
    value: "takeover",
    label: "🖐  Take over and let me drive",
    description: "You interact with the browser manually; agent waits",
  },
  {
    value: "skip",
    label: "⏭  Skip this step",
    description: "Skip the problematic action and keep going",
  },
  {
    value: "abort",
    label: "✕  Abort browser session",
    description: "Stop the browser agent and close the window",
  },
];

// ── Component ─────────────────────────────────────────────

export class StuckDialog {
  private tui: TUI;
  private theme: Theme;
  private context: StuckContext;
  private selectList: SelectList;

  private cachedWidth?: number;
  private cachedLines?: string[];

  private resolve!: (result: StuckResult | null) => void;

  constructor(tui: TUI, theme: Theme, context: StuckContext) {
    this.tui = tui;
    this.theme = theme;
    this.context = context;

    this.selectList = new SelectList(STUCK_ITEMS, STUCK_ITEMS.length, {
      selectedPrefix: (t: string) => theme.fg("accent", t),
      selectedText: (t: string) => theme.fg("accent", t),
      description: (t: string) => theme.fg("muted", t),
      scrollInfo: (t: string) => theme.fg("dim", t),
      noMatch: (t: string) => theme.fg("warning", t),
    });
  }

  wireResolve(resolve: (result: StuckResult | null) => void): void {
    this.resolve = resolve;
    this.selectList.onSelect = (item) => {
      resolve({ action: item.value as StuckAction });
    };
    this.selectList.onCancel = () => resolve(null);
  }

  handleInput(data: string): void {
    this.selectList.handleInput(data);
    this.tui.requestRender();
  }

  invalidate(): void {
    this.cachedLines = undefined;
    this.cachedWidth = undefined;
    this.selectList.invalidate();
  }

  render(width: number): string[] {
    if (this.cachedLines && this.cachedWidth === width) {
      return this.cachedLines;
    }

    const t = this.theme;
    const ctx = this.context;
    const lines: string[] = [];

    // ── Top border + title ──
    lines.push(...new DynamicBorder((s: string) => t.fg("accent", s)).render(width));
    lines.push(...new Text(t.fg("accent", t.bold("⚠  Browser Agent Needs Your Help")), 1, 0).render(width));

    // Stuck reason
    if (ctx.stuckReason) {
      lines.push(...new Spacer(1).render(width));
      lines.push(...new Text(t.fg("warning", ctx.stuckReason), 1, 0).render(width));
    }

    // ── Screenshot ──
    if (ctx.screenshotBase64) {
      lines.push(...new Spacer(1).render(width));
      lines.push(...new Text(t.fg("muted", "┌─ Current Page ──────────────────────────────"), 0, 0).render(width));

      const img = new Image(
        ctx.screenshotBase64,
        "image/jpeg",
        { fallbackColor: (s: string) => t.fg("dim", s) },
        { maxWidthCells: Math.min(width - 4, 70), maxHeightCells: 10 },
      );
      lines.push(...img.render(width));
      lines.push(...new Text(t.fg("muted", "└──────────────────────────────────────────────"), 0, 0).render(width));
    }

    // ── Recent Actions ──
    if (ctx.recentActions.length > 0) {
      lines.push(...new Spacer(1).render(width));
      lines.push(...new Text(t.fg("muted", "┌─ Recent Actions ────────────────────────────"), 0, 0).render(width));

      const show = ctx.recentActions.slice(-6);
      for (const action of show) {
        const icon = action.status === "success" ? "✓" : "✗";
        const color = action.status === "success" ? "success" : "error";
        const line = `  ${t.fg(color, icon)} ${t.fg("dim", action.type.padEnd(14))} ${action.description}`;
        lines.push(...new Text(line, 0, 0).render(width));
      }
      lines.push(...new Text(t.fg("muted", "└──────────────────────────────────────────────"), 0, 0).render(width));
    }

    // ── Options ──
    lines.push(...new Spacer(1).render(width));
    lines.push(...new Text(t.fg("accent", "What should the agent do?"), 1, 0).render(width));
    lines.push(...this.selectList.render(width));

    // ── Help ──
    lines.push(...new Spacer(1).render(width));
    lines.push(
      ...new Text(t.fg("dim", "↑↓ navigate  ·  enter select  ·  esc cancel  ·  / filter"), 1, 0).render(width),
    );

    // ── Bottom border ──
    lines.push(...new DynamicBorder((s: string) => t.fg("accent", s)).render(width));

    this.cachedWidth = width;
    this.cachedLines = lines;
    return lines;
  }
}

// ── Factory function for ctx.ui.custom() ──────────────────

export function createStuckOverlay(context: StuckContext) {
  return (tui: TUI, theme: Theme, _kb: any, done: (result: StuckResult | null) => void) => {
    const dialog = new StuckDialog(tui, theme, context);
    dialog.wireResolve((result) => {
      if (!result) {
        done(null);
        return;
      }
      if (result.action === "manual" || result.action === "takeover") {
        // We need to collect user instructions — resolve with what we have
        // The tool's execute() will handle the follow-up input
        done(result);
        return;
      }
      done(result);
    });

    return {
      render: (w: number) => dialog.render(w),
      invalidate: () => dialog.invalidate(),
      handleInput: (data: string) => dialog.handleInput(data),
    };
  };
}
