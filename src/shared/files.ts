/**
 * 上传文件的规则：能收什么、多大、存在哪个路径。纯函数，客户端（拖进来时先挡）和服务端（落库前再挡）共用。
 *
 * 能收的格式 = Workers AI 的 toMarkdown 能转的（官方清单，`/admin/formats` 会对照线上 `supported()` 报告漂移）+ 纯文本。
 * 不收：压缩包（MVP 不解压）、视频，以及 toMarkdown 不认的旧版 .doc / .ppt / .rtf（请受访者另存为 docx / pptx / PDF）。
 */

export const MAX_FILE_BYTES = 20 * 1024 * 1024;

export const IMAGE_EXT = ["jpg", "jpeg", "png", "webp", "svg", "gif", "bmp"] as const;
/** toMarkdown 支持的文档类 + 我们自己直接读的纯文本。 */
export const DOC_EXT = [
  "pdf",
  "docx",
  "xlsx",
  "xlsm",
  "xlsb",
  "xls",
  "et",
  "ods",
  "odt",
  "csv",
  "numbers",
  "pptx",
  "ppsx",
  "potx",
  "pptm",
  "ppsm",
  "odp",
  "otp",
  "html",
  "htm",
  "xml",
] as const;
export const TEXT_EXT = ["txt", "md", "json"] as const;

export type FileClass = "image" | "doc" | "text";

export const extOf = (name: string): string => {
  const i = name.lastIndexOf(".");
  return i < 0 ? "" : name.slice(i + 1).toLowerCase();
};

export const classify = (name: string): FileClass | null => {
  const e = extOf(name);
  if ((IMAGE_EXT as ReadonlyArray<string>).includes(e)) return "image";
  if ((DOC_EXT as ReadonlyArray<string>).includes(e)) return "doc";
  if ((TEXT_EXT as ReadonlyArray<string>).includes(e)) return "text";
  return null;
};

/** 给受访者看的“收不了”的原因（agent 也读得到）。 */
export const rejectReason = (
  name: string,
  bytes: number,
  maxBytes: number = MAX_FILE_BYTES,
): string | null => {
  if (bytes <= 0) return "文件是空的";
  if (bytes > maxBytes) return `超过 ${maxBytes / 1024 / 1024}MB`;
  if (classify(name) !== null) return null;
  const e = extOf(name);
  if (["zip", "rar", "7z", "tar", "gz"].includes(e)) return "暂不支持压缩包，请把文件分别上传";
  if (["mp4", "mov", "avi", "mkv", "webm", "mp3", "wav", "m4a"].includes(e))
    return "暂不支持视频和音频";
  if (["ppt", "doc", "rtf", "pages", "key"].includes(e))
    return "暂不支持这种旧格式，请另存为 PDF、docx 或 pptx 再上传";
  return "暂不支持这种格式";
};

/** `accept` 属性：问题类型决定收什么（图片题只收图片，文档题收文档和文本）。 */
export const acceptFor = (kind: "image" | "file"): string =>
  (kind === "image" ? IMAGE_EXT : [...DOC_EXT, ...TEXT_EXT]).map((e) => `.${e}`).join(",");

/** 上传框里给受访者看的格式说明（来自同一份清单，agent 不另写）。 */
export const formatsText = (kind: "image" | "file"): string =>
  kind === "image"
    ? `支持 JPG、PNG、WebP、SVG、GIF、BMP；单个不超过 ${MAX_FILE_BYTES / 1024 / 1024}MB；可以一次选多张`
    : `支持 PDF、Word（docx）、PowerPoint（pptx）、Excel / CSV、HTML、纯文本、JSON 和图片；暂不支持压缩包、视频和旧版 .doc / .ppt；单个不超过 ${MAX_FILE_BYTES / 1024 / 1024}MB；可以一次选多个`;

export const acceptsKind = (kind: "image" | "file", name: string): boolean => {
  const c = classify(name);
  return kind === "image" ? c === "image" : c === "doc" || c === "text" || c === "image";
};

/** 扩展名 → MIME。toMarkdown 要 Blob 带类型（空类型会被拒：“expected string to have >=1 characters”），浏览器给的 type 不一定有。 */
const MIME: Record<string, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  xlsm: "application/vnd.ms-excel.sheet.macroenabled.12",
  xlsb: "application/vnd.ms-excel.sheet.binary.macroenabled.12",
  xls: "application/vnd.ms-excel",
  et: "application/vnd.ms-excel",
  ods: "application/vnd.oasis.opendocument.spreadsheet",
  odt: "application/vnd.oasis.opendocument.text",
  odp: "application/vnd.oasis.opendocument.presentation",
  otp: "application/vnd.oasis.opendocument.presentation-template",
  csv: "text/csv",
  numbers: "application/vnd.apple.numbers",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ppsx: "application/vnd.openxmlformats-officedocument.presentationml.slideshow",
  potx: "application/vnd.openxmlformats-officedocument.presentationml.template",
  pptm: "application/vnd.ms-powerpoint.presentation.macroenabled.12",
  ppsm: "application/vnd.ms-powerpoint.slideshow.macroenabled.12",
  html: "text/html",
  htm: "text/html",
  xml: "application/xml",
  txt: "text/plain",
  md: "text/markdown",
  json: "application/json",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  svg: "image/svg+xml",
  gif: "image/gif",
  bmp: "image/bmp",
};
export const mimeOf = (name: string, given?: string): string =>
  MIME[extOf(name)] ?? (given && given !== "" ? given : "application/octet-stream");

/** 文件名净化：去掉路径和控制字符，限长，保留扩展名。 */
export const safeName = (name: string): string => {
  const raw = name.split(/[\\/]/).pop() ?? "";
  const base = raw
    .split("")
    .filter((c) => c.charCodeAt(0) > 31 && c.charCodeAt(0) !== 127 && !'<>:"|?*'.includes(c))
    .join("")
    .trim();
  const e = extOf(base);
  const stem = e ? base.slice(0, -(e.length + 1)) : base;
  const cut = stem.slice(0, Math.max(1, 100 - (e ? e.length + 1 : 0))).replace(/^\.+/, "");
  return `${cut || "file"}${e ? `.${e}` : ""}`;
};

/** 同名不覆盖：已有就加 -2、-3。 */
export const uniquePath = (dir: string, name: string, taken: ReadonlySet<string>): string => {
  const clean = safeName(name);
  if (!taken.has(dir + clean)) return dir + clean;
  const e = extOf(clean);
  const stem = e ? clean.slice(0, -(e.length + 1)) : clean;
  for (let n = 2; ; n++) {
    const p = `${dir}${stem}-${n}${e ? `.${e}` : ""}`;
    if (!taken.has(p)) return p;
  }
};

/** 转成 Markdown 后放在工作区的哪里：uploads/q1/a.pdf → uploads/q1/a.pdf.md（agent 读的是它）。 */
export const markdownPath = (path: string): string => `${path}.md`;
