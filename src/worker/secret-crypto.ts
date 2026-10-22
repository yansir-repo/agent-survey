/** Encryption for secret answers (shared/secret.ts): WebCrypto only, so it runs in the Worker and in tests. */
/**
 * AES-GCM with the 32-byte key in `SECRETS_KEY` (base64). The Durable Object's storage only ever holds the
 * ciphertext; without the key (or with `none`) secrets cannot be stored at all.
 */
const secretKey = (b64: string | undefined): Promise<CryptoKey | null> => {
  const raw = (b64 ?? "").trim();
  if (!raw || raw === "none") return Promise.resolve(null);
  const bytes = Uint8Array.from(atob(raw), (c) => c.charCodeAt(0));
  return bytes.length === 32
    ? crypto.subtle
        .importKey("raw", bytes, "AES-GCM", false, ["encrypt", "decrypt"])
        .catch(() => null)
    : Promise.resolve(null);
};
const toB64 = (b: ArrayBuffer | Uint8Array): string =>
  btoa(String.fromCharCode(...new Uint8Array(b instanceof Uint8Array ? b : new Uint8Array(b))));
const fromB64 = (s: string): Uint8Array<ArrayBuffer> =>
  Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export const sealSecret = (keyB64: string | undefined, plain: string) =>
  secretKey(keyB64).then((key) => {
    if (!key) return null;
    const iv = crypto.getRandomValues(new Uint8Array(12));
    return crypto.subtle
      .encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(plain))
      .then((ct) => ({ iv: toB64(iv), ct: toB64(ct) }));
  });

export const openSecret = (keyB64: string | undefined, iv: string, ct: string) =>
  secretKey(keyB64).then((key) =>
    key
      ? crypto.subtle
          .decrypt({ name: "AES-GCM", iv: fromB64(iv) }, key, fromB64(ct))
          .then((pt) => new TextDecoder().decode(pt))
          .catch(() => null)
      : null,
  );
