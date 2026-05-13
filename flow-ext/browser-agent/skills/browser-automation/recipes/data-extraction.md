# Data Extraction Recipe

> Load this file when the user asks to scrape or extract data from a website.

## Standard Extraction Pattern

### Step 1: Navigate to the source page
```
browser_navigate({ url: "<page-url>" })
browser_wait({ ms: 2000 })
```

### Step 2: Inspect the page
```
browser_get_state()
```
Identify where the target data lives:
- Is it visible immediately? → Extract now
- Is it below the fold? → Scroll + extract
- Is it on multiple pages? → Paginate + extract each

### Step 3: Extract the data
Use `browser_get_state` — the accessibility tree contains the text content. Look at:
- Headings (`[heading]` nodes)
- Lists (`[list]` / `[listitem]` nodes)
- Articles (`[article]` nodes)
- Tables (rows of cells)
- Text blocks (`[StaticText]` nodes)

### Step 4: Scroll for more content
```
browser_scroll({ direction: "page_down" })
browser_wait({ ms: 1000 })
browser_get_state()
```
Check if new content loaded. Repeat until you have enough data or the page stops loading.

### Step 5: Paginate (if multi-page)
```
# Find the "Next" button/link
browser_get_state()
browser_click({ target: "Next" })
browser_wait({ ms: 2000 })
browser_get_state()  ← extract next page
```

### Step 6: Report findings
Summarize the extracted data clearly. Include:
- Source URL
- How many items/pages processed
- The actual data structured (list, table, or key-value)

## Extraction by Data Type

### Product Prices
- Look for `[StaticText]` near currency symbols ($, €, £)
- Or search accessibility tree for price-related labels
- Example: `browser_get_state` → look for `"$19.99"` or `[heading] "Premium Plan"` + nearby text

### Search Results
```
browser_navigate({ url: "https://example.com/search?q=<query>" })
browser_wait({ ms: 2000 })
browser_get_state()
```
Look for `[link]` nodes in the main content area — these are typically result titles.

### Lists / Tables
- `browser_get_state` → scan `[list]` and `[listitem]` nodes
- For tables, look for repeating `[cell]` or `[row]` patterns

### Article Text
- Navigate to article URL
- `browser_get_state` → scan `[heading]` for title, `[article]` or `[main]` for body
- Scroll to load full content if truncated

## Infinite Scroll Pages

```
Loop:
  browser_scroll({ direction: "to_bottom" })
  browser_wait({ ms: 2000 })
  browser_get_state()
  → Extract new items
  → If no new items after 3 scrolls → done
```

## Troubleshooting

| Problem | Solution |
|---------|----------|
| Content is in an image | `browser_get_state` shows the screenshot — describe what you see visually |
| JavaScript-rendered content | `browser_wait({ ms: 3000 })` before extraction — give JS time to run |
| "Load more" button | `browser_click` on it instead of scrolling |
| Paywall / login wall | Call `browser_ask_user` — the agent cannot bypass paywalls |
| Anti-bot protection | Call `browser_ask_user` — the site may have detected automation |
| Data in a PDF | Use `browser_navigate` to the PDF URL — Chromium renders PDFs inline |
