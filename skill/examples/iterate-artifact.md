# Example: Iterate on a generated HTML artifact

**Scenario:** Claude generates an HTML prototype, loads it in the browser,
screenshots it, and iterates based on what it sees.

```bash
# Step 1: Generate the artifact
cat > /tmp/orbit-artifact.html << 'EOF'
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: system-ui; background: #0a0a0a; color: #e4e4e7; padding: 2rem; }
    .card { background: #161616; border: 1px solid #2a2a2a; border-radius: 8px; padding: 1.5rem; }
  </style>
</head>
<body>
  <div class="card">
    <h1>Hello from Claude</h1>
    <p>This is a generated prototype.</p>
  </div>
</body>
</html>
EOF

# Step 2: Load it in the browser
orbit navigate "file:///tmp/orbit-artifact.html"

# Step 3: Screenshot
orbit screenshot --out /tmp/orbit-artifact-v1.png

# Step 4: Inspect and iterate — edit the HTML, reload, screenshot again
orbit navigate "file:///tmp/orbit-artifact.html"
orbit screenshot --out /tmp/orbit-artifact-v2.png
```

**Notes:**

- `file://` URLs load instantly; no `orbit wait` needed.
- Share the screenshot path with the user using `Read /tmp/orbit-artifact-v1.png`.
- For interactive artifacts, use `orbit click` and `orbit fill` after loading.
