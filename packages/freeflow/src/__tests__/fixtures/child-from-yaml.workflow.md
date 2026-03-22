---
version: 1
initial: start
---

# Child From YAML Workflow

## State: start

<freeflow from="./base.workflow.yaml#start">

### Instructions

Custom start with base.

{{base}}

### Transitions

- next → done

## State: done

### Instructions

Done from markdown child.

### Transitions

(none)
