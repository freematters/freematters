import Editor, { DiffEditor, type OnMount, type Monaco } from "@monaco-editor/react";
import type { CommentThread } from "@shared/comment-parser";
import { stripHtmlComments } from "@shared/copy-markdown";
import type { editor } from "monaco-editor";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  DiffData,
  type PresenceUser,
  type WsMessage,
  createWebSocket,
  fetchDiff,
  fetchFile,
  fetchPresence,
  heartbeatPresence,
  joinPresence,
  leavePresence,
  mergeThreeWay,
  saveFile,
  sendWsMessage,
} from "./api";
import { DiffGutter } from "./components/BlameGutter";
import { CommentPopup } from "./components/CommentPopup";
import { DiffView } from "./components/DiffView";
import { HelpPanel } from "./components/HelpPanel";
import { HistoryOverlay } from "./components/HistoryOverlay";
import { MarkdownPreview } from "./components/MarkdownPreview";
import { QuickMessage } from "./components/QuickMessage";
import { ShareDialog } from "./components/ShareDialog";
import { TypingIndicator } from "./components/TypingIndicator";
import { UserNameEditor } from "./components/UserNameEditor";
import "./App.css";

function getTokenFromUrl(): { token: string; mode: "edit" | "view" } | null {
  const editMatch = window.location.pathname.match(/^\/edit\/([a-f0-9]+)$/);
  if (editMatch) return { token: editMatch[1], mode: "edit" };
  const viewMatch = window.location.pathname.match(/^\/view\/([a-f0-9]+)$/);
  if (viewMatch) return { token: viewMatch[1], mode: "view" };
  return null;
}

function getStoredUsername(): string {
  try {
    return localStorage.getItem("codoc_username") || "browser_user";
  } catch {
    return "browser_user";
  }
}

