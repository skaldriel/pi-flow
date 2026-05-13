import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { Type } from "typebox";
import { StringEnum } from "@mariozechner/pi-ai";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

import { BrowserManager } from "./browser-manager";
import { ActionExecutor } from "./executor";
import type {
  BrowserConfig,
  ActionRecord,
  StuckAction,
  ScrollDirection,
} from "./types";

// ─── Constants ────────────────────────────────────────────

const BROWSER_LAUNCH_TOOL = "browser_launch";
const BROWSER_CLOSE_TOOL = "browser_close";

const ALL_BROWSER_TOOLS = [
  BROWSER_LAUNCH_TOOL,
  "browser_navigate",
  "browser_get_state",
  "browser_screenshot",
  "browser_click",
  "browser_type",
  "browser_scroll",
  "browser_press",
  "browser_hover",
  "browser_select",
  "browser_wait",
  "browser_back",
  "browser_forward",
  "browser_refresh",
  BROWSER_CLOSE_TOOL,
  "browser_ask_user",
];

const ACTION_TOOLS = new Set([
  "browser_navigate", "browser_click", "browser_type",
  "browser_scroll", "browser_press", "browser_hover",
  "browser_select", "browser_back", "browser_forward", "browser_refresh",
]);

// ─── Shared State ─────────────────────────────────────────

const browser = BrowserManager.getInstance();
const recentActions: ActionRecord[] = [];
let activeConfig: BrowserConfig = {};

function getExecutor(ctx: ExtensionContext): ActionExecutor {
  return new ActionExecutor(browser.getPage());
}

function recordAction(type: string, description: string, success: boolean): void {
  recentActions.push({ type, description, status: success ? "success" : "error" });
  if (recentActions.length > 20) recentActions.shift();
}

// ─── Entry Point ──────────────────────────────────────────

