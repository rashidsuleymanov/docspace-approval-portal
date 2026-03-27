import Modal from "./Modal.jsx";

export default function ConfirmModal({
  open,
  title,
  message,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  busy = false,
  tone = "danger", // danger | primary
  onConfirm,
  onClose
}) {
  return (
    <Modal
      open={open}
      title={title || "Confirm"}
      onClose={() => {
        if (busy) return;
        onClose?.();
      }}
      footer={
        <>
          <button
            type="button"
            onClick={() => {
              if (busy) return;
              onClose?.();
            }}
            disabled={busy}
          >
            {cancelLabel}
          </button>
          <button type="button" className={tone === "primary" ? "primary" : "danger"} onClick={() => onConfirm?.()} disabled={busy}>
            {busy ? "Working..." : confirmLabel}
          </button>
        </>
      }
    >
      <p className="muted" style={{ margin: 0 }}>
        {message || "Are you sure?"}
      </p>
    </Modal>
  );
}

