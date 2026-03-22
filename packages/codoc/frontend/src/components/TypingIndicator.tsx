import { useCallback, useEffect, useState } from "react";

interface TypingIndicatorProps {
  token: string;
  trigger: number;
}

export function TypingIndicator(props: TypingIndicatorProps) {
  const { token, trigger } = props;
  const [visible, setVisible] = useState<boolean>(false);

  const checkAndShow = useCallback(() => {
    if (trigger === 0) return;
    fetch(`/api/status/${token}`)
      .then((res) => res.json())
      .then((data: { agentOnline: boolean }) => {
        if (data.agentOnline) {
          setVisible(true);
          setTimeout(() => {
            setVisible(false);
          }, 5000);
        }
      })
      .catch(() => {});
  }, [token, trigger]);

  useEffect(() => {
    checkAndShow();
  }, [checkAndShow]);

  if (!visible) return null;

  return (
    <span className="typing-indicator">
      <span className="codoc-typing-dot" />
      <span className="codoc-typing-dot" />
      <span className="codoc-typing-dot" />
    </span>
  );
}
