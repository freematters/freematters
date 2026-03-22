interface HelpPanelProps {
  filePath: string;
  token: string;
  onClose: () => void;
}

function CopyButton(props: { text: string }) {
  const { text } = props;
  const handleClick = () => {
    navigator.clipboard.writeText(text);
  };
  return (
    <button type="button" className="btn btn-sm help-copy-btn" onClick={handleClick}>
      Copy
    </button>
  );
}

export function HelpPanel(props: HelpPanelProps) {
  const { filePath, token, onClose } = props;

  const baseUrl = window.location.origin;
  const editCmd = `bash <(curl -sf ${baseUrl}/codoc.sh) edit ${token} <author>`;
  const pollCmd = `bash <(curl -sf ${baseUrl}/codoc.sh) poll ${token} <author>`;
  const whoCmd = `bash <(curl -sf ${baseUrl}/codoc.sh) who ${token}`;
  const agentMessage = `Please collaborate on this codoc markdown: ${baseUrl}/HOWTO_FOR_AGENT/${token}.md`;

  return (
    <div
      className="modal-overlay"
      onClick={onClose}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") onClose();
      }}
    >
      <div
        className="modal help-modal"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <span className="modal-title">Help</span>
          <button type="button" className="modal-close-btn" onClick={onClose}>
            x
          </button>
        </div>

        <div className="help-section">
          <h3>Edit in Terminal (local)</h3>
          <pre className="help-pre">{`vim ${filePath}`}</pre>
        </div>

        <div className="help-section">
          <h3>Remote Edit</h3>
          <div className="help-code-row">
            <pre className="help-pre">{editCmd}</pre>
            <CopyButton text={editCmd} />
          </div>
        </div>

        <div className="help-section">
          <h3>Remote Poll</h3>
          <div className="help-code-row">
            <pre className="help-pre">{pollCmd}</pre>
            <CopyButton text={pollCmd} />
          </div>
        </div>

        <div className="help-section">
          <h3>Who's Online</h3>
          <div className="help-code-row">
            <pre className="help-pre">{whoCmd}</pre>
            <CopyButton text={whoCmd} />
          </div>
        </div>

        <div className="help-section">
          <h3>Send to Agent</h3>
          <p className="help-hint">Share this link with any AI agent:</p>
          <div className="help-code-row">
            <pre className="help-pre">{agentMessage}</pre>
            <CopyButton text={agentMessage} />
          </div>
        </div>
      </div>
    </div>
  );
}
