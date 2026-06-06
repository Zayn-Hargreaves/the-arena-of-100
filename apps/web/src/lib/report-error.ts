export function reportError(error: Error) {
  const reporter = globalThis.reportError;

  if (typeof reporter === "function") {
    reporter(error);
  }
}
