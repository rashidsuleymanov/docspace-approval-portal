export function toast(message, tone = "info") {
  const text = String(message || "").trim();
  if (!text) return;
  window.dispatchEvent(
    new CustomEvent("portal:toast", {
      detail: {
        message: text,
        tone: String(tone || "info")
      }
    })
  );
}

