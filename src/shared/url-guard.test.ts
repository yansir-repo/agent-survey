import { describe, expect, it } from "vitest";
import { checkPublicUrl } from "./url-guard.ts";

describe("checkPublicUrl: what the agent may fetch", () => {
  it("allows ordinary public http(s) sites, with or without a path and query", () => {
    for (const u of [
      "https://example.com",
      "http://www.a-b.co.uk/x?y=1#z",
      "https://example.com:443/",
    ])
      expect(checkPublicUrl(u).ok).toBe(true);
  });

  it("refuses other schemes, credentials and odd ports", () => {
    for (const u of [
      "file:///etc/passwd",
      "ftp://a.test",
      "javascript:alert(1)",
      "https://u:p@a.test",
      "https://a.test:8080",
      "data:text/html,x",
    ])
      expect(checkPublicUrl(u).ok).toBe(false);
  });

  it("refuses localhost, private suffixes and every way of writing an IP", () => {
    for (const u of [
      "http://localhost/",
      "http://127.0.0.1/",
      "http://10.0.0.1/",
      "http://192.168.1.1/",
      "http://169.254.169.254/latest/meta-data",
      "http://[::1]/",
      "http://2130706433/",
      "http://0x7f000001/",
      "http://printer.local/",
      "http://db.internal/",
      "http://intranet/",
    ])
      expect(checkPublicUrl(u).ok, u).toBe(false);
  });

  it("garbage is an error, not an exception", () => {
    expect(checkPublicUrl("not a url").ok).toBe(false);
    expect(checkPublicUrl("").ok).toBe(false);
  });
});
