---
name: markdown-convert
description: Convert between YAML and Markdown workflow formats. Use when the user asks to convert a .workflow.yaml to .workflow.md or vice versa.
---

# Markdown Workflow Convert

Convert a workflow file between YAML (`.workflow.yaml`) and Markdown (`.workflow.md`) formats.

## Usage

```
fflow markdown convert <file> [-o <output>]
```

- `<file>` — the input workflow file to convert
- `-o <output>` — optional output path (defaults to same basename with swapped extension)

## Auto-Detection

The conversion direction is determined by the input file extension:

| Input Extension | Output Extension | Direction |
|---|---|---|
| `.workflow.yaml` / `.workflow.yml` | `.workflow.md` | YAML to Markdown |
| `.workflow.md` | `.workflow.yaml` | Markdown to YAML |

## Default Output

When `-o` is not specified, the output file is written alongside the input with the swapped extension:

- `my-flow.workflow.yaml` produces `my-flow.workflow.md`
- `my-flow.workflow.md` produces `my-flow.workflow.yaml`

## Process

1. Run the convert command:

```bash
fflow markdown convert <file>
```

2. Verify the output file was created and report the path to the user.

3. Verify the converted workflow loads correctly:

```bash
fflow start <output-file> --run-id test-convert
```

4. Compare state cards between original and converted — spot-check that states, transitions, todos, and guide content match.

5. Clean up the test run:

```bash
fflow finish --run-id test-convert
```

## Edge Cases

- **State-level guide**: In YAML, states can have a `guide` field. When converting to Markdown, this guide is prepended to the `### Instructions` section with a clear separator since Markdown format does not have a per-state guide subsection.
- **`<freeflow>` tags**: When converting YAML to Markdown:
  - `from: "workflow#state"` generates a `<freeflow from="workflow#state">` tag at the top of the state section
  - `workflow: "./child"` generates a `<freeflow workflow="./child">` tag (no `### Instructions` needed)
  - `append_todos` generates a `<freeflow append-todos>` block tag with the list items
- **Mermaid diagram**: The `## State Machine` mermaid block is auto-generated in Markdown output from the actual transition data. It is decorative and ignored when parsing back.
- **Transition arrow style**: The Markdown serializer always outputs `→` (U+2192). Both `→` and `->` are accepted when parsing.

## Error Handling

- **Unsupported extension**: If the file does not end in `.workflow.yaml`, `.workflow.yml`, or `.workflow.md`, the command exits with `ARGS_INVALID`.
- **Invalid workflow**: If the input file fails validation during `loadFsm()`, the command reports the validation error. Fix the source file first (consider using `/fflow markdown fix` for `.workflow.md` files).
