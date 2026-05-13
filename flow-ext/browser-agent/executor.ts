import type { Page, Locator } from "playwright";
import type { ActionResult, ScrollDirection } from "./types";

// ── Target Resolution ─────────────────────────────────────

/**
 * Resolves a human-readable target to a Playwright Locator by chaining
 * multiple strategies with locator.or(). Playwright tries all strategies
 * and the first one to match during the action timeout wins.
 *
 * Priority order (first match wins):
 *   1. Exact visible text     → getByText(target, { exact: true })
 *   2. Aria label             → getByLabel(target)
 *   3. Placeholder            → getByPlaceholder(target)
 *   4. Partial visible text   → getByText(target)
 *   5. Title attribute        → [title="target"]
 *   6. data-testid            → [data-testid="target"]
 *   7. ID attribute           → #target
 *   8. Name attribute         → [name="target"]
 *   9. Button role            → getByRole("button", { name: target })
 *  10. Link role              → getByRole("link", { name: target })
 *  11. Textbox role           → getByRole("textbox", { name: target })
 *  12. Combobox role          → getByRole("combobox", { name: target })
 *  13. Checkbox role          → getByRole("checkbox", { name: target })
 *  14. Radio role             → getByRole("radio", { name: target })
 *  15. Option role            → getByRole("option", { name: target })
 *  16. Menuitem role          → getByRole("menuitem", { name: target })
 *  17. Tab role               → getByRole("tab", { name: target })
 *  18. Raw CSS / XPath        → locator(target)
 */
function resolveTarget(page: Page, target: string): Locator {
  return page.getByText(target, { exact: true })
    .or(page.getByLabel(target))
    .or(page.getByPlaceholder(target))
    .or(page.getByText(target))
    .or(page.locator(`[title="${target}"]`))
    .or(page.locator(`[data-testid="${target}"]`))
    .or(page.locator(`#${target}`))
    .or(page.locator(`[name="${target}"]`))
    .or(page.getByRole("button", { name: target }))
    .or(page.getByRole("link", { name: target }))
    .or(page.getByRole("textbox", { name: target }))
    .or(page.getByRole("combobox", { name: target }))
    .or(page.getByRole("checkbox", { name: target }))
    .or(page.getByRole("radio", { name: target }))
    .or(page.getByRole("option", { name: target }))
    .or(page.getByRole("menuitem", { name: target }))
    .or(page.getByRole("tab", { name: target }))
    .or(page.locator(target));
}

// Legacy — removed the broken existsSync stub

// ── ActionExecutor ────────────────────────────────────────

export class ActionExecutor {
  constructor(private page: Page) {}

  // ── Navigate ───────────────────────────────────────────

  async navigate(url: string): Promise<ActionResult> {
    try {
      // Resolve relative URLs
      const resolved = url.startsWith("http") ? url : new URL(url, this.page.url()).href;
      await this.page.goto(resolved, {
        waitUntil: "domcontentloaded",
        timeout: 15_000,
      });
      return {
        success: true,
        description: `Navigated to ${resolved}. Current URL: ${this.page.url()}`,
      };
    } catch (err: any) {
      return { success: false, description: "Navigation failed", error: err.message };
    }
  }

  // ── Click ──────────────────────────────────────────────

  async click(target: string): Promise<ActionResult> {
    try {
      const loc = resolveTarget(this.page, target);
      await loc.first().click({ timeout: 5_000 });
      return { success: true, description: `Clicked "${target}"` };
    } catch (err: any) {
      return { success: false, description: `Click on "${target}" failed`, error: err.message };
    }
  }

  // ── Type ───────────────────────────────────────────────

  async type(target: string, text: string): Promise<ActionResult> {
    try {
      const loc = resolveTarget(this.page, target);
      await loc.first().click({ timeout: 3_000 });
      await loc.first().fill(text, { timeout: 5_000 });
      // Small pause for JS events to fire
      await this.page.waitForTimeout(100);
      return { success: true, description: `Typed ${text.length} chars into "${target}"` };
    } catch (err: any) {
      return { success: false, description: `Type into "${target}" failed`, error: err.message };
    }
  }

