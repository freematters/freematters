---
name: codoc:share
description: Share a file for collaborative editing with a human via browser. Use when the user wants to collaboratively edit a markdown file, get feedback, or have a conversation within a document.
---

# Share File for Collaborative Editing

## Flow

1. `codoc share /absolute/path/to/file.md` → prints Edit URL + Readonly URL + token
2. Tell user the Edit URL (or Readonly URL if they should only view)
3. Run `codoc poll <token> agent` **in background** (set `run_in_background: true`, timeout 600000ms). You will be notified when the human edits. Continue with other work while waiting.
4. When poll completes, read the file. Find `[REPLY_TEMPLATE]` lines inside `<!-- ... -->` blocks, replace each with your reply (keep the line format, remove `[REPLY_TEMPLATE] ` prefix).
5. Run `codoc poll <token> agent` in background again. Repeat 3-4.
6. When you have nothing else to do, keep polling. Only stop polling if the user gives you a different task.

## Comment Block Format

Comments are grouped in multi-line blocks:
```
<!--
@user[cid:abc]: question here
[REPLY_TEMPLATE] @agent[cid:def][reply:abc]: your response here (use \n for newlines)
-->
```

To reply, replace the `[REPLY_TEMPLATE]` line with:
```
@agent[cid:def][reply:abc]: your actual response
```

Escape `-->` as `\-\-\>`, newlines as `\n` within comment text.

## Remote Access

```
bash <(curl -sf <server-url>/codoc.sh) edit <token> <author>
bash <(curl -sf <server-url>/codoc.sh) poll <token> <author>
bash <(curl -sf <server-url>/codoc.sh) who <token>
```
