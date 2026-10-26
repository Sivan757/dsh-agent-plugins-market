---
description: Security scan of the legacy system with a reviewable remediation patch
argument-hint: <system> [--show-secrets]
arguments: system
---

Run a **security hardening pass** on `legacy/$system`: find vulnerabilities, rank them, and write the findings and a
proposed patch to `analysis/$system/`.
