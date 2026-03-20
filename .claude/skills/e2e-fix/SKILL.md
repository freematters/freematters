---
name: e2e-fix
description: Use when debugging a failed fflow e2e run — diagnoses the failure from run-dir artifacts, writes a shell script to reproduce it, fixes the code, and verifies with the real e2e runner.
---

# Fix Failed E2E Run

## Process

1. If the user specifies a failed run directory or test-dir, go directly to step 2.
2. If no failed run is specified, the user should describe what to test. Run `/e2e-run` first to generate a test plan and execute it. If it fails, use the resulting run directory for step 2.
3. Run `/fflow:start e2e-fix` with the failed run directory path as the prompt.
