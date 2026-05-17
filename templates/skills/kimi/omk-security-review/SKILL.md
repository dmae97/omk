---
name: omk-security-review
description: Security review for secrets, authentication, authorization, injection, unsafe shell commands, dependency risk, and sensitive file edits.
---

## Security Review

Use this for auth, API, database, shell, deployment, file upload, secrets, or dependency changes.

## Check

- Secret leakage
- `.env` modification
- Hardcoded tokens
- SQL/NoSQL injection
- Command injection
- XSS
- CSRF
- Broken authorization
- Unsafe file path handling
- Insecure dependency usage
- Over-broad permissions
- Dangerous shell commands

## Protected Files

Treat these as protected:

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

## Output

```txt
Security verdict:
Critical:
High:
Medium:
Low:
Required fixes:
```
