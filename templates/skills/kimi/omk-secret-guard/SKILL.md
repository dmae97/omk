---
name: omk-secret-guard
description: Protect sensitive files and prevent secret leakage during Kimi coding workflows.
---

## Protected Files

Never write, print, commit, or summarize secrets from:

```txt
.env
.env.*
*.pem
*.key
id_rsa
id_ed25519
credentials.json
service-account*.json
```

## Rule

If a task requires touching secrets, stop and request explicit user action.