function timeAgo(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const seconds = Math.floor((now - then) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function App() {
  const [content, setContent] = useState<string>("");
  const [token, setToken] = useState<string | null>(null);
  const [status, setStatus] = useState<string>("loading...");
  const [readonly, setReadonly] = useState<boolean>(false);
  const [commentPopup, setCommentPopup] = useState<{
    lineNumber: number;
    endLineNumber: number;
    top: number;
    left: number;
  } | null>(null);
  const [username, setUsername] = useState<string>(getStoredUsername);
  const [showHistory, setShowHistory] = useState<{
    visible: boolean;
    showLatestDiff: boolean;
  }>({ visible: false, showLatestDiff: false });
  const [showShareDialog, setShowShareDialog] = useState<boolean>(false);
  const [readonlyToken, setReadonlyToken] = useState<string | null>(null);
  const [copiedMd, setCopiedMd] = useState<boolean>(false);
  const [typingTrigger, setTypingTrigger] = useState<number>(0);
  const [showHelp, setShowHelp] = useState<boolean>(false);
  const [fileName, setFilePath] = useState<string>("");
  const [hoverLine, setHoverLine] = useState<number | null>(null);
  const [presenceUsers, setPresenceUsers] = useState<PresenceUser[]>([]);
  const [dirty, setDirty] = useState<boolean>(false);
  const [savedContent, setSavedContent] = useState<string>("");
  const [quickDiffData, setQuickDiffData] = useState<{
    original: string;
    modified: string;
  } | null>(null);
  const [conflictData, setConflictData] = useState<{
    conflictContent: string;
    myContent: string;
    baseContent: string;
  } | null>(null);
  const savedContentRef = useRef<string>("");
  const mergeBaseRef = useRef<string>("");
  const presenceSessionIdRef = useRef<string | null>(null);
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
  const monacoRef = useRef<Monaco | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const contentRef = useRef<string>("");
  const prevPresenceUsersRef = useRef<PresenceUser[]>([]);
  const pollTypingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [pollTypingVisible, setPollTypingVisible] = useState<boolean>(false);
  const glyphDecorationIds = useRef<string[]>([]);
  const previewPaneRef = useRef<HTMLDivElement | null>(null);
  const scrollSyncSource = useRef<"editor" | "preview" | null>(null);
  const glyphDragStartLine = useRef<number | null>(null);
  const glyphDragDecorationIds = useRef<string[]>([]);
  const savePendingRef = useRef<boolean>(false);

  const foldCommentRegions = useCallback(() => {
    const ed = editorRef.current;
    const monacoNs = monacoRef.current;
    if (!ed || !monacoNs) return;
    const model = ed.getModel();
    if (!model) return;
    const lineCount = model.getLineCount();
    const regions: { start: number; end: number }[] = [];
    let blockStart = -1;
    for (let i = 1; i <= lineCount; i++) {
      const line = model.getLineContent(i).trimStart();
      if (blockStart === -1 && line === "<!--") {
        blockStart = i;
      } else if (blockStart !== -1 && line === "-->") {
        regions.push({ start: blockStart, end: i });
        blockStart = -1;
      }
    }
    if (regions.length === 0) return;
    const selections = regions.map(
      (r) => new monacoNs.Selection(r.start, 1, r.start, 1),
    );
    const pos = ed.getPosition();
    ed.setSelections(selections);
    ed.trigger("fold", "editor.fold", {});
    if (pos) {
      ed.setPosition(pos);
    }
  }, []);

  const handleUsernameChange = useCallback(
    (newUsername: string) => {
      setUsername(newUsername);
      try {
        localStorage.setItem("codoc_username", newUsername);
      } catch {
        // ignore storage errors
      }
      if (token && presenceSessionIdRef.current) {
        const mode = readonly ? ("read" as const) : ("write" as const);
        leavePresence(token, presenceSessionIdRef.current).catch(() => {});
        joinPresence(token, newUsername, mode)
          .then((newId) => {
            presenceSessionIdRef.current = newId;
          })
          .catch(() => {});
      }
    },
    [token, readonly],
  );

  useEffect(() => {
    const parsed = getTokenFromUrl();
    if (!parsed) {
      setStatus("No token in URL");
      return;
    }
    setToken(parsed.token);

    fetchFile(parsed.token)
      .then((data) => {
        setContent(data.content);
        contentRef.current = data.content;
        savedContentRef.current = data.content;
        setSavedContent(data.content);
        mergeBaseRef.current = data.content;
        setDirty(false);
        setReadonly(data.readonly);
        setFilePath(data.fileName);
        if (data.readonlyToken) {
          setReadonlyToken(data.readonlyToken);
        }
        setStatus("ready");
        setTimeout(foldCommentRegions, 1500);
      })
      .catch((err: Error) => {
        setStatus(`Error: ${err.message}`);
      });
  }, []);

  useEffect(() => {
    if (!token) return;

    let unmounted = false;
    let reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
    let reconnectAttempt = 0;
    const MAX_RECONNECT_DELAY_MS = 30000;
    const BASE_RECONNECT_DELAY_MS = 1000;

    function connect() {
      if (unmounted) return;

      const ws = createWebSocket();
      wsRef.current = ws;

      ws.onopen = () => {
        reconnectAttempt = 0;
        setStatus("ready");
        sendWsMessage(ws, "file:subscribe", { token, author: getStoredUsername() });
        if (token)
          fetchPresence(token)
            .then((users) => {
              setPresenceUsers(users);
              prevPresenceUsersRef.current = users;
            })
            .catch(() => {});
      };

      ws.onmessage = (event: MessageEvent) => {
        try {
          const msg: WsMessage = JSON.parse(event.data);
          handleWsMessage(msg);
        } catch {
          // ignore parse errors
        }
      };

      ws.onclose = () => {
        wsRef.current = null;
        if (unmounted) return;
        setStatus("disconnected -- reconnecting...");
        const delay = Math.min(
          BASE_RECONNECT_DELAY_MS * 2 ** reconnectAttempt,
          MAX_RECONNECT_DELAY_MS,
        );
        reconnectAttempt++;
        reconnectTimeout = setTimeout(connect, delay);
      };

      ws.onerror = () => {
        ws.close();
      };
    }

    connect();

    return () => {
      unmounted = true;
      if (reconnectTimeout !== null) {
        clearTimeout(reconnectTimeout);
      }
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [token]);

  useEffect(() => {
    if (!token) return;

    const currentUsername = getStoredUsername();
    const mode = readonly ? ("read" as const) : ("write" as const);
    let heartbeatInterval: ReturnType<typeof setInterval> | null = null;

    joinPresence(token, currentUsername, mode)
      .then((sessionId) => {
        presenceSessionIdRef.current = sessionId;
        heartbeatInterval = setInterval(() => {
          if (presenceSessionIdRef.current) {
            heartbeatPresence(token, presenceSessionIdRef.current).catch(() => {
              const rejoinMode = readonly ? ("read" as const) : ("write" as const);
              joinPresence(token, getStoredUsername(), rejoinMode)
                .then((newId) => {
                  presenceSessionIdRef.current = newId;
                })
                .catch(() => {});
            });
          }
        }, 30000);
      })
      .catch(() => {});

    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (presenceSessionIdRef.current) {
        const body = JSON.stringify({ sessionId: presenceSessionIdRef.current });
        navigator.sendBeacon(
          `/api/presence/${token}/leave`,
          new Blob([body], { type: "application/json" }),
        );
      }
      if (contentRef.current !== savedContentRef.current) {
        e.preventDefault();
      }
    };
    window.addEventListener("beforeunload", handleBeforeUnload);

    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
      if (heartbeatInterval !== null) {
        clearInterval(heartbeatInterval);
      }
      if (presenceSessionIdRef.current) {
        leavePresence(token, presenceSessionIdRef.current).catch(() => {});
        presenceSessionIdRef.current = null;
      }
    };
  }, [token, readonly]);

  const handleWsMessage = useCallback(
    (msg: WsMessage) => {
      switch (msg.type) {
        case "file:content": {
          const payload = msg.payload as { content: string; version: number };
          const hadLocalEdits = contentRef.current !== mergeBaseRef.current;
          if (!hadLocalEdits) {
            setContent(payload.content);
            contentRef.current = payload.content;
            savedContentRef.current = payload.content;
            setSavedContent(payload.content);
            mergeBaseRef.current = payload.content;
            setDirty(false);
          } else if (payload.content !== savedContentRef.current) {
            savedContentRef.current = payload.content;
            setSavedContent(payload.content);
            setConflictData({
              conflictContent: payload.content,
              myContent: contentRef.current,
              baseContent: mergeBaseRef.current,
            });
            setStatus("conflict with server content");
          }
          break;
        }
        case "file:saved": {
          const payload = msg.payload as {
            by: string;
            version: number;
          };
          if (!savePendingRef.current) {
            if (token) {
              fetchFile(token)
                .then((data) => {
                  const hadLocalEdits = contentRef.current !== mergeBaseRef.current;
                  savedContentRef.current = data.content;
                  setSavedContent(data.content);
                  if (!hadLocalEdits) {
                    setContent(data.content);
                    contentRef.current = data.content;
                    mergeBaseRef.current = data.content;
                    setDirty(false);
                    setStatus(`saved by ${payload.by}`);
                  } else {
                    setConflictData({
                      conflictContent: data.content,
                      myContent: contentRef.current,
                      baseContent: mergeBaseRef.current,
                    });
                    setStatus(`conflict with ${payload.by}'s save`);
                  }

                  setTimeout(foldCommentRegions, 200);
                })
                .catch(() => {});
            }
          } else {
            setStatus("saved");
          }
          break;
        }
        case "file:changed": {
          const changedPayload = msg.payload as { by?: string };
          const changedBy = changedPayload.by ?? "external";
          if (token) {
            fetchFile(token)
              .then((data) => {
                const hadLocalEdits = contentRef.current !== mergeBaseRef.current;
                savedContentRef.current = data.content;
                setSavedContent(data.content);
                if (!hadLocalEdits) {
                  setContent(data.content);
                  contentRef.current = data.content;
                  mergeBaseRef.current = data.content;
                  setDirty(false);
                  setStatus(`changed by ${changedBy}`);
                } else {
                  setConflictData({
                    conflictContent: data.content,
                    myContent: contentRef.current,
                    baseContent: mergeBaseRef.current,
                  });
                  setStatus(`conflict with ${changedBy}'s change`);
                }

                setTimeout(foldCommentRegions, 200);
              })
              .catch(() => {});
          }
          break;
        }
        case "presence:update": {
          const payload = msg.payload as { users: PresenceUser[] };
          const prevUsers = prevPresenceUsersRef.current;
          const newUsers = payload.users;
          const newAuthorKeys = new Set(newUsers.map((u) => `${u.author}:${u.mode}`));
          const readUserLeft = prevUsers.some(
            (u) => u.mode === "read" && !newAuthorKeys.has(`${u.author}:${u.mode}`),
          );
          if (readUserLeft) {
            if (pollTypingTimeoutRef.current !== null) {
              clearTimeout(pollTypingTimeoutRef.current);
            }
            setPollTypingVisible(true);
            pollTypingTimeoutRef.current = setTimeout(() => {
              setPollTypingVisible(false);
              pollTypingTimeoutRef.current = null;
            }, 10000);
          }
          prevPresenceUsersRef.current = newUsers;
          setPresenceUsers(newUsers);
          break;
        }
      }
    },
    [token],
  );

  const focusEditor = useCallback(() => {
    editorRef.current?.focus();
  }, []);

  const handleSave = useCallback(() => {
    if (!token || readonly) return;
    focusEditor();
    const currentContent = contentRef.current;
    const baseContent = savedContentRef.current;
    setStatus("saving...");
    savePendingRef.current = true;
    saveFile(token, currentContent, baseContent)
      .then((result) => {
        savePendingRef.current = false;
        if (result.conflict) {
          setConflictData({
            conflictContent: result.conflictContent ?? "",
            myContent: currentContent,
            baseContent: baseContent,
          });
          setStatus("conflict detected");
          return;
        }
        savedContentRef.current = currentContent;
        setSavedContent(currentContent);
        mergeBaseRef.current = currentContent;
        setDirty(false);
        setStatus("saved");

        setTypingTrigger((prev) => prev + 1);
        setTimeout(foldCommentRegions, 200);
      })
      .catch((err: Error) => {
        savePendingRef.current = false;
        setStatus(`Save error: ${err.message}`);
      });
  }, [token, readonly, focusEditor, foldCommentRegions]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault();
        handleSave();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [handleSave]);

  const handleShowHistory = useCallback(() => {
    setShowHistory({ visible: true, showLatestDiff: false });
  }, []);

  const handleCloseHistory = useCallback(() => {
    setShowHistory({ visible: false, showLatestDiff: false });
  }, []);

  const handleShowShare = useCallback(() => {
    setShowShareDialog(true);
  }, []);

  const handleCloseShare = useCallback(() => {
    setShowShareDialog(false);
  }, []);

  const handleShowHelp = useCallback(() => {
    setShowHelp(true);
  }, []);

  const handleCloseHelp = useCallback(() => {
    setShowHelp(false);
  }, []);

  const handleQuickDiff = useCallback(() => {
    if (!token || !dirty) return;
    fetchFile(token)
      .then((data) => {
        setQuickDiffData({
          original: data.content,
          modified: contentRef.current,
        });
      })
      .catch(() => {});
  }, [token, dirty]);

  const openCommentPopupAtRange = useCallback((startLine: number, endLine: number) => {
    const editorInstance = editorRef.current;
    if (!editorInstance) return;

    const visPos = editorInstance.getScrolledVisiblePosition({
      lineNumber: endLine + 1,
      column: 1,
    });
    if (!visPos) return;

    setCommentPopup({
      lineNumber: startLine,
      endLineNumber: endLine,
      top: visPos.top + 40,
      left: visPos.left + 60,
    });
  }, []);

  const handleAddCommentOnCurrentLine = useCallback(() => {
    const editorInstance = editorRef.current;
    if (!editorInstance) return;

    const selection = editorInstance.getSelection();
    if (selection && !selection.isEmpty()) {
      const startLine = selection.startLineNumber - 1;
      const endLine = selection.endLineNumber - 1;
      openCommentPopupAtRange(startLine, endLine);
    } else {
      const pos = editorInstance.getPosition();
      if (!pos) return;
      openCommentPopupAtRange(pos.lineNumber - 1, pos.lineNumber - 1);
    }
  }, [openCommentPopupAtRange]);

  // Update glyph margin decorations based on hoverLine
  useEffect(() => {
    const editorInstance = editorRef.current;
    const monacoNs = monacoRef.current;
    if (!editorInstance || !monacoNs || readonly) return;

    if (hoverLine !== null) {
      const decorations = [
        {
          range: new monacoNs.Range(hoverLine, 1, hoverLine, 1),
          options: {
            glyphMarginClassName: "cdoc-gutter-add-btn",
            stickiness:
              monacoNs.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
          },
        },
      ];
      glyphDecorationIds.current = editorInstance.deltaDecorations(
        glyphDecorationIds.current,
        decorations,
      );
    } else {
      glyphDecorationIds.current = editorInstance.deltaDecorations(
        glyphDecorationIds.current,
        [],
      );
    }
  }, [hoverLine, readonly]);

  const handleCopyAsMarkdown = useCallback(() => {
    const currentValue = editorRef.current?.getValue() ?? contentRef.current;
    const clean = stripHtmlComments(currentValue);
    navigator.clipboard
      .writeText(clean)
      .then(() => {
        setCopiedMd(true);
        setTimeout(() => {
          setCopiedMd(false);
        }, 2000);
      })
      .catch(() => {});
  }, []);

  const handleEditorMount: OnMount = useCallback(
    (editorInstance, monaco) => {
      editorRef.current = editorInstance;
      monacoRef.current = monaco;

      // Cmd-S: Save
      editorInstance.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
        handleSave();
      });

      // Cmd-Shift-H: Toggle history overlay
      editorInstance.addCommand(
        monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyH,
        () => {
          setShowHistory((prev) => ({ visible: !prev.visible, showLatestDiff: false }));
        },
      );

      // Cmd-Shift-D: Quick diff
      editorInstance.addCommand(
        monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyD,
        () => {
          handleQuickDiff();
        },
      );

      // Cmd-Shift-S: Share dialog
      editorInstance.addCommand(
        monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyS,
        () => {
          setShowShareDialog((prev) => !prev);
        },
      );

      // Cmd-Shift-C: Add comment on current line
      editorInstance.addCommand(
        monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyC,
        () => {
          handleAddCommentOnCurrentLine();
        },
      );

      // Cmd-Shift-M: Copy as Markdown
      editorInstance.addCommand(
        monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyM,
        () => {
          handleCopyAsMarkdown();
        },
      );

      // Cmd-Shift-Enter: Comment on Document
      editorInstance.addCommand(
        monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.Enter,
        () => {
          handleAddCommentOnCurrentLine();
        },
      );

      // Cmd+/: Help
      editorInstance.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Slash, () => {
        setShowHelp((prev) => !prev);
      });

      // Track mouse for glyph margin hover and drag-to-select
      editorInstance.onMouseMove((e) => {
        if (e.target.position) {
          setHoverLine(e.target.position.lineNumber);
        }

        if (glyphDragStartLine.current !== null && e.target.position) {
          const currentLine = e.target.position.lineNumber;
          const startLine = glyphDragStartLine.current;
          const minLine = Math.min(startLine, currentLine);
          const maxLine = Math.max(startLine, currentLine);
          const decorations = [];
          for (let ln = minLine; ln <= maxLine; ln++) {
            decorations.push({
              range: new monaco.Range(ln, 1, ln, 1),
              options: {
                isWholeLine: true,
                className: "codoc-drag-highlight",
                stickiness:
                  monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
              },
            });
          }
          glyphDragDecorationIds.current = editorInstance.deltaDecorations(
            glyphDragDecorationIds.current,
            decorations,
          );
        }
      });

      editorInstance.onMouseLeave(() => {
        setHoverLine(null);
      });

      // Handle glyph margin mousedown: start drag or single-click
      editorInstance.onMouseDown((e) => {
        if (e.target.type === monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN) {
          const lineNumber = e.target.position?.lineNumber;
          if (lineNumber !== undefined && lineNumber !== null) {
            glyphDragStartLine.current = lineNumber;
          }
        }
      });

      // Handle mouseup: finish drag or single-click
      editorInstance.onMouseUp((e) => {
        if (glyphDragStartLine.current === null) return;

        const startLine = glyphDragStartLine.current;
        glyphDragStartLine.current = null;
        glyphDragDecorationIds.current = editorInstance.deltaDecorations(
          glyphDragDecorationIds.current,
          [],
        );

        const endLine = e.target.position?.lineNumber ?? startLine;
        const minLine = Math.min(startLine, endLine);
        const maxLine = Math.max(startLine, endLine);
        openCommentPopupAtRange(minLine - 1, maxLine - 1);
      });

      // Register folding provider for HTML comment blocks
      monaco.languages.registerFoldingRangeProvider("markdown", {
        provideFoldingRanges(model: {
          getLineCount: () => number;
          getLineContent: (n: number) => string;
        }) {
          const ranges: { start: number; end: number; kind: number }[] = [];
          const lineCount = model.getLineCount();
          let foldStart: number | null = null;

          for (let i = 1; i <= lineCount; i++) {
            const lineContent = model.getLineContent(i).trimStart();
            if (foldStart === null && lineContent === "<!--") {
              foldStart = i;
            } else if (foldStart !== null && lineContent === "-->") {
              ranges.push({
                start: foldStart,
                end: i,
                kind: monaco.languages.FoldingRangeKind.Comment.value,
              });
              foldStart = null;
            }
          }

          return ranges;
        },
      });

      editorInstance.onDidScrollChange(() => {
        if (scrollSyncSource.current === "preview") return;
        scrollSyncSource.current = "editor";
        const preview = previewPaneRef.current;
        if (!preview) return;
        const scrollTop = editorInstance.getScrollTop();
        const scrollHeight = editorInstance.getScrollHeight();
        const clientHeight = editorInstance.getLayoutInfo().height;
        const maxScroll = scrollHeight - clientHeight;
        const ratio = maxScroll > 0 ? scrollTop / maxScroll : 0;
        const previewMax = preview.scrollHeight - preview.clientHeight;
        preview.scrollTop = ratio * previewMax;
        requestAnimationFrame(() => {
          scrollSyncSource.current = null;
        });
      });

      setTimeout(() => {
        foldCommentRegions();
        editorInstance.setPosition({ lineNumber: 1, column: 1 });
        editorInstance.revealLine(1);
      }, 1500);
    },
    [
      handleSave,
      handleQuickDiff,
      handleAddCommentOnCurrentLine,
      handleCopyAsMarkdown,
      openCommentPopupAtRange,
    ],
  );

  const handleEditorChange = useCallback((value: string | undefined) => {
    if (value !== undefined) {
      contentRef.current = value;
      setDirty(value !== savedContentRef.current);
    }
  }, []);

  const handleCommentSubmit = useCallback(
    (block: string, _unused: string) => {
      if (!commentPopup) return;

      const lines = contentRef.current.split("\n");
      const insertIndex = commentPopup.endLineNumber + 1;

      lines.splice(insertIndex, 0, ...block.trimEnd().split("\n"));

      const newContent = lines.join("\n");
      contentRef.current = newContent;
      setContent(newContent);
      setDirty(newContent !== savedContentRef.current);
      setCommentPopup(null);

      focusEditor();
    },
    [commentPopup, focusEditor],
  );

  const handleCommentClose = useCallback(() => {
    setCommentPopup(null);
    focusEditor();
  }, [focusEditor]);

  const handleRevert = useCallback((revertedContent: string) => {
    setContent(revertedContent);
    contentRef.current = revertedContent;

    setStatus("reverted");
  }, []);

  const handleConflictKeepMine = useCallback(() => {
    if (!token || !conflictData) return;
    setConflictData(null);
    setStatus("saving (keep mine)...");
    saveFile(token, conflictData.myContent)
      .then((result) => {
        if (!result.ok) {
          setStatus("Save error after conflict resolution");
          return;
        }
        savedContentRef.current = conflictData.myContent;
        setSavedContent(conflictData.myContent);
        mergeBaseRef.current = conflictData.myContent;
        setDirty(false);
        setStatus("saved");
      })
      .catch((err: Error) => {
        setStatus(`Save error: ${err.message}`);
      });
  }, [token, conflictData]);

  const handleConflictUseTheirs = useCallback(() => {
    if (!token) return;
    setConflictData(null);
    fetchFile(token)
      .then((data) => {
        setContent(data.content);
        contentRef.current = data.content;
        savedContentRef.current = data.content;
        setSavedContent(data.content);
        mergeBaseRef.current = data.content;
        setDirty(false);
        setStatus("loaded server version");
      })
      .catch((err: Error) => {
        setStatus(`Fetch error: ${err.message}`);
      });
  }, [token]);

  const handleConflictAutoMerge = useCallback(() => {
    if (!conflictData) return;
    mergeThreeWay(
      conflictData.baseContent,
      conflictData.myContent,
      conflictData.conflictContent,
    )
      .then((result) => {
        setContent(result.content);
        contentRef.current = result.content;
        savedContentRef.current = conflictData.conflictContent;
        setSavedContent(conflictData.conflictContent);
        mergeBaseRef.current = conflictData.conflictContent;
        setConflictData(null);
        if (result.conflict) {
          setDirty(true);
          setStatus("auto-merged with conflicts — resolve <<<< markers and save");
        } else {
          setDirty(true);
          setStatus("auto-merged — review and save");
        }
      })
      .catch((err: Error) => {
        setStatus(`Merge error: ${err.message}`);
      });
  }, [conflictData]);

  const handleConflictDismiss = useCallback(() => {
    if (!conflictData) return;
    setConflictData(null);
    setDirty(true);
    setStatus("keeping your edits — review and save");
  }, [conflictData]);

  const handleQuickMessage = useCallback((commentLine: string) => {
    const currentContent = contentRef.current;
    const newContent = currentContent.endsWith("\n")
      ? `${currentContent + commentLine}\n`
      : `${currentContent}\n${commentLine}\n`;
    contentRef.current = newContent;
    setContent(newContent);
    setDirty(newContent !== savedContentRef.current);
  }, []);

  const handleResolveThread = useCallback((thread: CommentThread) => {
    const lines = contentRef.current.split("\n");
    const linesToRemove = new Set<number>();

    const cidSet = new Set<string>();
    for (const comment of thread.comments) {
      if (comment.cid) {
        cidSet.add(comment.cid);
      }
    }

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trimStart();

      if (line.startsWith("<!--") && line.endsWith("-->")) {
        for (const cid of cidSet) {
          if (line.includes(`[cid:${cid}]`)) {
            linesToRemove.add(i);
          }
        }
        if (
          thread.threadId &&
          line.includes(`[tid:${thread.threadId}]`) &&
          line.trimStart().startsWith("[REPLY_TEMPLATE]")
        ) {
          linesToRemove.add(i);
        }
        continue;
      }

      for (const cid of cidSet) {
        if (line.includes(`[cid:${cid}]`)) {
          linesToRemove.add(i);
        }
      }

      if (
        thread.threadId &&
        line.includes(`[tid:${thread.threadId}]`) &&
        line.includes("[REPLY_TEMPLATE]")
      ) {
        linesToRemove.add(i);
      }
    }

    if (linesToRemove.size === 0) return;

    const filteredLines = lines.filter((_line, idx) => !linesToRemove.has(idx));

    const cleanedLines: string[] = [];
    let i = 0;
    while (i < filteredLines.length) {
      if (filteredLines[i].trimStart() === "<!--") {
        const blockStart = i;
        let j = i + 1;
        while (j < filteredLines.length && filteredLines[j].trimStart() !== "-->") {
          j++;
        }
        if (j < filteredLines.length && filteredLines[j].trimStart() === "-->") {
          const innerLines = filteredLines.slice(blockStart + 1, j);
          const hasContent = innerLines.some((l) => l.trim().length > 0);
          if (hasContent) {
            for (let k = blockStart; k <= j; k++) {
              cleanedLines.push(filteredLines[k]);
            }
          }
          i = j + 1;
        } else {
          cleanedLines.push(filteredLines[i]);
          i++;
        }
      } else {
        cleanedLines.push(filteredLines[i]);
        i++;
      }
    }

    const newContent = cleanedLines.join("\n");
    contentRef.current = newContent;
    setContent(newContent);
  }, []);

  const handleInsertReply = useCallback((replyBlock: string, thread: CommentThread) => {
    const lines = contentRef.current.split("\n");
    const lastComment = thread.comments[thread.comments.length - 1];
    let insertAfterLine = -1;

    if (lastComment?.cid) {
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].includes(`[cid:${lastComment.cid}]`)) {
          insertAfterLine = i;
        }
      }
    }
    if (lastComment?.tid && insertAfterLine === -1) {
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].includes(`[tid:${lastComment.tid}]`)) {
          insertAfterLine = i;
        }
      }
    }

    const blockLines = replyBlock.trimEnd().split("\n");
    const isBlock =
      blockLines[0] === "<!--" && blockLines[blockLines.length - 1] === "-->";
    const innerLines = isBlock
      ? blockLines.slice(1, blockLines.length - 1)
      : blockLines;

    let newContent: string;
    if (insertAfterLine >= 0) {
      let blockEndLine = -1;
      for (let i = insertAfterLine + 1; i < lines.length; i++) {
        if (lines[i].trimStart() === "-->") {
          blockEndLine = i;
          break;
        }
        if (lines[i].trimStart().startsWith("<!--") || lines[i].trim() === "") {
          break;
        }
      }

      if (blockEndLine >= 0) {
        lines.splice(blockEndLine, 0, ...innerLines);
      } else {
        lines.splice(insertAfterLine + 1, 0, ...blockLines);
      }
      newContent = lines.join("\n");
    } else {
      const appendText = replyBlock.endsWith("\n") ? replyBlock : `${replyBlock}\n`;
      newContent = contentRef.current.endsWith("\n")
        ? contentRef.current + appendText.trimEnd()
        : `${contentRef.current}\n${appendText.trimEnd()}`;
    }
    contentRef.current = newContent;
    setContent(newContent);
    setDirty(newContent !== savedContentRef.current);
  }, []);

  if (!token) {
    return (
      <div className="no-token-page">
        No token found in URL. Navigate to /edit/:token or /view/:token
      </div>
    );
  }

  return (
    <div className="app-root">
      <div className="header">
        <span className="header-left">
          <strong className="header-title">codoc</strong>
          {readonly && <span className="header-readonly-badge">(read-only)</span>}
          {!readonly && (
            <UserNameEditor
              username={username}
              onUsernameChange={handleUsernameChange}
            />
          )}
          {presenceUsers.length > 0 && (
            <span className="presence-users">
              {presenceUsers.map((u, i) => (
                <span
                  key={i}
                  className={`presence-user ${u.mode === "write" ? "presence-write" : "presence-read"}`}
                >
                  {u.author}
                </span>
              ))}
            </span>
          )}
        </span>
        <div className="header-right">
          <span className="header-status">
            {dirty ? `${status} (unsaved)` : status}
          </span>
          {!readonly && token && (
            <TypingIndicator token={token} trigger={typingTrigger} />
          )}
          {pollTypingVisible && (
            <span className="typing-indicator">
              <span className="codoc-typing-dot" />
              <span className="codoc-typing-dot" />
              <span className="codoc-typing-dot" />
            </span>
          )}
          {!readonly && (
            <button className={dirty ? "btn btn-primary" : "btn"} onClick={handleSave}>
              Save<span className="btn-shortcut">⌘S</span>
            </button>
          )}
          <button
            className={dirty ? "btn btn-accent" : "btn btn-disabled"}
            onClick={handleQuickDiff}
            disabled={!dirty}
          >
            Current Diff<span className="btn-shortcut">⇧⌘D</span>
          </button>
          <button className="btn" onClick={handleShowHistory}>
            History<span className="btn-shortcut">⇧⌘H</span>
          </button>
          {!readonly && (
            <button className="btn" onClick={handleShowShare}>
              Share<span className="btn-shortcut">⇧⌘S</span>
            </button>
          )}
          <button
            className={copiedMd ? "btn btn-copied" : "btn"}
            onClick={handleCopyAsMarkdown}
          >
            {copiedMd ? "Copied!" : "Copy MD"}
            <span className="btn-shortcut">⇧⌘M</span>
          </button>
          {!readonly && (
            <QuickMessage username={username} onSend={handleQuickMessage} />
          )}
          <button className="btn" onClick={handleShowHelp}>
            Help<span className="btn-shortcut">⌘/</span>
          </button>
        </div>
      </div>
      <div className="editor-layout">
        <div className="editor-pane">
          <Editor
            language="markdown"
            theme="vs-dark"
            value={content}
            onChange={handleEditorChange}
            onMount={handleEditorMount}
            options={{
              readOnly: readonly,
              minimap: { enabled: false },
              wordWrap: "on",
              lineNumbers: "on",
              fontSize: 14,
              glyphMargin: true,
              folding: true,
              foldingStrategy: "auto",
            }}
          />
          <DiffGutter
            editor={editorRef.current}
            monaco={monacoRef.current}
            savedContent={savedContent}
            currentContent={content}
          />
          {commentPopup && (
            <div
              style={{
                position: "absolute",
                top: commentPopup.top,
                left: commentPopup.left,
                zIndex: 1000,
              }}
            >
              <CommentPopup
                lineNumber={commentPopup.lineNumber}
                endLineNumber={commentPopup.endLineNumber}
                username={username}
                onSubmit={handleCommentSubmit}
                onClose={handleCommentClose}
              />
            </div>
          )}
        </div>
        <div className="editor-divider" />
        <div
          className="preview-pane"
          ref={previewPaneRef}
          onScroll={() => {
            if (scrollSyncSource.current === "editor") return;
            scrollSyncSource.current = "preview";
            const ed = editorRef.current;
            const preview = previewPaneRef.current;
            if (!ed || !preview) return;
            const previewMax = preview.scrollHeight - preview.clientHeight;
            const ratio = previewMax > 0 ? preview.scrollTop / previewMax : 0;
            const editorMax = ed.getScrollHeight() - ed.getLayoutInfo().height;
            ed.setScrollTop(ratio * editorMax);
            requestAnimationFrame(() => {
              scrollSyncSource.current = null;
            });
          }}
        >
          <MarkdownPreview
            content={content}
            username={username}
            onInsertReply={handleInsertReply}
            onResolveThread={handleResolveThread}
          />
        </div>
      </div>
      {showHistory.visible && token && (
        <HistoryOverlay
          token={token}
          dirty={dirty}
          showLatestDiff={showHistory.showLatestDiff}
          currentContent={contentRef.current}
          onClose={handleCloseHistory}
          onRevert={handleRevert}
        />
      )}
      {quickDiffData !== null && (
        <DiffView
          original={quickDiffData.original}
          modified={quickDiffData.modified}
          title="On Disk → Editor"
          onClose={() => setQuickDiffData(null)}
        />
      )}
      {showShareDialog && token && (
        <ShareDialog
          token={token}
          readonlyToken={readonlyToken}
          onClose={handleCloseShare}
        />
      )}
      {showHelp && token && (
        <HelpPanel fileName={fileName} token={token} onClose={handleCloseHelp} />
      )}
      {conflictData !== null && (
        <div className="modal-overlay">
          <div className="modal diff-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <span className="modal-title">
                Conflict Detected — Theirs (left) vs Mine (right)
              </span>
              <button className="modal-close-btn" onClick={() => setConflictData(null)}>
                x
              </button>
            </div>
            <div style={{ display: "flex", gap: "8px", padding: "8px 16px" }}>
              <button className="btn btn-primary" onClick={handleConflictAutoMerge}>
                Auto Merge
              </button>
              <button className="btn" onClick={handleConflictKeepMine}>
                Keep Mine
              </button>
              <button className="btn" onClick={handleConflictUseTheirs}>
                Use Theirs
              </button>
              <button className="btn" onClick={handleConflictDismiss}>
                Dismiss
              </button>
            </div>
            <div className="diff-editor-container">
              <DiffEditor
                original={conflictData.conflictContent}
                modified={conflictData.myContent}
                language="markdown"
                theme="vs-dark"
                options={{
                  readOnly: true,
                  originalEditable: false,
                  minimap: { enabled: false },
                  wordWrap: "on",
                  fontSize: 13,
                  scrollBeyondLastLine: false,
                  renderSideBySide: true,
                }}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
