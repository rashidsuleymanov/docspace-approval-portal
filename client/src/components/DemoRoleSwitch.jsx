export default function DemoRoleSwitch({ activeRole = "requester", onSelectRequester, onSelectRecipient, disabledRecipient = false }) {
  return (
    <div className="demo-role-switch" role="tablist" aria-label="Demo role">
      <button
        type="button"
        className={`mode-pill ${activeRole === "requester" ? "active" : ""}`}
        onClick={onSelectRequester}
      >
        Requester
      </button>
      <button
        type="button"
        className={`mode-pill ${activeRole === "recipient" ? "active" : ""}`}
        onClick={onSelectRecipient}
        disabled={disabledRecipient}
      >
        Recipient
      </button>
    </div>
  );
}
