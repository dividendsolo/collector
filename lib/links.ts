/**
 * The one place the page decides what may go in an `<a href>`. A status feed's incident link and a job notice's href
 * come from outside data — a vendor's status page, whoever answers a probe, a directory listing's own URL — and land
 * in an `<a href>` on Collector's own origin, whose routes restart the server, start the tailnet or the Hermes gateway
 * and write `config.json`. React writes a known attribute straight through (`setValueForKnownAttribute`), so a
 * `javascript:` or `data:` URL would run there when it is clicked. Only a web address is a link (collector#84, the
 * same rule `collect.py`'s notices read applies).
 */
const WEB_SCHEMES = ["http://", "https://"];

/** The URL when it is a web address, else undefined. */
export function webUrl(url: unknown): string | undefined {
  const s = typeof url === "string" ? url.trim() : "";
  return WEB_SCHEMES.some((scheme) => s.toLowerCase().startsWith(scheme)) ? s : undefined;
}
