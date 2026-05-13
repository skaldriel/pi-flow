import type { Page } from "playwright";
import type {
  Assertion,
  AssertionResult,
  UrlEquals,
  UrlContains,
  TextVisible,
  TextNotVisible,
  ElementExists,
  ElementNotExists,
  ElementCount,
  ValueEquals,
} from "./types";

/**
 * Evaluate all assertions against the current page state.
 * Returns an array of results — one per assertion.
 */
export async function evaluateAssertions(
  assertions: Assertion[],
  page: Page,
): Promise<AssertionResult[]> {
  const results: AssertionResult[] = [];

  for (const assertion of assertions) {
    if ("url_equals" in assertion) {
      results.push(await checkUrlEquals(assertion, page));
    } else if ("url_contains" in assertion) {
      results.push(await checkUrlContains(assertion, page));
    } else if ("text_visible" in assertion) {
      results.push(await checkTextVisible(assertion, page));
    } else if ("text_not_visible" in assertion) {
      results.push(await checkTextNotVisible(assertion, page));
    } else if ("element_exists" in assertion) {
      results.push(await checkElementExists(assertion, page));
    } else if ("element_not_exists" in assertion) {
      results.push(await checkElementNotExists(assertion, page));
    } else if ("element_count" in assertion) {
      results.push(await checkElementCount(assertion, page));
    } else if ("value_equals" in assertion) {
      results.push(await checkValueEquals(assertion, page));
    }
  }

  return results;
}

// ── Individual Checkers ───────────────────────────────────

async function checkUrlEquals(a: UrlEquals, page: Page): Promise<AssertionResult> {
  try {
    const current = page.url();
    const passed = current === a.url_equals;
    return {
      type: "url_equals",
      passed,
      message: passed
        ? `URL equals "${a.url_equals}"`
        : `Expected URL "${a.url_equals}", got "${current}"`,
    };
  } catch (err: any) {
    return { type: "url_equals", passed: false, message: `Error: ${err.message}` };
  }
}

async function checkUrlContains(a: UrlContains, page: Page): Promise<AssertionResult> {
  try {
    const current = page.url();
    const passed = current.includes(a.url_contains);
    return {
      type: "url_contains",
      passed,
      message: passed
        ? `URL contains "${a.url_contains}"`
        : `Expected URL to contain "${a.url_contains}", got "${current}"`,
    };
  } catch (err: any) {
    return { type: "url_contains", passed: false, message: `Error: ${err.message}` };
  }
}

async function checkTextVisible(a: TextVisible, page: Page): Promise<AssertionResult> {
  try {
    const locator = page.getByText(a.text_visible).first();
    const visible = await locator.isVisible({ timeout: 3000 }).catch(() => false);
    return {
      type: "text_visible",
      passed: visible,
      message: visible
        ? `"${a.text_visible}" is visible`
        : `"${a.text_visible}" is NOT visible`,
    };
  } catch (err: any) {
    return { type: "text_visible", passed: false, message: `Error: ${err.message}` };
  }
}

async function checkTextNotVisible(a: TextNotVisible, page: Page): Promise<AssertionResult> {
  try {
    const locator = page.getByText(a.text_not_visible).first();
    const hidden = await locator.isHidden({ timeout: 2000 }).catch(() => true);
    return {
      type: "text_not_visible",
      passed: hidden,
      message: hidden
        ? `"${a.text_not_visible}" is not visible`
        : `"${a.text_not_visible}" IS visible (shouldn't be)`,
    };
  } catch (err: any) {
    return { type: "text_not_visible", passed: false, message: `Error: ${err.message}` };
  }
}

async function checkElementExists(a: ElementExists, page: Page): Promise<AssertionResult> {
  try {
    const locator = resolveLocator(page, a.element_exists);
    const count = await locator.count();
    const passed = count > 0;
    return {
      type: "element_exists",
      passed,
      message: passed
        ? `Element "${a.element_exists}" exists`
        : `Element "${a.element_exists}" NOT found`,
    };
  } catch (err: any) {
    return { type: "element_exists", passed: false, message: `Error: ${err.message}` };
  }
}

async function checkElementNotExists(a: ElementNotExists, page: Page): Promise<AssertionResult> {
  try {
    const locator = resolveLocator(page, a.element_not_exists);
    const count = await locator.count();
    const passed = count === 0;
    return {
      type: "element_not_exists",
      passed,
      message: passed
        ? `Element "${a.element_not_exists}" does not exist`
        : `Element "${a.element_not_exists}" FOUND (${count} occurrence(s))`,
    };
  } catch (err: any) {
    return { type: "element_not_exists", passed: false, message: `Error: ${err.message}` };
  }
}

async function checkElementCount(a: ElementCount, page: Page): Promise<AssertionResult> {
  try {
    const locator = resolveLocator(page, a.element_count.target);
    const count = await locator.count();

    let passed = true;
    let reason = "";

    if (a.element_count.min !== undefined && count < a.element_count.min) {
      passed = false;
      reason = `expected at least ${a.element_count.min}, got ${count}`;
    }
    if (a.element_count.max !== undefined && count > a.element_count.max) {
      passed = false;
      reason = `expected at most ${a.element_count.max}, got ${count}`;
    }
    if (a.element_count.equals !== undefined && count !== a.element_count.equals) {
      passed = false;
      reason = `expected exactly ${a.element_count.equals}, got ${count}`;
    }

    return {
      type: "element_count",
      passed,
      message: passed
        ? `Element count for "${a.element_count.target}" = ${count}`
        : `Element count for "${a.element_count.target}": ${reason}`,
    };
  } catch (err: any) {
    return { type: "element_count", passed: false, message: `Error: ${err.message}` };
  }
}

async function checkValueEquals(a: ValueEquals, page: Page): Promise<AssertionResult> {
  try {
    const locator = resolveLocator(page, a.value_equals.target);
    const value = await locator.first().inputValue({ timeout: 3000 });
    const passed = value === a.value_equals.value;
    return {
      type: "value_equals",
      passed,
      message: passed
        ? `Value of "${a.value_equals.target}" equals "${a.value_equals.value}"`
        : `Expected "${a.value_equals.value}", got "${value}"`,
    };
  } catch (err: any) {
    return { type: "value_equals", passed: false, message: `Error: ${err.message}` };
  }
}

// ── Locator Resolution ────────────────────────────────────

/**
 * Resolves a target string to a Playwright Locator using chained strategies.
 * Mirrors the approach in browser-agent's executor.ts.
 */
function resolveLocator(page: Page, target: string) {
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
