# Form Fill Recipe

> Load this file when the user asks to fill out a web form.

## Standard Form Fill Pattern

### Step 1: Navigate to the form
```
browser_navigate({ url: "<form-url>" })
browser_wait({ ms: 2000 })
```

### Step 2: Inspect all fields
```
browser_get_state()
```
Scan the accessibility tree for ALL textboxes, selects, checkboxes, and radio buttons. Map each field to the data the user provided.

### Step 3: Fill fields top-to-bottom

For **text fields:**
```
browser_type({ target: "<field-label>", text: "<value>" })
browser_wait({ ms: 300 })
```

For **dropdowns:**
```
browser_select({ target: "<field-label>", value: "<option-text>" })
browser_wait({ ms: 300 })
```

For **checkboxes:**
```
browser_click({ target: "<checkbox-label>" })
```

For **radio buttons:**
```
browser_click({ target: "<radio-option-label>" })
```

### Step 4: Scroll if needed
If some fields are below the fold:
```
browser_scroll({ direction: "page_down" })
browser_get_state()
```

### Step 5: Review before submit
```
browser_get_state()
```
Visually confirm all fields are filled correctly.

### Step 6: Submit
```
browser_click({ target: "<submit-button-text>" })
browser_wait({ ms: 3000 })
```

### Step 7: Verify submission
```
browser_get_state()
```
Look for success messages like "Thank you", "Submitted", or a redirect.

## Field Type Patterns

| Field Type | How to Fill |
|------------|-------------|
| Text input | `browser_type` with label text |
| Email input | `browser_type` — same as text |
| Password | `browser_type` — never echo the password value in your response |
| Textarea | `browser_type` — works for multi-line too |
| Select/Dropdown | `browser_select` with visible option text |
| Checkbox | `browser_click` on the checkbox label |
| Radio group | `browser_click` on the desired option label |
| Date picker | `browser_type` with date string, or `browser_click` to open picker |
| File upload | `browser_click` on the upload button (filechooser may block) |
| Autocomplete | `browser_type` then `browser_press({ key: "ArrowDown" })` then `browser_press({ key: "Enter" })` |

## Tab Navigation (Alternative to Label Targeting)

If label targeting fails, use Tab to reach the field:
```
browser_press({ key: "Tab" })     ← move to next field
browser_type({ target: "body", text: "" })  ← this won't work for Tab nav...

Better: click first field, then Tab through:
browser_click({ target: "<first-field>" })
browser_press({ key: "Tab" })
// Now focus is on the next field — but you need to type without a target
// Use a broad locator:
browser_type({ target: "input:focus", text: "<value>" })
```

## Troubleshooting

| Problem | Solution |
|---------|----------|
| Field not found | Scroll down — it may be below the fold |
| Field validation error | Check the error message in `browser_get_state` and correct the value |
| Dropdown has dynamic options | Type into the dropdown's search box instead of using `browser_select` |
| Form in an iframe | Complex — call `browser_ask_user` for help |
| Required field missed | Error message usually names the field — fill it and resubmit |
