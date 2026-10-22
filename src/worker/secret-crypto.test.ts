import { describe, expect, it } from "vitest";
import { openSecret, sealSecret } from "./secret-crypto.ts";

const KEY = btoa(String.fromCharCode(...new Uint8Array(32).map((_, i) => i * 7)));

describe("secret answers at rest", () => {
  it("round-trips, never stores the plaintext, and needs the right key", async () => {
    const sealed = await sealSecret(KEY, "hunter2-密码");
    expect(sealed).not.toBeNull();
    expect(JSON.stringify(sealed)).not.toContain("hunter2");
    expect(await openSecret(KEY, sealed!.iv, sealed!.ct)).toBe("hunter2-密码");
    const other = btoa(String.fromCharCode(...new Uint8Array(32).fill(1)));
    expect(await openSecret(other, sealed!.iv, sealed!.ct)).toBeNull();
  });

  it("without a key (or with none) nothing can be sealed", async () => {
    expect(await sealSecret(undefined, "x")).toBeNull();
    expect(await sealSecret("none", "x")).toBeNull();
    expect(await sealSecret(btoa("short"), "x")).toBeNull();
  });
});
