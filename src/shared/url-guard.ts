/**
 * agent 要去看受访者给的网址：这是把“能访问的范围”从受访者的资料扩到整个互联网，所以先过这一关。
 * 只放行 http(s)、有点号的公网主机名；拒绝 IP 字面量、localhost、内网/本地后缀、带账号密码的地址、非常规端口。
 * 这是纯函数：重定向之后的最终地址也要再过一遍（调用方负责）。
 */
export type UrlCheck =
  | { readonly ok: true; readonly url: URL }
  | { readonly ok: false; readonly error: string };

const BLOCKED_SUFFIX = [".local", ".internal", ".localhost", ".lan", ".home", ".corp", ".intranet"];

export const checkPublicUrl = (raw: string): UrlCheck => {
  if (!URL.canParse(raw)) return { ok: false, error: "不是合法的网址" };
  const u = new URL(raw);
  if (u.protocol !== "http:" && u.protocol !== "https:")
    return { ok: false, error: "只能访问 http(s) 网址" };
  if (u.username || u.password) return { ok: false, error: "网址里不能带账号密码" };
  if (u.port !== "" && u.port !== "80" && u.port !== "443")
    return { ok: false, error: "不允许非常规端口" };
  const host = u.hostname.toLowerCase();
  if (host === "localhost" || BLOCKED_SUFFIX.some((s) => host.endsWith(s)))
    return { ok: false, error: "不允许访问内网地址" };
  if (
    /^\d{1,3}(\.\d{1,3}){3}$/.test(host) ||
    host.includes(":") ||
    host.startsWith("[") ||
    /^\d+$/.test(host) ||
    /^0x/i.test(host)
  )
    return { ok: false, error: "不允许直接用 IP 地址" };
  if (!host.includes(".")) return { ok: false, error: "不像公网网址" };
  return { ok: true, url: u };
};