  // ── Scroll ─────────────────────────────────────────────

  async scroll(direction: ScrollDirection): Promise<ActionResult> {
    try {
      const scrollFn = (dir: ScrollDirection) => {
        const amount = dir === "page_down" ? window.innerHeight * 0.8
          : dir === "page_up" ? -window.innerHeight * 0.8
          : dir === "down" ? 300
          : dir === "up" ? -300
          : 0;

        if (dir === "to_top") window.scrollTo(0, 0);
        else if (dir === "to_bottom") window.scrollTo(0, document.body.scrollHeight);
        else window.scrollBy({ top: amount, behavior: "smooth" });
      };

      await this.page.evaluate(scrollFn, direction);
      await this.page.waitForTimeout(300);
      return { success: true, description: `Scrolled ${direction}` };
    } catch (err: any) {
      return { success: false, description: "Scroll failed", error: err.message };
    }
  }

  // ── Press Key ──────────────────────────────────────────

  async press(key: string): Promise<ActionResult> {
    try {
      await this.page.keyboard.press(key);
      return { success: true, description: `Pressed "${key}"` };
    } catch (err: any) {
      return { success: false, description: `Press "${key}" failed`, error: err.message };
    }
  }

  // ── Hover ──────────────────────────────────────────────

  async hover(target: string): Promise<ActionResult> {
    try {
      const loc = resolveTarget(this.page, target);
      await loc.first().hover({ timeout: 5_000 });
      return { success: true, description: `Hovered "${target}"` };
    } catch (err: any) {
      return { success: false, description: `Hover on "${target}" failed`, error: err.message };
    }
  }

  // ── Select Option ──────────────────────────────────────

  async select(target: string, value: string): Promise<ActionResult> {
    try {
      const loc = resolveTarget(this.page, target);
      await loc.first().selectOption({ label: value }, { timeout: 5_000 });
      return { success: true, description: `Selected "${value}" in "${target}"` };
    } catch (err: any) {
      // Try by value
      try {
        const loc = resolveTarget(this.page, target);
        await loc.first().selectOption(value, { timeout: 5_000 });
        return { success: true, description: `Selected "${value}" in "${target}"` };
      } catch (err2: any) {
        return {
          success: false,
          description: `Select "${value}" in "${target}" failed`,
          error: err.message,
        };
      }
    }
  }

  // ── Wait ───────────────────────────────────────────────

  async wait(ms: number): Promise<ActionResult> {
    try {
      if (ms === 0) {
        await this.page.waitForLoadState("networkidle", { timeout: 15_000 });
        return { success: true, description: "Waited for network idle" };
      }
      await this.page.waitForTimeout(Math.min(ms, 30_000));
      return { success: true, description: `Waited ${ms}ms` };
    } catch (err: any) {
      return { success: false, description: "Wait failed", error: err.message };
    }
  }

  // ── Navigation ─────────────────────────────────────────

  async back(): Promise<ActionResult> {
    try {
      await this.page.goBack({ timeout: 10_000, waitUntil: "domcontentloaded" });
      return { success: true, description: `Went back. URL: ${this.page.url()}` };
    } catch (err: any) {
      return { success: false, description: "Go back failed", error: err.message };
    }
  }

  async forward(): Promise<ActionResult> {
    try {
      await this.page.goForward({ timeout: 10_000, waitUntil: "domcontentloaded" });
      return { success: true, description: `Went forward. URL: ${this.page.url()}` };
    } catch (err: any) {
      return { success: false, description: "Go forward failed", error: err.message };
    }
  }

  async refresh(): Promise<ActionResult> {
    try {
      await this.page.reload({ timeout: 10_000, waitUntil: "domcontentloaded" });
      return { success: true, description: `Refreshed. URL: ${this.page.url()}` };
    } catch (err: any) {
      return { success: false, description: "Refresh failed", error: err.message };
    }
  }
}
