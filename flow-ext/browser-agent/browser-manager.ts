import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { existsSync } from "node:fs";
import type { PageState, AccessibilityNode, BrowserConfig } from "./types";

// ── Brave Detection ───────────────────────────────────────

function detectBravePath(): string | undefined {
  const platform = process.platform;
  if (platform === "linux") {
    const candidates = [
      "/usr/bin/brave-browser",        // Ubuntu/Debian
      "/usr/bin/brave",                 // Arch/Manjaro
      "/usr/bin/brave-browser-stable",  // Alternative Arch
      "/snap/bin/brave",                // Snap
      "/opt/brave.com/brave/brave-browser", // Flatpak-like
    ];
    for (const p of candidates) {
      if (existsSync(p)) return p;
    }
  } else if (platform === "darwin") {
    const p = "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser";
    if (existsSync(p)) return p;
  }
  return undefined; // fallback: Playwright's bundled Chromium
}

// ── Accessibility Filtering ────────────────────────────────

const INTERESTING_ROLES = new Set([
  "button", "link", "textbox", "searchbox", "combobox", "listbox",
  "menuitem", "checkbox", "radio", "switch", "tab", "option",
  "heading", "article", "main", "navigation", "banner", "contentinfo",
  "alert", "dialog", "img", "listitem", "treeitem",
  "text", "StaticText", "LabelText",
]);

function filterTree(node: any, result: AccessibilityNode[], count: { total: number }): boolean {
  if (!node) return false;
  count.total++;

  const role = node.role || "unknown";
  const name = (node.name || "").trim();
  const description = (node.description || "").trim();
  const value = node.value || undefined;

  const isInteresting =
    INTERESTING_ROLES.has(role) || name.length > 0 || description.length > 0;

  if (!isInteresting && (!node.children || node.children.length === 0)) {
    return false;
  }

  const filtered: AccessibilityNode = {
    role,
    name: name.slice(0, 200),
    description: description.slice(0, 300) || undefined,
    value: value ? String(value).slice(0, 200) : undefined,
  };

  if (node.children?.length) {
    const children: AccessibilityNode[] = [];
    for (const child of node.children) {
      const added = filterTree(child, children, count);
      if (added && children.length <= 50) {
        // keep going
      }
    }
    if (children.length > 0) filtered.children = children;
  }

  if (isInteresting || (filtered.children && filtered.children.length > 0)) {
    if (result.length < 120) {
      result.push(filtered);
    }
    return true;
  }

  return false;
}

// ── BrowserManager Singleton ──────────────────────────────

export class BrowserManager {
  private static instance: BrowserManager;

  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private config: BrowserConfig = {};

  static getInstance(): BrowserManager {
    if (!BrowserManager.instance) {
      BrowserManager.instance = new BrowserManager();
    }
    return BrowserManager.instance;
  }

  // ── Launch ─────────────────────────────────────────────

  async launch(config?: BrowserConfig): Promise<void> {
    if (this.browser?.isConnected()) return;

    this.config = config ?? {};

    const executablePath = config?.executablePath ?? detectBravePath();
    const viewportWidth = config?.viewportWidth ?? 1280;
    const viewportHeight = config?.viewportHeight ?? 900;

    if (!executablePath) {
      console.warn("[browser-agent] Brave not found — falling back to Playwright's bundled Chromium");
    }

    this.browser = await chromium.launch({
      headless: false,
      executablePath: executablePath ?? undefined,
      args: [
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-features=Translate",
      ],
    });

    this.context = await this.browser.newContext({
      viewport: { width: viewportWidth, height: viewportHeight },
      // Ephemeral by default — nothing persisted
    });

    this.page = await this.context.newPage();

    // Handle user closing the window manually
    this.page.on("close", () => {
      this.page = null;
    });
  }

  // ── Page State ─────────────────────────────────────────

  async getState(): Promise<PageState> {
    const page = this.ensurePage();

    const [screenshotBuf, a11ySnapshot, url, title] = await Promise.all([
      page.screenshot({ type: "jpeg", quality: 65, timeout: 5000 }),
      page.accessibility.snapshot(),
      page.url(),
      page.title(),
    ]);

    const elements: AccessibilityNode[] = [];
    const count = { total: 0 };
    if (a11ySnapshot) {
      filterTree(a11ySnapshot, elements, count);
    }

    return {
      url,
      title,
      screenshotBase64: screenshotBuf.toString("base64"),
      elements,
      totalElements: count.total,
    };
  }

  // ── Screenshot Only ────────────────────────────────────

  async getScreenshotBase64(): Promise<string> {
    const page = this.ensurePage();
    const buf = await page.screenshot({ type: "jpeg", quality: 65, timeout: 5000 });
    return buf.toString("base64");
  }

  // ── Page Access ────────────────────────────────────────

  getPage(): Page {
    return this.ensurePage();
  }

  isLaunched(): boolean {
    return this.browser?.isConnected() === true && this.page !== null && !this.page.isClosed();
  }

  // ── Close ──────────────────────────────────────────────

  async close(): Promise<void> {
    try {
      await this.context?.close();
    } catch { /* ignore */ }
    try {
      await this.browser?.close();
    } catch { /* ignore */ }

    this.page = null;
    this.context = null;
    this.browser = null;
  }

  // ── Internals ──────────────────────────────────────────

  private ensurePage(): Page {
    if (!this.isLaunched()) {
      throw new Error(
        "Browser not launched or was closed. Call browser_launch first."
      );
    }
    return this.page!;
  }
}
