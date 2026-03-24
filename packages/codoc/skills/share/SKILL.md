---
name: codoc:share
description: Share a file for collaborative editing with a human via browser. Use when the user wants to collaboratively edit a markdown file, get feedback, or have a conversation within a document.
---

# Share File for Collaborative Editing

## Flow

0. `codoc` cli should already be installed on the machine. Just call `codoc xxx` without any prefixes!

1. Run `codoc server` **in background** (set `run_in_background: true`, timeout 600000ms). This starts the HTTP server and tunnel. It blocks until killed — that's expected.
2. `codoc share /absolute/path/to/file.md` → prints Edit URL + Readonly URL + token. No need to wait - this command will wait for the server to be ready.
3. Tell user the Edit URL (or Readonly URL if they should only view)
4. Run `codoc poll <token> agent` **in background** (set `run_in_background: true`, timeout 600000ms). You will be notified when the human edits. Continue with other work while waiting.
5. When poll completes, read the file. Find `[REPLY_TEMPLATE]` lines inside `<!-- ... -->` blocks, replace each with your reply (keep the line format, remove `[REPLY_TEMPLATE] ` prefix).
6. Run `codoc poll <token> agent` in background again. Repeat 4-5.
7. When you have nothing else to do, keep polling. Only stop polling if the user gives you a different task.

## Troubleshooting

If the user says the link doesn't work, is broken, or returns 404:
1. Try `codoc share` again on the same file to get a fresh URL.
2. If re-share fails (server not running), stop the old background `codoc server` task (via TaskStop or `codoc stop`), then restart from step 1 of the Flow (run `codoc server` in background, then `codoc share`).

## Comment Block Format

A comment block applies to the line immediately above it — place your comment right after the line you want to discuss.

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
