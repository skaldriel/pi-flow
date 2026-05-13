/**
 * Pi Testing Extension — Test Flow Runner
 *
 * Reads .agentic-tests/tests.yaml from the project CWD and displays
 * available test flows as a paginated card grid. Ctrl+1..9 executes
 * a flow. Results appear in a dedicated widget below the grid.
 *
 * Each flow step is a .md file with prose instructions (body) and
 * structured assertions (YAML frontmatter). The main Pi agent executes
 * steps using browser tools. Assertions are evaluated programmatically
 * against the browser page state after each step.
 *
 * V1: Main agent execution (sequential). V2: Subprocess parallelism.
 *
 * Usage: pi -e .pi/flow-ext/testing
 */

import type { ExtensionAPI, ExtensionContext, Theme, TUI } from "@mariozechner/pi-coding-agent";
import { readFileSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";
import { applyExtensionDefaults } from "../themeMap.ts";

import type {
  FlowDefinition,
  FlowState,
  FlowStatus,
  TestStep,
  StepResult,
  StepStatus,
  ViewportPresets,
} from "./types";
import { evaluateAssertions } from "./assertion-engine";
import { renderCardGrid, renderResultsList, CARDS_PER_PAGE } from "./widgets";

// ═══════════════════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════════════════

const TESTS_DIR = ".agentic-tests";
const FLOWS_FILE = "tests.yaml";

const DEFAULT_VIEWPORT_PRESETS: ViewportPresets = {
  desktop: { width: 1280, height: 900 },
  mobile: { width: 390, height: 844 },
};

// ═══════════════════════════════════════════════════════════
// Helpers: YAML parsing (minimal, no dependency)
// ═══════════════════════════════════════════════════════════

function parseTestsYaml(raw: string): FlowDefinition[] {
  const flows: FlowDefinition[] = [];
  const lines = raw.split("\n");
  let current: FlowDefinition | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Skip empty lines and comments
    if (!line.trim() || line.trim().startsWith("#")) continue;

    const flowMatch = line.match(/^(\S[^:]*):$/);
    if (flowMatch) {
      if (current) flows.push(current);
      current = {
        name: flowMatch[1].trim(),
        steps: [],
      };
      continue;
    }

    if (current) {
      const indentMatch = line.match(/^  (\w[\w-]*):\s*(.*)$/);
      if (indentMatch) {
        const key = indentMatch[1].trim();
        const value = indentMatch[2].trim();
        if (key === "description") {
          current.description = value.replace(/^["']|["']$/g, "");
        } else if (key === "viewport") {
          current.viewport = value as "desktop" | "mobile";
        } else if (key === "steps") {
          // steps list starts on next lines
        }
        continue;
      }

      const stepMatch = line.match(/^\s+-\s+(.+)$/);
      if (stepMatch) {
        current.steps.push(stepMatch[1].trim());
        continue;
      }
    }
  }

  if (current) flows.push(current);
  return flows;
}

// ═══════════════════════════════════════════════════════════
// Helpers: Test .md parsing
// ═══════════════════════════════════════════════════════════

function parseFrontmatterAssertions(yamlBlock: string): any[] {
  const assertions: any[] = [];
  const lines = yamlBlock.split("\n");
  let currentAssertion: any = null;

  for (const line of lines) {
    // Skip the "assertions:" line itself
    if (line.trim() === "assertions:" || line.trim() === "assertions: []") continue;

    const keyVal = line.match(/^\s*-\s+(\w+):\s*(.*)$/);
    if (keyVal) {
      if (currentAssertion) assertions.push(currentAssertion);
      const key = keyVal[1].trim();
      const value = keyVal[2].trim().replace(/^["']|["']$/g, "");

      // Handle inline object-like syntax for element_count and value_equals
      if (key === "element_count" && value.startsWith("{")) {
        currentAssertion = { element_count: parseInlineObj(value) };
      } else if (key === "value_equals" && value.startsWith("{")) {
        currentAssertion = { value_equals: parseInlineObj(value) };
      } else {
        currentAssertion = { [key]: value };
      }
      continue;
    }

    // Multi-line continuation for element_count / value_equals
    const contMatch = line.match(/^\s+(target|min|max|equals|value):\s*(.+)$/);
    if (contMatch && currentAssertion) {
      const contKey = contMatch[1].trim();
      const contVal = contMatch[2].trim().replace(/^["']|["']$/g, "");
      const assertionKey = Object.keys(currentAssertion)[0];
      if (!currentAssertion[assertionKey] || typeof currentAssertion[assertionKey] === "string") {
        currentAssertion[assertionKey] = {};
      }
      // Try to parse as number for min/max/equals
      if (["min", "max", "equals"].includes(contKey)) {
        (currentAssertion[assertionKey] as any)[contKey] = parseInt(contVal, 10);
      } else {
        (currentAssertion[assertionKey] as any)[contKey] = contVal;
      }
    }
  }

  if (currentAssertion) assertions.push(currentAssertion);
  return assertions;
}

function parseInlineObj(raw: string): any {
  // Parse simple inline objects like { target: "foo", min: 3 }
  const obj: any = {};
  const inner = raw.replace(/^\{|\}$/g, "").trim();
  const pairs = inner.split(/(?<!\\),/);
  for (const pair of pairs) {
    const [k, v] = pair.split(":").map((s) => s.trim().replace(/^["']|["']$/g, ""));
    if (k && v !== undefined) {
      const num = parseInt(v, 10);
      obj[k] = isNaN(num) ? v : num;
    }
  }
  return obj;
}

function parseTestMd(filePath: string): TestStep | null {
  try {
    const raw = readFileSync(filePath, "utf-8");
    const match = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
    if (!match) {
      // No frontmatter — entire file is the body, no assertions
      return {
        name: filePath.split("/").pop()?.replace(/\.md$/, "") || "unnamed",
        body: raw.trim(),
        assertions: [],
      };
    }

    const frontmatter = match[1];
    const body = match[2].trim();
    const name = filePath.split("/").pop()?.replace(/\.md$/, "") || "unnamed";

    // Try to find assertions in frontmatter
    const assertions = parseFrontmatterAssertions(frontmatter);

    return { name, body, assertions };
  } catch {
    return null;
  }
}

// ═══════════════════════════════════════════════════════════
// Helpers: Viewport presets from settings.json
// ═══════════════════════════════════════════════════════════

function loadViewportPresets(cwd: string): ViewportPresets {
  const presets = { ...DEFAULT_VIEWPORT_PRESETS };

  try {
    const globalPath = resolve(process.env.HOME || "~", ".pi", "agent", "settings.json");
    if (existsSync(globalPath)) {
      const global = JSON.parse(readFileSync(globalPath, "utf-8"));
      if (global?.viewportPresets) {
        Object.assign(presets, global.viewportPresets);
      }
    }
  } catch { /* ignore */ }

  try {
    const projectPath = resolve(cwd, ".pi", "settings.json");
    if (existsSync(projectPath)) {
      const project = JSON.parse(readFileSync(projectPath, "utf-8"));
      if (project?.viewportPresets) {
        Object.assign(presets, project.viewportPresets);
      }
    }
  } catch { /* ignore */ }

  return presets;
}

// ═══════════════════════════════════════════════════════════
// Extension Entry Point
// ═══════════════════════════════════════════════════════════

export default function (pi: ExtensionAPI) {
  // ── State ────────────────────────────────────────────
  let flows: FlowState[] = [];
  let results: StepResult[] = [];
  let currentPage = 0;
  let selectedFlowId: number | null = null;
  let tuiRef: TUI | null = null;
  let currentCtx: ExtensionContext | null = null;

  // Execution state
  let isRunning = false;
  let activeFlowSteps: TestStep[] = [];
  let activeFlowName = "";
  let activeStepIndex = 0;
  let activeFlowId: number | null = null;
  let stepStartTime = 0;

  // ── Widget rendering ─────────────────────────────────

  function updateWidgets(): void {
    if (!currentCtx) return;

    // Top widget: card grid
    currentCtx.ui.setWidget("test-flows", (_tui: TUI, theme: Theme) => {
      tuiRef = _tui;
      return {
        render(width: number): string[] {
          return renderCardGrid(flows, currentPage, selectedFlowId, width, theme);
        },
        invalidate(): void {},
      };
    });

    // Bottom widget: results
    currentCtx.ui.setWidget("test-results", (_tui: TUI, theme: Theme) => {
      return {
        render(width: number): string[] {
          return renderResultsList(results, activeFlowName, isRunning, width, theme);
        },
        invalidate(): void {},
      };
    }, { placement: "belowEditor" });

    // Status bar summary
    updateStatusBar();

    tuiRef?.requestRender();
  }

  function updateStatusBar(): void {
    if (!currentCtx) return;

    const total = flows.length;
    if (total === 0) {
      currentCtx.ui.setStatus("testing", undefined);
      return;
    }

    const passed = flows.filter((f) => f.status === "passed").length;
    const failed = flows.filter((f) => f.status === "failed").length;
    const running = flows.filter((f) => f.status === "running").length;

    const parts: string[] = [];
    if (running > 0) parts.push(`● ${running} running`);
    if (passed > 0) parts.push(`✓ ${passed} passed`);
    if (failed > 0) parts.push(`✗ ${failed} failed`);

    const text = `Tests: ${parts.join("  ")}`;
    currentCtx.ui.setStatus("testing", text);
  }

  // ── Load flows from disk ─────────────────────────────

  function loadFlows(cwd: string): void {
    const testsDir = resolve(cwd, TESTS_DIR);
    const yamlPath = join(testsDir, FLOWS_FILE);

    if (!existsSync(yamlPath)) {
      flows = [];
      return;
    }

    const raw = readFileSync(yamlPath, "utf-8");
    const definitions = parseTestsYaml(raw);
    const viewportPresets = loadViewportPresets(cwd);

    flows = definitions.map((def, i) => ({
      id: i + 1,
      name: def.name,
      description: def.description || "",
      viewport: def.viewport || "desktop",
      testCount: def.steps.length,
      status: "idle" as FlowStatus,
      steps: def.steps,
    }));
  }

  // ── Flow execution ───────────────────────────────────

  function startFlow(flowIndex: number): void {
    if (isRunning) return;

    const flow = flows[flowIndex];
    if (!flow) return;

    // Reset
    results = [];
    activeStepIndex = 0;
    isRunning = true;
    activeFlowId = flow.id;
    activeFlowName = flow.name;
    selectedFlowId = flow.id;

    // Mark as running
    flow.status = "running";

    // Load all test steps from .md files
    const testsDir = resolve(currentCtx?.cwd || process.cwd(), TESTS_DIR);
    activeFlowSteps = [];

    for (const stepFile of flow.steps) {
      const mdPath = join(testsDir, `${stepFile}.md`);
      if (!existsSync(mdPath)) {
        results.push({
          step: stepFile,
          status: "fail",
          durationMs: 0,
          details: `File not found: ${stepFile}.md`,
        });
        continue;
      }
      const step = parseTestMd(mdPath);
      if (!step) {
        results.push({
          step: stepFile,
          status: "fail",
          durationMs: 0,
          details: `Failed to parse: ${stepFile}.md`,
        });
        continue;
      }
      activeFlowSteps.push(step);
      results.push({
        step: step.name,
        status: "pending",
        durationMs: 0,
      });
    }

    updateWidgets();

    // Send first step
    if (activeFlowSteps.length > 0) {
      sendCurrentStep();
    } else {
      // No valid steps
      finalizeFlow(false);
    }
  }

  function sendCurrentStep(): void {
    if (activeStepIndex >= activeFlowSteps.length) {
      finalizeFlow(true);
      return;
    }

    const step = activeFlowSteps[activeStepIndex];
    results[activeStepIndex] = {
      step: step.name,
      status: "running",
      durationMs: 0,
    };
    stepStartTime = Date.now();
    updateWidgets();

    const prompt = buildStepPrompt(step, activeStepIndex + 1, activeFlowSteps.length);
    pi.sendUserMessage(prompt);
  }

  function buildStepPrompt(step: TestStep, stepNum: number, total: number): string {
    const assertionList = step.assertions.length > 0
      ? `\n\nAfter completing these steps, the following will be checked automatically:\n${
          step.assertions.map((a) => {
            const [type, value] = Object.entries(a)[0];
            return `- ${type}: ${typeof value === "string" ? value : JSON.stringify(value)}`;
          }).join("\n")
        }`
      : "";

    return `[TEST STEP ${stepNum}/${total} — ${activeFlowName}]

Execute the following test step using browser tools. Do EVERYTHING listed below before responding — do not stop mid-way:

${step.body}
${assertionList}

CRITICAL: You MUST complete ALL actions in this step before giving your final response. The test runner will evaluate assertions after you finish. Do not respond until every action is done.`;
  }

  function advanceStep(): void {
    activeStepIndex++;
    sendCurrentStep();
  }

  function finalizeFlow(passed: boolean): void {
    isRunning = false;

    // Update flow status
    if (activeFlowId !== null) {
      const flow = flows.find((f) => f.id === activeFlowId);
      if (flow) {
        flow.status = passed ? "passed" : "failed";
      }
    }

    // Notify
    const icon = passed ? "✓" : "✗";
    const status = passed ? "PASSED" : "FAILED";
    currentCtx?.ui.notify(
      `${icon} Flow "${activeFlowName}" ${status}`,
      passed ? "success" : "error",
    );

    activeFlowId = null;
    activeFlowName = "";
    activeFlowSteps = [];
    activeStepIndex = 0;
    updateWidgets();
  }

  // ═══════════════════════════════════════════════════════
  // Pi Event Hooks
  // ═══════════════════════════════════════════════════════

  pi.on("session_start", async (_event, ctx) => {
    applyExtensionDefaults(import.meta.url, ctx);
    currentCtx = ctx;
    loadFlows(ctx.cwd);
    updateWidgets();

    // Notify user
    if (flows.length > 0) {
      const flowList = flows.map((f) => `  #${f.id} ${f.name} (${f.testCount} tests)`).join("\n");
      ctx.ui.notify(
        `📋 ${flows.length} test flow(s) loaded:\n${flowList}\n\n` +
        `Ctrl+1..9   Run flow\n` +
        `← →         Navigate pages\n` +
        `/test-flow <name>  Run flow by name`,
        "info",
      );
    } else {
      ctx.ui.notify(
        `No test flows found. Create .agentic-tests/tests.yaml in your project.`,
        "warning",
      );
    }
  });

  pi.on("before_agent_start", async (event) => {
    if (!isRunning) return {};

    const step = activeFlowSteps[activeStepIndex];
    if (!step) return {};

    let assertionPrompt = "";
    if (step.assertions.length > 0) {
      assertionPrompt = "\n\nAfter this step, assertions will be checked automatically. " +
        "Make sure the page is in the expected state before finishing.";
    }

    return {
      systemPrompt:
        event.systemPrompt +
        `\n\n## TEST RUNNER MODE — ${activeFlowName} [Step ${activeStepIndex + 1}/${activeFlowSteps.length}]\n` +
        "You are executing a test flow. Your ONLY job is to complete the test step actions below.\n" +
        "DO NOT produce a text response until you have completed EVERY action in the step.\n" +
        "If you need to use multiple tools, use them ALL before giving your final response.\n" +
        "Only use browser tools (browser_navigate, browser_click, browser_type, etc.).\n" +
        "Do NOT call bash, read, write, or any non-browser tool.\n" +
        "When completely done with all actions, respond with a brief summary.\n" +
        "The test runner will evaluate assertions automatically after your final response." +
        assertionPrompt,
    };
  });

  pi.on("agent_end", async (event, ctx) => {
    if (!isRunning) return;

    const step = activeFlowSteps[activeStepIndex];
    if (!step) return;

    const elapsed = Date.now() - stepStartTime;

    // Try to get the browser page for assertion evaluation
    let assertionResults;
    try {
      // Dynamic import to avoid hard dependency at load time
      const { BrowserManager } = await import("../browser-agent/browser-manager.ts");
      const browser = BrowserManager.getInstance();
      if (browser.isLaunched()) {
        assertionResults = await evaluateAssertions(step.assertions, browser.getPage());
      } else {
        // Browser not launched — can't evaluate assertions
        assertionResults = [{
          type: "warning",
          passed: false,
          message: "Browser not launched. Call browser_launch first.",
        }];
      }
    } catch (err: any) {
      // browser-agent not available or other error
      assertionResults = [{
        type: "warning",
        passed: false,
        message: `Cannot access browser: ${err.message}. Make sure browser-agent extension is loaded.`,
      }];
    }

    const allPassed = assertionResults.every((r) => r.passed);

    // Update result for this step
    if (results[activeStepIndex]) {
      results[activeStepIndex] = {
        step: step.name,
        status: allPassed ? "pass" : "fail",
        durationMs: elapsed,
        details: allPassed
          ? undefined
          : assertionResults
              .filter((r) => !r.passed)
              .map((r) => r.message)
              .join("; "),
      };
    }

    updateWidgets();

    if (!allPassed) {
      finalizeFlow(false);
      return;
    }

    // Advance to next step
    activeStepIndex++;
    if (activeStepIndex >= activeFlowSteps.length) {
      finalizeFlow(true);
      return;
    }

    sendCurrentStep();
  });

  // ═══════════════════════════════════════════════════════
  // Keyboard Shortcuts
  // ═══════════════════════════════════════════════════════

  for (let i = 1; i <= 9; i++) {
    pi.registerShortcut(`ctrl+${i}`, {
      description: `Run test flow #${i}`,
      handler: async (ctx: ExtensionContext) => {
        if (isRunning) {
          ctx.ui.notify("A test flow is already running. Wait for it to finish.", "warning");
          return;
        }
        const flowIndex = currentPage * CARDS_PER_PAGE + (i - 1);
        if (flowIndex < 0 || flowIndex >= flows.length) {
          ctx.ui.notify(`No flow at position ${i} on this page.`, "warning");
          return;
        }
        startFlow(flowIndex);
      },
    });
  }

  pi.registerShortcut("left", {
    description: "Previous page of test flows",
    handler: async () => {
      if (currentPage > 0) {
        currentPage--;
        updateWidgets();
      }
    },
  });

  pi.registerShortcut("right", {
    description: "Next page of test flows",
    handler: async () => {
      const totalPages = Math.max(1, Math.ceil(flows.length / CARDS_PER_PAGE));
      if (currentPage < totalPages - 1) {
        currentPage++;
        updateWidgets();
      }
    },
  });

  // ═══════════════════════════════════════════════════════
  // Slash Command
  // ═══════════════════════════════════════════════════════

  pi.registerCommand("test-flow", {
    description: "Run a test flow by name",
    handler: async (args, ctx) => {
      if (isRunning) {
        ctx.ui.notify("A test flow is already running.", "warning");
        return;
      }

      const name = args?.trim();
      if (!name) {
        // Show list of available flows
        const options = flows.map(
          (f) => `${f.name} [${f.viewport}] — ${f.testCount} tests — ${f.status}`,
        );
        const choice = await ctx.ui.select("Select test flow to run", options);
        if (choice === undefined) return;
        const idx = options.indexOf(choice);
        if (idx >= 0 && idx < flows.length) {
          startFlow(idx);
        }
        return;
      }

      const flowIndex = flows.findIndex(
        (f) => f.name.toLowerCase() === name.toLowerCase(),
      );

      if (flowIndex === -1) {
        ctx.ui.notify(
          `Flow "${name}" not found. Available: ${flows.map((f) => f.name).join(", ")}`,
          "error",
        );
        return;
      }

      startFlow(flowIndex);
    },
  });

  // ═══════════════════════════════════════════════════════
  // Session cleanup
  // ═══════════════════════════════════════════════════════

  pi.on("session_shutdown", async () => {
    isRunning = false;
    activeFlowSteps = [];
    results = [];
    tuiRef = null;
    currentCtx = null;
  });
}
