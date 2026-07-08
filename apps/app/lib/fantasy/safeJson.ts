/**
 * Parse a fetch Response as JSON, degrading gracefully when the body isn't
 * JSON (Vercel gateway timeouts return HTML 504 pages, which used to make
 * res.json() throw and swallow the error state entirely).
 */
export async function safeJson(res: Response): Promise<Record<string, any>> {
  try {
    return await res.json();
  } catch {
    const hint = res.status === 504 ? " — timed out, try again" : "";
    return { error: `Request failed (${res.status}${hint})` };
  }
}
