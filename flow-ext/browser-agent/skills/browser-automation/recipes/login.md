# Login Recipe

> Load this file when the user asks to log into a website.

## Standard Login Pattern

### Step 1: Navigate
```
browser_navigate({ url: "https://example.com/login" })
```

### Step 2: Wait for page load
```
browser_wait({ ms: 2000 })
```

### Step 3: Inspect the login form
```
browser_get_state()
```
Look at the screenshot and accessibility tree. Identify:
- The **username/email field** — note its label or placeholder text
- The **password field** — note its label or placeholder text
- The **submit button** — note its visible text

### Step 4: Fill credentials
```
browser_type({ target: "<username-field-label>", text: "<username>" })
browser_type({ target: "<password-field-label>", text: "<password>" })
```

Always type username FIRST, then password. Use the exact label text from Step 3.

### Step 5: Submit
```
browser_click({ target: "<submit-button-text>" })
```

### Step 6: Wait for redirect
```
browser_wait({ ms: 3000 })
```

### Step 7: Verify login success
```
browser_get_state()
```
Check: Did the URL change? Is the username visible somewhere on the page? Is there a "Dashboard" or "Home" link?

## Common Patterns by Site

### GitHub
- Login URL: `https://github.com/login`
- Username field label: `"Username or email address"`
- Password field label: `"Password"`
- Submit button text: `"Sign in"`
- Success: URL becomes `https://github.com/`

### Twitter / X
- Login URL: `https://x.com/login`
- Username field: look for `"Phone, email, or username"`
- May require 2-step: username first → Next → password
- Success: URL becomes `https://x.com/home`

### Google
- Login URL: `https://accounts.google.com/`
- Username field: `"Email or phone"`
- May show account picker first — click `"Use another account"` if needed
- Password comes in a second step after entering email
- **WARNING:** Google often requires 2FA. If so, call `browser_ask_user`.

## Troubleshooting

| Problem | Solution |
|---------|----------|
| "Sign in" button not found | Try `"Log in"`, `"Login"`, `"Submit"`, or check with `browser_get_state` |
| Field not accepting input | Click the field first, then type. Or use `browser_press({ key: "Tab" })` to navigate to it |
| CAPTCHA appears | Call `browser_ask_user` immediately — the agent cannot solve CAPTCHAs |
| 2FA / Verification code | Call `browser_ask_user` and ask the user to enter the code |
| "Wrong password" error | Tell the user the credentials may be incorrect |
