/**
 * Lightweight Server-Timing header builder.
 *
 * Usage in an API route:
 *   const timing = new ServerTiming();
 *   const data = await timing.measure("db", () => fetchFromDb());
 *   const headers = new Headers();
 *   timing.applyTo(headers);
 *   return NextResponse.json(data, { headers });
 *
 * Results appear in the browser DevTools Network → Timing tab.
 */
export class ServerTiming {
  private entries: Array<{ name: string; dur: number }> = [];

  /** Measure an async operation and record its duration. */
  async measure<T>(name: string, fn: () => Promise<T>): Promise<T> {
    const start = performance.now();
    const result = await fn();
    this.entries.push({ name, dur: performance.now() - start });
    return result;
  }

  /** Format entries as a Server-Timing header value. */
  headerValue(): string {
    return this.entries
      .map((e) => `${e.name};dur=${e.dur.toFixed(1)}`)
      .join(", ");
  }

  /** Append the Server-Timing header to an existing Headers object. */
  applyTo(headers: Headers): void {
    const val = this.headerValue();
    if (val) headers.set("Server-Timing", val);
  }
}
