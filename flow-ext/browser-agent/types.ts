// ── Page State ──────────────────────────────────────────────

export interface AccessibilityNode {
  role: string;
  name: string;
  description?: string;
  value?: string;
  children?: AccessibilityNode[];
}

export interface PageState {
  url: string;
  title: string;
  /** Raw base64 JPEG, no data URI prefix */
  screenshotBase64: string;
  /** Filtered accessibility tree (interactive + informative nodes) */
  elements: AccessibilityNode[];
  /** Total element count before filtering */
  totalElements: number;
}

// ── Action Results ─────────────────────────────────────────

export interface ActionResult {
  success: boolean;
  description: string;
  error?: string;
}

// ── Stuck Dialog ───────────────────────────────────────────

export type StuckAction =
  | "retry"
  | "manual"
  | "takeover"
  | "skip"
  | "abort";

export interface StuckContext {
  screenshotBase64: string;
  recentActions: ActionRecord[];
  stuckReason?: string;
}

export interface ActionRecord {
  type: string;
  description: string;
  status: "success" | "error";
}

export interface StuckResult {
  action: StuckAction;
  userInstructions?: string;
}

// ── Scroll ─────────────────────────────────────────────────

export type ScrollDirection =
  | "up"
  | "down"
  | "page_up"
  | "page_down"
  | "to_top"
  | "to_bottom";

// ── Browser Config ─────────────────────────────────────────

export interface BrowserConfig {
  /** Override Brave/Chromium executable path */
  executablePath?: string;
  /** Viewport width (default 1280) */
  viewportWidth?: number;
  /** Viewport height (default 900) */
  viewportHeight?: number;
  /** Max browser tool calls before circuit breaker warns (default 12) */
  maxToolCalls?: number;
}
