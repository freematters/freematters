# Progress

## Step 1: Update download_spec.py — remove slugify, require --slug
- **Files changed**: `packages/freeflow/workflows/spec-to-code/download_spec.py`
- **What was built**: Removed `slugify()` function, made `--slug` a required argument, updated docstring
- **Tests**: None (trivial argparse change)
- **Notes**: `re` import kept — still used by `parse_artifact_header`