export default function (pi: ExtensionAPI) {
  // ═══════════════════════════════════════════════════════
  // 1. browser_launch
  // ═══════════════════════════════════════════════════════

  pi.registerTool({
    name: BROWSER_LAUNCH_TOOL,
    label: "Browser Launch",
    description:
      "Launch a Brave/Chromium browser window (headed, ephemeral profile). " +
      "Must be called before any other browser tool.",
    promptSnippet: "Launch browser window (headed, ephemeral)",
    parameters: Type.Object({
      executablePath: Type.Optional(
        Type.String({ description: "Override path to Brave/Chromium executable" })
      ),
      viewportWidth: Type.Optional(
        Type.Number({ description: "Viewport width in pixels (default 1280)" })
      ),
      viewportHeight: Type.Optional(
        Type.Number({ description: "Viewport height in pixels (default 900)" })
      ),
    }),
    async execute(_id, params, _signal, onUpdate, ctx) {
      if (browser.isLaunched()) {
        return {
          content: [{ type: "text", text: "Browser already launched and running." }],
          details: {},
        };
      }

      onUpdate?.({ content: [{ type: "text", text: "Launching browser..." }] });

      const config: BrowserConfig = {
        executablePath: params.executablePath,
        viewportWidth: params.viewportWidth ?? 1280,
        viewportHeight: params.viewportHeight ?? 900,
      };
      activeConfig = config;

      try {
        await browser.launch(config);
      } catch (err: any) {
        return {
          content: [{
            type: "text",
            text: `Failed to launch browser: ${err.message}\n\n` +
              "Make sure Brave or Chromium is installed.\n" +
              "Linux: sudo apt install brave-browser\n" +
              "macOS: brew install --cask brave-browser\n" +
              "Or install Chromium: npx playwright install chromium",
          }],
          details: {},
        };
      }

      // Activate all browser tools
      const current = new Set(pi.getActiveTools());
      ALL_BROWSER_TOOLS.forEach(t => current.add(t));
      pi.setActiveTools([...current]);

      recentActions.length = 0;

      return {
        content: [{
          type: "text",
          text: "✅ Browser launched successfully in headed mode.\n" +
            "All browser tools are now active. The window is visible — " +
            "you can watch what the agent does.\n" +
            "Profile is ephemeral (no cookies, no history).",
        }],
        details: {},
      };
    },
  });

  // ═══════════════════════════════════════════════════════
  // 2. browser_navigate
  // ═══════════════════════════════════════════════════════

  pi.registerTool({
    name: "browser_navigate",
    label: "Browser Navigate",
    description:
      "Navigate the browser to a URL. Use full URLs (https://...) or relative paths. " +
      "Always wait for the page to load before interacting.",
    promptSnippet: "Navigate browser to URL",
    parameters: Type.Object({
      url: Type.String({ description: "URL to navigate to (https://... or relative)" }),
    }),
    async execute(_id, params, signal, onUpdate, ctx) {
      if (!browser.isLaunched()) {
        return {
          content: [{ type: "text", text: "Browser not launched. Call browser_launch first." }],
          details: {},
        };
      }

      onUpdate?.({ content: [{ type: "text", text: `Navigating to ${params.url}...` }] });

      const exec = getExecutor(ctx);
      const result = await exec.navigate(params.url);
      recordAction("navigate", `→ ${params.url}`, result.success);

      return {
        content: [{ type: "text", text: result.success ? result.description : `❌ ${result.error}` }],
        details: { url: params.url, success: result.success },
      };
    },
  });

  // ═══════════════════════════════════════════════════════
  // 3. browser_get_state
  // ═══════════════════════════════════════════════════════

  pi.registerTool({
    name: "browser_get_state",
    label: "Browser Get State",
    description:
      "Capture the current page state: accessibility tree, URL, and title. " +
      "Optionally include a screenshot (JPEG). " +
      "Call this after navigation and after any action that might change the page. " +
      "This is your primary way to SEE what's on the page.",
    promptSnippet: "Get page state (accessibility tree, optional screenshot)",
    promptGuidelines: [
      "After browser_navigate, browser_click, or form submission, call browser_get_state to verify the result",
      "Never assume an action succeeded — always verify with browser_get_state",
      "Use includeScreenshot: true when you need visual context (layout, CAPTCHA, images). Default false for speed.",
    ],
    parameters: Type.Object({
      includeScreenshot: Type.Optional(
        Type.Boolean({
          description:
            "Whether to include a JPEG screenshot. Default: true. " +
            "Set to false for faster responses when the a11y tree is sufficient.",
          default: true,
        })
      ),
    }),
    async execute(_id, params, signal, onUpdate, ctx) {
      if (!browser.isLaunched()) {
        return {
          content: [{ type: "text", text: "Browser not launched. Call browser_launch first." }],
          details: {},
        };
      }

      const wantScreenshot = params.includeScreenshot !== false; // default true
      const label = wantScreenshot ? "Capturing page state (with screenshot)..." : "Capturing page state...";
      onUpdate?.({ content: [{ type: "text", text: label }] });

      try {
        const page = browser.getPage();

        // Accessibility snapshot — may fail if page isn't ready or doesn't expose a11y
        let a11ySnapshot: any = null;
        try {
          a11ySnapshot = await page.accessibility.snapshot();
        } catch {
          // Fallback: extract text content directly from DOM
          try {
            const textDump = await page.evaluate(() => {
              const walker = document.createTreeWalker(
                document.body,
                NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT,
                {
                  acceptNode: (node) => {
                    if (node.nodeType === Node.TEXT_NODE && node.textContent?.trim()) {
                      return NodeFilter.FILTER_ACCEPT;
                    }
                    const el = node as Element;
                    if (el.tagName && ["BUTTON", "A", "INPUT", "SELECT", "TEXTAREA", "H1", "H2", "H3", "H4", "H5", "H6", "LABEL", "OPTION"].includes(el.tagName)) {
                      return NodeFilter.FILTER_ACCEPT;
                    }
                    return NodeFilter.FILTER_SKIP;
                  },
                }
              );
              const parts: string[] = [];
              let n: Node | null;
              while ((n = walker.nextNode())) {
                if (n.nodeType === Node.TEXT_NODE) {
                  parts.push(n.textContent?.trim() || "");
                } else {
                  const el = n as Element;
                  const tag = el.tagName.toLowerCase();
                  const text = (el.textContent || "").trim().slice(0, 100);
                  const name = el.getAttribute("name") || el.getAttribute("aria-label") || el.getAttribute("placeholder") || "";
                  const id = el.id ? `#${el.id}` : "";
                  parts.push(`[${tag}${id}] ${name || text}`);
                }
              }
              return parts.join("\n");
            });
            a11ySnapshot = { role: "dom-fallback", name: textDump, children: [] };
          } catch {
            a11ySnapshot = null;
          }
        }

        const [url, title] = await Promise.all([
          page.url(),
          page.title(),
        ]);

        // Format accessibility tree as compact text
        const count = { total: 0 };
        const treeLines: string[] = [];
        function formatNode(node: any, indent: number) {
          const prefix = "  ".repeat(indent);
          let line = `${prefix}[${node.role}]`;
          if (node.name) line += ` "${node.name}"`;
          if (node.description) line += ` — ${node.description}`;
          if (node.value) line += ` = "${node.value}"`;
          treeLines.push(line);
          if (node.children) {
            for (const child of node.children) formatNode(child, indent + 1);
          }
        }

        if (a11ySnapshot) {
          // Filter and format
          const INTERESTING_ROLES = new Set([
            "button", "link", "textbox", "searchbox", "combobox", "listbox",
            "menuitem", "checkbox", "radio", "switch", "tab", "option",
            "heading", "article", "main", "navigation", "banner", "contentinfo",
            "alert", "dialog", "img", "listitem", "treeitem",
            "text", "StaticText", "LabelText",
          ]);

          function filterAndFormat(node: any, indent: number): boolean {
            if (!node) return false;
            count.total++;

            const role = node.role || "unknown";
            const name = (node.name || "").trim();
            const description = (node.description || "").trim();

            const isInteresting = INTERESTING_ROLES.has(role) || name.length > 0 || description.length > 0;

            if (isInteresting) {
              formatNode(node, indent);
              if (node.children) {
                for (const child of node.children) filterAndFormat(child, indent + 1);
              }
              return true;
            }

            if (node.children) {
              let addedAny = false;
              for (const child of node.children) {
                if (filterAndFormat(child, indent)) addedAny = true;
              }
              if (addedAny && isInteresting) {
                formatNode(node, indent);
              }
              return addedAny;
            }

            return false;
          }

          filterAndFormat(a11ySnapshot, 0);
        }

        const textSummary =
          `URL: ${url}\n` +
          `Title: ${title}\n` +
          `Elements in tree: ${count.total}\n\n` +
          `── Accessibility Tree ──\n${treeLines.join("\n")}`;

        const contentBlocks: any[] = [];

        if (wantScreenshot) {
          const screenshotBuf = await page.screenshot({ type: "jpeg", quality: 65, timeout: 5000 });
          contentBlocks.push({
            type: "image",
            source: { type: "base64", mediaType: "image/jpeg", data: screenshotBuf.toString("base64") },
          });
        }

        contentBlocks.push({ type: "text", text: textSummary });

        return {
          content: contentBlocks,
          details: {
            url,
            title,
            elementCount: count.total,
            hadScreenshot: wantScreenshot,
          },
        };
      } catch (err: any) {
        return {
          content: [{ type: "text", text: `❌ Failed to get page state: ${err.message}` }],
          details: {},
        };
      }
    },
  });

  // ═══════════════════════════════════════════════════════
  // 4. browser_screenshot
  // ═══════════════════════════════════════════════════════

  pi.registerTool({
    name: "browser_screenshot",
    label: "Browser Screenshot",
    description:
      "Take a screenshot of the current page only (no accessibility tree). " +
      "Faster than browser_get_state when you just need to see the page visually.",
    promptSnippet: "Take a screenshot of the current page",
    parameters: Type.Object({}),
    async execute(_id, _params, _signal, onUpdate, ctx) {
      if (!browser.isLaunched()) {
        return {
          content: [{ type: "text", text: "Browser not launched. Call browser_launch first." }],
          details: {},
        };
      }

      onUpdate?.({ content: [{ type: "text", text: "Taking screenshot..." }] });

      try {
        const b64 = await browser.getScreenshotBase64();
        return {
          content: [
            {
              type: "image",
              source: { type: "base64", mediaType: "image/jpeg", data: b64 },
            },
            { type: "text", text: `Screenshot captured. URL: ${browser.getPage().url()}` },
          ],
          details: {},
        };
      } catch (err: any) {
        return {
          content: [{ type: "text", text: `❌ Screenshot failed: ${err.message}` }],
          details: {},
        };
      }
    },
  });

  // ═══════════════════════════════════════════════════════
  // 5. browser_click
  // ═══════════════════════════════════════════════════════

  pi.registerTool({
    name: "browser_click",
    label: "Browser Click",
    description:
      "Click an element on the page. Target by: visible text, aria-label, placeholder, " +
      "CSS selector, or role name. Use browser_get_state first to identify the correct target.",
    promptSnippet: "Click element (by text, aria-label, or selector)",
    parameters: Type.Object({
      target: Type.String({
        description:
          "Element to click. Can be visible text, aria-label, placeholder text, " +
          "CSS selector, or button/link name. Be specific.",
      }),
    }),
    async execute(_id, params, _signal, onUpdate, ctx) {
      if (!browser.isLaunched()) {
        return {
          content: [{ type: "text", text: "Browser not launched. Call browser_launch first." }],
          details: {},
        };
      }

      onUpdate?.({ content: [{ type: "text", text: `Clicking "${params.target}"...` }] });

      const exec = getExecutor(ctx);
      const result = await exec.click(params.target);
      recordAction("click", `"${params.target}"`, result.success);

      return {
        content: [{ type: "text", text: result.success ? result.description : `❌ ${result.error}` }],
        details: { target: params.target, success: result.success },
      };
    },
  });

  // ═══════════════════════════════════════════════════════
  // 6. browser_type
  // ═══════════════════════════════════════════════════════

  pi.registerTool({
    name: "browser_type",
    label: "Browser Type",
    description:
      "Type text into an input field. Target the field by its label text, placeholder, or aria-label. " +
      "Use browser_get_state first to identify the correct field.",
    promptSnippet: "Type text into input field",
    parameters: Type.Object({
      target: Type.String({
        description:
          "Input field to type into. Use the field's label text, placeholder, aria-label, or CSS selector.",
      }),
      text: Type.String({ description: "Text to type into the field" }),
    }),
    async execute(_id, params, _signal, onUpdate, ctx) {
      if (!browser.isLaunched()) {
        return {
          content: [{ type: "text", text: "Browser not launched. Call browser_launch first." }],
          details: {},
        };
      }

      onUpdate?.({ content: [{ type: "text", text: `Typing into "${params.target}"...` }] });

      const exec = getExecutor(ctx);
      const result = await exec.type(params.target, params.text);
      recordAction("type", `"${params.target}" ← ${params.text.length} chars`, result.success);

      return {
        content: [{ type: "text", text: result.success ? result.description : `❌ ${result.error}` }],
        details: { target: params.target, success: result.success },
      };
    },
  });

  // ═══════════════════════════════════════════════════════
  // 7. browser_scroll
  // ═══════════════════════════════════════════════════════

  const scrollValues = ["up", "down", "page_up", "page_down", "to_top", "to_bottom"] as const;

  pi.registerTool({
    name: "browser_scroll",
    label: "Browser Scroll",
    description:
      "Scroll the page. Use to reveal content below the fold. " +
      "After scrolling, call browser_get_state to see newly visible elements.",
    promptSnippet: "Scroll page (up/down/page/top/bottom)",
    parameters: Type.Object({
      direction: StringEnum(scrollValues, {
        description:
          "Scroll direction: up (300px), down (300px), page_up (viewport), " +
          "page_down (viewport), to_top, to_bottom",
      }),
    }),
    async execute(_id, params, _signal, onUpdate, ctx) {
      if (!browser.isLaunched()) {
        return {
          content: [{ type: "text", text: "Browser not launched. Call browser_launch first." }],
          details: {},
        };
      }

      onUpdate?.({ content: [{ type: "text", text: `Scrolling ${params.direction}...` }] });

      const exec = getExecutor(ctx);
      const result = await exec.scroll(params.direction as ScrollDirection);
      recordAction("scroll", params.direction, result.success);

      return {
        content: [{ type: "text", text: result.success ? result.description : `❌ ${result.error}` }],
        details: { direction: params.direction, success: result.success },
      };
    },
  });

  // ═══════════════════════════════════════════════════════
  // 8. browser_press
  // ═══════════════════════════════════════════════════════

  pi.registerTool({
    name: "browser_press",
    label: "Browser Press Key",
    description:
      "Press a keyboard key. Common keys: Enter, Tab, Escape, ArrowDown, ArrowUp, " +
      "PageDown, PageUp, Backspace, Delete.",
    promptSnippet: "Press keyboard key (Enter, Tab, ArrowDown, etc.)",
    parameters: Type.Object({
      key: Type.String({
        description: "Key to press (Enter, Tab, Escape, ArrowDown, ArrowUp, Backspace, etc.)",
      }),
    }),
    async execute(_id, params, _signal, onUpdate, ctx) {
      if (!browser.isLaunched()) {
        return {
          content: [{ type: "text", text: "Browser not launched. Call browser_launch first." }],
          details: {},
        };
      }

      onUpdate?.({ content: [{ type: "text", text: `Pressing "${params.key}"...` }] });

      const exec = getExecutor(ctx);
      const result = await exec.press(params.key);
      recordAction("press", params.key, result.success);

      return {
        content: [{ type: "text", text: result.success ? result.description : `❌ ${result.error}` }],
        details: { key: params.key, success: result.success },
      };
    },
  });

  // ═══════════════════════════════════════════════════════
  // 9. browser_hover
  // ═══════════════════════════════════════════════════════

  pi.registerTool({
    name: "browser_hover",
    label: "Browser Hover",
    description:
      "Hover the mouse over an element. Useful for revealing tooltips, dropdown menus, " +
      "or hover-only UI elements.",
    promptSnippet: "Hover over element",
    parameters: Type.Object({
      target: Type.String({
        description: "Element to hover over (text, aria-label, or selector)",
      }),
    }),
    async execute(_id, params, _signal, onUpdate, ctx) {
      if (!browser.isLaunched()) {
        return {
          content: [{ type: "text", text: "Browser not launched. Call browser_launch first." }],
          details: {},
        };
      }

      onUpdate?.({ content: [{ type: "text", text: `Hovering "${params.target}"...` }] });

      const exec = getExecutor(ctx);
      const result = await exec.hover(params.target);
      recordAction("hover", `"${params.target}"`, result.success);

      return {
        content: [{ type: "text", text: result.success ? result.description : `❌ ${result.error}` }],
        details: { target: params.target, success: result.success },
      };
    },
  });

  // ═══════════════════════════════════════════════════════
  // 10. browser_select
  // ═══════════════════════════════════════════════════════

  pi.registerTool({
    name: "browser_select",
    label: "Browser Select Option",
    description:
      "Select an option from a <select> dropdown. Target the select element by label text or selector, " +
      "then specify the option value or visible text.",
    promptSnippet: "Select option from dropdown",
    parameters: Type.Object({
      target: Type.String({
        description: "The <select> element (label text, aria-label, or CSS selector)",
      }),
      value: Type.String({
        description: "Option to select (visible text or value attribute)",
      }),
    }),
    async execute(_id, params, _signal, onUpdate, ctx) {
      if (!browser.isLaunched()) {
        return {
          content: [{ type: "text", text: "Browser not launched. Call browser_launch first." }],
          details: {},
        };
      }

      onUpdate?.({ content: [{ type: "text", text: `Selecting "${params.value}" in "${params.target}"...` }] });

      const exec = getExecutor(ctx);
      const result = await exec.select(params.target, params.value);
      recordAction("select", `"${params.target}" → "${params.value}"`, result.success);

      return {
        content: [{ type: "text", text: result.success ? result.description : `❌ ${result.error}` }],
        details: { target: params.target, value: params.value, success: result.success },
      };
    },
  });

  // ═══════════════════════════════════════════════════════
  // 11. browser_wait
  // ═══════════════════════════════════════════════════════

  pi.registerTool({
    name: "browser_wait",
    label: "Browser Wait",
    description:
      "Wait for a specified time or for the network to become idle. " +
      "Use after navigation, form submission, or any action that triggers page changes.",
    promptSnippet: "Wait (ms or network idle)",
    parameters: Type.Object({
      ms: Type.Number({
        description:
          "Milliseconds to wait. Use 0 to wait for network idle (all requests complete). " +
          "Typical values: 1000-3000ms after navigation, 500-1000ms after typing.",
        default: 1000,
      }),
    }),
    async execute(_id, params, _signal, onUpdate, ctx) {
      if (!browser.isLaunched()) {
        return {
          content: [{ type: "text", text: "Browser not launched. Call browser_launch first." }],
          details: {},
        };
      }

      const label = params.ms === 0 ? "network idle" : `${params.ms}ms`;
      onUpdate?.({ content: [{ type: "text", text: `Waiting ${label}...` }] });

      const exec = getExecutor(ctx);
      const result = await exec.wait(params.ms);
      recordAction("wait", label, result.success);

      return {
        content: [{ type: "text", text: result.success ? result.description : `❌ ${result.error}` }],
        details: { ms: params.ms, success: result.success },
      };
    },
  });

  // ═══════════════════════════════════════════════════════
  // 12. browser_back / browser_forward / browser_refresh
  // ═══════════════════════════════════════════════════════

  pi.registerTool({
    name: "browser_back",
    label: "Browser Back",
    description: "Go back to the previous page in browser history.",
    promptSnippet: "Go back in browser history",
    parameters: Type.Object({}),
    async execute(_id, _params, _signal, onUpdate, ctx) {
      if (!browser.isLaunched()) {
        return {
          content: [{ type: "text", text: "Browser not launched. Call browser_launch first." }],
          details: {},
        };
      }
      onUpdate?.({ content: [{ type: "text", text: "Going back..." }] });
      const exec = getExecutor(ctx);
      const result = await exec.back();
      recordAction("back", "", result.success);
      return {
        content: [{ type: "text", text: result.success ? result.description : `❌ ${result.error}` }],
        details: { success: result.success },
      };
    },
  });

  pi.registerTool({
    name: "browser_forward",
    label: "Browser Forward",
    description: "Go forward to the next page in browser history.",
    promptSnippet: "Go forward in browser history",
    parameters: Type.Object({}),
    async execute(_id, _params, _signal, onUpdate, ctx) {
      if (!browser.isLaunched()) {
        return {
          content: [{ type: "text", text: "Browser not launched. Call browser_launch first." }],
          details: {},
        };
      }
      onUpdate?.({ content: [{ type: "text", text: "Going forward..." }] });
      const exec = getExecutor(ctx);
      const result = await exec.forward();
      recordAction("forward", "", result.success);
      return {
        content: [{ type: "text", text: result.success ? result.description : `❌ ${result.error}` }],
        details: { success: result.success },
      };
    },
  });

  pi.registerTool({
    name: "browser_refresh",
    label: "Browser Refresh",
    description: "Refresh/reload the current page.",
    promptSnippet: "Refresh current page",
    parameters: Type.Object({}),
    async execute(_id, _params, _signal, onUpdate, ctx) {
      if (!browser.isLaunched()) {
        return {
          content: [{ type: "text", text: "Browser not launched. Call browser_launch first." }],
          details: {},
        };
      }
      onUpdate?.({ content: [{ type: "text", text: "Refreshing..." }] });
      const exec = getExecutor(ctx);
      const result = await exec.refresh();
      recordAction("refresh", "", result.success);
      return {
        content: [{ type: "text", text: result.success ? result.description : `❌ ${result.error}` }],
        details: { success: result.success },
      };
    },
  });

  // ═══════════════════════════════════════════════════════
  // 13. browser_close
  // ═══════════════════════════════════════════════════════

  pi.registerTool({
    name: BROWSER_CLOSE_TOOL,
    label: "Browser Close",
    description:
      "Close the browser window and clean up the ephemeral profile. " +
      "Disables all browser tools except browser_launch.",
    promptSnippet: "Close browser window",
    parameters: Type.Object({}),
    async execute(_id, _params, _signal, _onUpdate, _ctx) {
      await browser.close();
      recentActions.length = 0;

      // Disable all browser tools except launch
      pi.setActiveTools(
        pi.getActiveTools().filter(t => !ALL_BROWSER_TOOLS.includes(t) || t === BROWSER_LAUNCH_TOOL)
      );

      return {
        content: [{
          type: "text",
          text: "✅ Browser closed. Ephemeral profile deleted. All browser tools disabled.",
        }],
        details: {},
      };
    },
  });

  // ═══════════════════════════════════════════════════════
  // 14. browser_ask_user (using built-in dialogs for reliability)
  // ═══════════════════════════════════════════════════════

  pi.registerTool({
    name: "browser_ask_user",
    label: "Browser Ask User",
    description:
      "ASK THE HUMAN FOR HELP when you're stuck. Shows a dialog with options. Use when:\n" +
      "- You can't find an element after multiple attempts\n" +
      "- The page is showing something unexpected (captcha, error, popup)\n" +
      "- You need credentials or a decision the user must make\n" +
      "- You've tried 3+ different approaches and nothing worked",
    promptSnippet: "Ask human for help (dialog with options)",
    promptGuidelines: [
      "If you can't find an element after 3 attempts with different selectors, call browser_ask_user — don't keep retrying",
      "If the page shows a CAPTCHA, login wall, or unexpected error, call browser_ask_user immediately",
      "When asking, explain exactly what you were trying to do and what went wrong",
    ],
    parameters: Type.Object({
      question: Type.String({
        description:
          "Clear description of what you were trying to do and why you're stuck. " +
          "Include: what you attempted, what went wrong, and what you need from the human.",
      }),
    }),
    async execute(_id, params, _signal, onUpdate, ctx) {
      if (!browser.isLaunched()) {
        return {
          content: [{ type: "text", text: "Browser not launched. Call browser_launch first." }],
          details: {},
        };
      }

      onUpdate?.({ content: [{ type: "text", text: "Asking user for help..." }] });

      // Show recent actions as a transient notification (avoids multi-line title bug)
      if (recentActions.length > 0) {
        const recentStr = recentActions.slice(-4).map(a => {
          const icon = a.status === "success" ? "✓" : "✗";
          return `${icon} ${a.type}: ${a.description}`;
        }).join("\n");
        ctx.ui.notify(`── Recent Actions ──\n${recentStr}`, "info");
      }

      // Short title = no rendering overlap
      const choice = await ctx.ui.select(
        params.question,
        [
          "🔄 Retry with different approach",
          "📋 Give me manual instructions",
          "🖐  Take over — let me drive the browser",
          "⏭  Skip this step",
          "✕  Abort browser session",
        ]
      );

      if (!choice) {
        return {
          content: [{ type: "text", text: "User cancelled the help dialog." }],
          details: { userAction: "cancelled" },
        };
      }

      // Resolve choice to action
      let action: StuckAction;
      if (choice.includes("Retry")) action = "retry";
      else if (choice.includes("manual")) action = "manual";
      else if (choice.includes("Take over")) action = "takeover";
      else if (choice.includes("Skip")) action = "skip";
      else action = "abort";

      let userInstructions: string | undefined;

      // If manual or takeover, ask for instructions
      if (action === "manual" || action === "takeover") {
        const prompt = action === "manual"
          ? "What should the agent do? Describe the approach:"
          : "What should the agent know? Describe what you'll do or what to wait for:";

        userInstructions = await ctx.ui.input(prompt, "Click the 'Save' button, then type...");

        if (!userInstructions) {
          return {
            content: [{ type: "text", text: "User cancelled manual instructions." }],
            details: { userAction: "cancelled" },
          };
        }
      }

      let responseText = "";
      switch (action) {
        case "retry":
          responseText = "🔄 User chose: Retry with a different approach. Try an alternative strategy — different selector, scroll first, or wait for the page to settle.";
          break;
        case "manual":
          responseText = `📋 User instructions: ${userInstructions}\n\nFollow these instructions precisely.`;
          break;
        case "takeover":
          responseText = `🖐  User is taking over the browser. Instructions: ${userInstructions}\n\nWait for the user to finish their actions in the browser window, then call browser_get_state to see the result.`;
          break;
        case "skip":
          responseText = "⏭ User chose: Skip this step. Move on to the next action in the workflow.";
          break;
        case "abort":
          responseText = "✕ User chose: Abort. Call browser_close to shut down the browser.";
          break;
      }

      return {
        content: [{ type: "text", text: responseText }],
        details: { userAction: action, userInstructions },
      };
    },
  });

  // ═══════════════════════════════════════════════════════
  // Circuit Breaker — before_agent_start
  // ═══════════════════════════════════════════════════════

  let browserCallCount = 0;

  pi.on("before_agent_start", async (event, _ctx) => {
    browserCallCount = 0;
    const maxCalls = activeConfig.maxToolCalls ?? 12;

    return {
      systemPrompt:
        event.systemPrompt +
        "\n\n## BROWSER AUTOMATION RULES\n" +
        "When using browser tools, follow these rules strictly:\n\n" +
        "1. **Always verify.** After navigate, click, or form submit, call browser_get_state.\n" +
        "2. **One action at a time.** Don't chain multiple clicks/types without verification.\n" +
        "3. **Stop condition.** After " + maxCalls + " browser tool calls total, stop and summarize findings.\n" +
        "4. **Stuck? Ask.** If you can't find an element after 3 attempts → browser_ask_user.\n" +
        "5. **Login forms.** Identify fields first (browser_get_state), then type, then click submit.\n" +
        "6. **Page loads.** Always browser_wait after navigation before interacting.\n" +
        "7. **Be specific.** Use exact text/aria-labels from browser_get_state, not guesses.\n" +
        "8. **Close when done.** Always call browser_close when the task is complete.\n",
    };
  });

  pi.on("turn_start", () => {
    browserCallCount = 0;
  });

  pi.on("tool_execution_start", async (event, ctx) => {
    if (event.toolName.startsWith("browser_") && event.toolName !== BROWSER_LAUNCH_TOOL) {
      browserCallCount++;
      const maxCalls = activeConfig.maxToolCalls ?? 12;
      if (browserCallCount >= maxCalls - 2) {
        ctx.ui.notify(
          `⚠ Browser tool calls: ${browserCallCount}/${maxCalls}. Wrap up soon.`,
          "warning"
        );
      }
      if (browserCallCount > maxCalls) {
        ctx.ui.notify(
          `Limit reached (${maxCalls} calls). Summarize findings now.`,
          "error"
        );
      }
    }
  });

  // ═══════════════════════════════════════════════════════
  // Lifecycle — session_shutdown
  // ═══════════════════════════════════════════════════════

  pi.on("session_shutdown", async () => {
    await browser.close();
    recentActions.length = 0;
  });

  // ═══════════════════════════════════════════════════════
  // Skill Discovery — resources_discover
  // ═══════════════════════════════════════════════════════

  pi.on("resources_discover", async (_event, _ctx) => {
    const skillPath = join(__dirname, "skills");
    return {
      skillPaths: [skillPath],
    };
  });

  // ═══════════════════════════════════════════════════════
  // Initial State — activate browser_launch on session start
  // ═══════════════════════════════════════════════════════

  pi.on("session_start", async (_event, _ctx) => {
    // Ensure browser_launch is active at the start of each session
    const current = new Set(pi.getActiveTools());
    if (!current.has(BROWSER_LAUNCH_TOOL)) {
      current.add(BROWSER_LAUNCH_TOOL);
      pi.setActiveTools([...current]);
    }
  });
}
