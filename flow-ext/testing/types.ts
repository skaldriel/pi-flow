// ── Test Flow Definition (from tests.yaml) ─────────────────

export interface FlowDefinition {
  name: string;
  description?: string;
  viewport?: "desktop" | "mobile";
  steps: string[];
}

// ── Test Step (from .md file) ────────────────────────────

export interface TestStep {
  name: string;
  body: string;
  assertions: Assertion[];
}

// ── Assertion Types ──────────────────────────────────────

export type Assertion =
  | UrlEquals
  | UrlContains
  | TextVisible
  | TextNotVisible
  | ElementExists
  | ElementNotExists
  | ElementCount
  | ValueEquals;

export interface UrlEquals {
  url_equals: string;
}

export interface UrlContains {
  url_contains: string;
}

export interface TextVisible {
  text_visible: string;
}

export interface TextNotVisible {
  text_not_visible: string;
}

export interface ElementExists {
  element_exists: string;
}

export interface ElementNotExists {
  element_not_exists: string;
}

export interface ElementCount {
  element_count: {
    target: string;
    min?: number;
    max?: number;
    equals?: number;
  };
}

export interface ValueEquals {
  value_equals: {
    target: string;
    value: string;
  };
}

// ── Assertion Result ─────────────────────────────────────

export interface AssertionResult {
  type: string;
  passed: boolean;
  message: string;
}

// ── Test Result ──────────────────────────────────────────

export type StepStatus = "pass" | "fail" | "skip" | "pending" | "running";

export interface StepResult {
  step: string;
  status: StepStatus;
  durationMs: number;
  details?: string;
}

// ── Flow State (for cards widget) ────────────────────────

export type FlowStatus = "idle" | "running" | "passed" | "failed";

export interface FlowState {
  id: number;
  name: string;
  description: string;
  viewport: "desktop" | "mobile";
  testCount: number;
  status: FlowStatus;
  steps: string[]; // .md file names
}

// ── Viewport Config ──────────────────────────────────────

export interface ViewportConfig {
  width: number;
  height: number;
}

export interface ViewportPresets {
  desktop: ViewportConfig;
  mobile: ViewportConfig;
  [key: string]: ViewportConfig;
}
