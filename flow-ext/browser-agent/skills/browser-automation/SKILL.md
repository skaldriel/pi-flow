---
name: browser-automation
description: Multi-step browser automation using atomic browser tools. Use when asked to browse websites, log in, fill forms, scrape data, or execute web workflows. The agent controls a real Brave/Chromium window that the user can watch.
---

# Browser Automation

> **DISPATCHER — Do NOT load all reference files at once.**
> Read the routing table below and load ONLY the recipe relevant to the current task.

## Routing Table

| Task | Load |
|------|------|
| bup tickets on checkout | `recipes/checkout/buy-tickets` |
| Log into any website (GitHub, Twitter, etc.) | `recipes/login.md` |
| Fill a multi-field form | `recipes/form-fill.md` |
| Extract / scrape data from pages | `recipes/data-extraction.md` |

## Available Tools

| Tool | Purpose |
|------|---------|
| `browser_launch` | Start the browser (only tool visible at first) |
| `browser_navigate` | Go to a URL |
| `browser_get_state` | **Your eyes.** Screenshot + accessibility tree + URL |
| `browser_screenshot` | Screenshot only (faster) |
| `browser_click` | Click an element by text/label/selector |
| `browser_type` | Type into an input field |
| `browser_scroll` | Scroll up/down/page/top/bottom |
| `browser_press` | Press a key (Enter, Tab, Escape...) |
| `browser_hover` | Hover over an element |
| `browser_select` | Select an option from a dropdown |
| `browser_wait` | Wait ms or for network idle |
| `browser_back` / `forward` / `refresh` | History navigation |
| `browser_close` | Close the browser when done |
| `browser_ask_user` | Interactive help dialog when stuck |

## Core Principles

### 1. The Observe → Act → Verify Cycle

```
browser_get_state  →  SEE what's on the page
browser_click      →  ACT on what you see
browser_get_state  →  VERIFY the result
```

**Never skip verification.** After navigation, clicks, or form submissions, always call `browser_get_state` to confirm the page changed as expected.

### 2. Element Targeting

When calling `browser_click`, `browser_type`, etc., target elements using what you see in `browser_get_state`:

- **Best:** Exact visible text from the accessibility tree → e.g. `"Sign in"`
- **Good:** Aria label or placeholder → e.g. `"Username or email address"`
- **Fallback:** CSS selector → e.g. `"#login_field"`

Do NOT guess selectors. Use `browser_get_state` to find the correct target.

### 3. Wait for Pages to Load

After `browser_navigate`, always `browser_wait({ ms: 2000 })` before interacting.
After form submission, `browser_wait({ ms: 0 })` to wait for network idle.

### 4. When You're Stuck

If you try 3 times to find/click an element with different approaches and fail → call `browser_ask_user`. The user sees the page screenshot and can help.

## Red Flags

- ❌ Calling browser tools without `browser_launch` first
- ❌ Guessing CSS selectors instead of using `browser_get_state`
- ❌ Skipping `browser_wait` after navigation
- ❌ Retrying the same failed click/type more than 3 times without asking for help
- ❌ Leaving the browser open after completing the task
