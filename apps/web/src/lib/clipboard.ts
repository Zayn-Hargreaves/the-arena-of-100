interface LegacyClipboardDocument {
  execCommand(commandId: string, showUI?: boolean, value?: string): boolean;
}

/**
 * Copies the given text to the system clipboard.
 * Uses the modern Navigator Clipboard API when available and in a secure context,
 * with a fallback to document.execCommand('copy') for older/insecure environments.
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  if (typeof window === "undefined") return false;

  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }

    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.readOnly = true;
    textarea.style.cssText =
      "position:fixed;left:-9999px;top:-9999px;opacity:0;";
    document.body.appendChild(textarea);
    try {
      textarea.select();
      const legacyDoc = document as unknown as LegacyClipboardDocument;
      return legacyDoc.execCommand("copy");
    } finally {
      textarea.remove();
    }
  } catch {
    return false;
  }
}
