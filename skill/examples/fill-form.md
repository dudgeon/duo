# Example: Fill and submit a web form

**Scenario:** Automating form submission from a Claude Code task.

```bash
# Navigate to the form
duo navigate "https://example.com/contact"
duo wait "form" --timeout 5000

# Fill fields
duo fill "input[name='name']" "Geoff"
duo fill "input[name='email']" "geoff@example.com"
duo fill "textarea[name='message']" "Hello from Claude Code"

# Submit
duo click "button[type='submit']"

# Confirm success
duo wait ".success-banner" --timeout 8000
duo text --selector ".success-banner"
```

**Recovery:** If `duo click` fails (element not found or not clickable):

```bash
# Inspect what's actually in the DOM
duo dom | grep -i "submit\|button"

# Or use eval for more control
duo eval "document.querySelector('form').submit()"
```
