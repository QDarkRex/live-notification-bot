/**
 * Split IDN chat WebSocket frames into IRC lines.
 *
 * IDN's chat server (wss://chat.idn.app) sends ONE IRC line per WebSocket frame
 * with NO trailing CRLF (the IRCv3 WebSocket convention) — verified in production
 * 2026-10-30. Older behaviour was a CRLF-terminated stream where one line could
 * be split across frames. The July buffering fix only dispatched on "\n", so with
 * newline-less frames nothing was ever dispatched: no PONG, the server dropped
 * every socket after its 30s ping timeout, and no love letter was captured from
 * 2026-07-06 on. Handle both shapes:
 *   - a frame with no "\n" and nothing buffered is a complete line;
 *   - otherwise accumulate and dispatch on "\n", keeping a trailing partial line.
 */
export function takeLines(buffer: string, frame: string): { lines: string[]; rest: string } {
  if (!frame.includes("\n") && buffer === "") {
    const line = frame.replace(/\r$/, "");
    return { lines: line ? [line] : [], rest: "" };
  }
  const parts = (buffer + frame).split("\n");
  const rest = parts.pop() ?? "";
  const lines = parts.map((p) => p.replace(/\r$/, "")).filter((p) => p !== "");
  return { lines, rest };
}
