import { useCallback, useEffect, useRef, useState } from "react";

interface UserNameEditorProps {
  username: string;
  onUsernameChange: (newUsername: string) => void;
}

export function UserNameEditor(props: UserNameEditorProps) {
  const { username, onUsernameChange } = props;
  const [editing, setEditing] = useState<boolean>(false);
  const [editValue, setEditValue] = useState<string>(username);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  const handleStartEdit = useCallback(() => {
    setEditValue(username);
    setEditing(true);
  }, [username]);

  const handleCommit = useCallback(() => {
    const trimmed = editValue.trim();
    const finalValue = trimmed.length > 0 ? trimmed : "browser_user";
    onUsernameChange(finalValue);
    setEditing(false);
  }, [editValue, onUsernameChange]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") {
        e.preventDefault();
        handleCommit();
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setEditing(false);
      }
    },
    [handleCommit],
  );

  if (editing) {
    return (
      <input
        ref={inputRef}
        className="username-input"
        type="text"
        value={editValue}
        onChange={(e) => setEditValue(e.target.value)}
        onBlur={handleCommit}
        onKeyDown={handleKeyDown}
      />
    );
  }

  return (
    <span
      className="username-display"
      onClick={handleStartEdit}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") handleStartEdit();
      }}
      title="Click to edit username"
    >
      @{username}
    </span>
  );
}
