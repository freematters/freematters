---
name: e2e-run
description: Run e2e agent tests with freefsm verify.
---

# Run E2E Agent Tests

Run `freefsm verify <plan.md> --test-dir <path> [--model <model>] [--verbose]`.

If no test plan is specified, write one to `./e2e/` first (see `/e2e-gen`), then run it.

Exit codes: `0` pass, `2` fail. Report written to `--test-dir/test-report.md`.
