---
version: 1
initial: start
---

# Simple Workflow

## State Machine

```mermaid
stateDiagram-v2
  [*] --> start
  start --> done: next
  done --> [*]
```

## Guide

Minimal workflow guide.

## State: start

### Instructions

Begin here.

### Transitions

- next → done

## State: done

### Instructions

Finished.

### Transitions

(none)
