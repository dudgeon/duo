# Example: Fill and submit a web form

**Scenario:** Automating form submission from a Claude Code task.

```bash
# Navigate to the form
orbit navigate "https://example.com/contact"
orbit wait "form" --timeout 5000

# Fill fields
orbit fill "input[name='name']" "Geoff"
orbit fill "input[name='email']" "geoff@example.com"
orbit fill "textarea[name='message']" "Hello from Claude Code"

# Submit
orbit click "button[type='submit']"

# Confirm success
orbit wait ".success-banner" --timeout 8000
orbit text --selector ".success-banner"
```

**Recovery:** If `orbit click` fails (element not found or not clickable):

```bash
# Inspect what's actually in the DOM
orbit dom | grep -i "submit\|button"

# Or use eval for more control
orbit eval "document.querySelector('form').submit()"
```
