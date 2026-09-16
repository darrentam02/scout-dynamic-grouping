---
name: Managed workflow restarts
description: How to verify the imported app's parallel managed workflows without duplicate port listeners.
---

Keep the Run button's parallel project workflow referencing the managed API and web workflows. For agent-side verification, restart the two managed artifact workflows directly rather than restarting the parent project workflow.

**Why:** Restarting the parent through the workflow tool also triggered managed artifact startup in a way that raced existing child listeners, producing misleading `EADDRINUSE` failures even though each service starts cleanly on its own.

**How to apply:** After configuration or dependency changes, clear any stale listeners if necessary, restart the API and web artifact workflows directly, then verify both routes through the shared proxy.