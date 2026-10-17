/**
 * 客户端：一个访谈页。服务端是唯一的真相（轮次、答案、文件都在访谈者的 Durable Object 里），这里只渲染它给的 InterviewView，
 * 把客户的输入存回去（答一题存一题）。没有框架：一个 render()，输入时只更新这一题的底部，不重绘（否则光标和富文本选区会丢）。
 */
import "./style.css";
import type { FileInfo, InterviewView } from "../shared/api.ts";
import { acceptFor, acceptsKind, formatsText, rejectReason } from "../shared/files.ts";
import {
  OTHER_PREFIX,
  isOther,
  otherText,
  validateAnswer,
  type Question,
  type Value,
} from "../shared/questions.ts";
import { richText, sanitizeRich } from "../shared/rich.ts";

const KIND_NAME: Record<Question["kind"], string> = {
  single: "单选",
  multi: "多选",
  number: "数字",
  text: "文字",
  long: "多行文字",
  rich: "富文本",
  link: "链接",
  image: "图片",
  file: "文档",
};

const base = location.pathname.replace(/\/$/, "");
const api = `${base}/api`;
const $ = <T extends HTMLElement = HTMLElement>(s: string, el: ParentNode = document): T | null =>
  el.querySelector<T>(s);
const esc = (s: unknown): string =>
  String(s).replace(
    /[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] ?? c,
  );

// ---- 状态 ----

let view: InterviewView | null = null;
/** 现在屏幕上每道题的内容（还没存的也在这里）。 */
let values: Record<string, Value> = {};
let skipped = new Set<string>();
let roundId: string | null = null;
const errors: Record<string, string> = {};
const thumbs = new Map<string, string>();
let uploading = new Set<string>();
let submitting = false;
let pollTimer: number | undefined;
const saveTimers: Record<string, number | undefined> = {};
const flashTimers: Record<string, number | undefined> = {};

const request = async <T>(
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; data: T }> => {
  const res = await fetch(`${api}${path}`, {
    method,
    headers: body === undefined ? {} : { "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: res.status, data: (await res.json().catch(() => ({}))) as T };
};

/** 单选/多选里“其他（自己写）”的输入框现在展开着的题（展开了但还没写字时，答案里还没有它）。 */
const otherOpen = new Set<string>();
const isOtherOpen = (q: Question): boolean => {
  const v = values[q.id];
  return (
    otherOpen.has(q.id) ||
    (typeof v === "string" && isOther(v)) ||
    (Array.isArray(v) && v.some((x) => isOther(String(x))))
  );
};

/** 这一轮底部“还有想补充的”里写的字。 */
let noteText = "";
let noteTimer: number | undefined;
const saveNote = (): void => {
  window.clearTimeout(noteTimer);
  noteTimer = window.setTimeout(() => {
    if (roundId) void request("PUT", `/rounds/${roundId}/note`, { text: noteText });
  }, 600);
};

const questions = (): ReadonlyArray<Question> => view?.round?.questions ?? [];
const hasContent = (q: Question): boolean => {
  const v = values[q.id];
  if (v === undefined) return false;
  if (q.kind === "single" || q.kind === "multi") {
    // 只写了“其他：”还没写字，不算答了；多选里别的选项照算
    return q.kind === "single"
      ? validateAnswer(q, v).ok
      : Array.isArray(v) && v.some((x) => !isOther(String(x)) || otherText(String(x)) !== "");
  }
  if (q.kind === "rich") return richText(String(v)) !== "";
  if (Array.isArray(v)) return v.some((x) => String(x).trim() !== "");
  return String(v).trim() !== "";
};
const isSkipped = (q: Question): boolean => skipped.has(q.id) && !hasContent(q);
const filesOf = (qid: string): FileInfo[] => (view?.files ?? []).filter((f) => f.qid === qid);

// ---- 服务端同步 ----

const adopt = (v: InterviewView): void => {
  view = v;
  if ((v.round?.id ?? null) !== roundId) {
    roundId = v.round?.id ?? null;
    values = { ...v.answers } as Record<string, Value>;
    skipped = new Set(v.skipped);
    noteText = v.note;
  }
};

const refresh = async (): Promise<void> => {
  const { status, data } = await request<InterviewView>("GET", "/state");
  if (status === 200) adopt(data);
  schedulePoll();
  render();
};

const schedulePoll = (): void => {
  window.clearTimeout(pollTimer);
  if (view?.phase === "thinking" && !view.error)
    pollTimer = window.setTimeout(() => void refresh(), 2200);
};

const save = (q: Question): void => {
  window.clearTimeout(saveTimers[q.id]);
  saveTimers[q.id] = window.setTimeout(async () => {
    const empty = !hasContent(q);
    const value = empty ? null : (values[q.id] ?? null);
    if (!empty) {
      const checked = validateAnswer(q, value);
      if (!checked.ok) {
        // 还没写完整（比如网址写了一半）：不存，也不报错，等客户写完；离开输入框时才提示
        return;
      }
    }
    const { status, data } = await request<{ ok: boolean; error?: string }>(
      "PUT",
      `/answers/${q.id}`,
      empty && skipped.has(q.id) ? { skipped: true } : { value },
    );
    if (status === 200 && data.ok) {
      delete errors[q.id];
      flash(q.id);
    } else if (data.error) {
      errors[q.id] = data.error;
      refreshQ(q);
    }
  }, 500);
};

const flash = (qid: string): void => {
  const el = $(`#${CSS.escape(qid)} .flash`);
  if (!el) return;
  el.textContent = "✓ 已保存";
  el.classList.add("show");
  window.clearTimeout(flashTimers[qid]);
  flashTimers[qid] = window.setTimeout(() => el.classList.remove("show"), 1500);
};

// ---- 渲染 ----

const render = (): void => {
  const app = $("#app");
  if (!app) return;
  if (!view) {
    app.innerHTML = `<div class="center"><div class="thinking"><div class="spin"></div>正在打开……</div></div>`;
    return;
  }
  const v = view;
  const badge = $("#deferredCount");
  if (badge) badge.textContent = String(v.deferred.length);
  if (v.phase === "thinking") {
    app.innerHTML = `<div class="center"><div class="thinking"><div class="spin"></div>${
      v.error
        ? `${esc(v.error)} <button class="pill-btn btn-retry" data-act="resume">重试</button>`
        : v.history.length
          ? "正在消化你的回答，想下一组问题……"
          : "正在准备第一组问题……"
    }</div></div>`;
    return;
  }
  if (v.phase === "done") {
    app.innerHTML = `<div class="center"><h1>访谈完成，谢谢 🎉</h1>
      <p class="lead">我们已经把需要的都搞懂了，接下来会整理成项目资料，然后进入“规划结构”。</p>
      ${v.understanding.length ? `<div class="summary"><h3>我的理解</h3><ul>${v.understanding.map((u) => `<li><b>${esc(u.topic)}：</b>${esc(u.text)}</li>`).join("")}</ul></div>` : ""}
      ${v.unanswered.length ? `<div class="summary"><h3>仍待确认（你没答的，我们不会替你编；之后会再向你确认）</h3><ul>${v.unanswered.map((q) => `<li>${esc(q.title)}</li>`).join("")}</ul></div>` : ""}</div>`;
    return;
  }
  const round = v.round;
  if (!round) return;
  const cp = round.kind === "checkpoint";
  const label = roundLabel(round.kind, round.seq, v.stage);
  app.innerHTML = `<div class="wrap"><main${cp ? ' class="cp"' : ""}>
      <div class="round-head"><h1>${label}</h1><span class="tag">${cp ? "一眼看过去，对的点“对”，不对的点最后那个自己写" : `${round.questions.length} 个问题${round.kind === "deferred" ? "" : " · 我问清楚就停，不设固定轮数"}`}</span></div>
      ${stageHtml(v)}
      <p class="lead">${esc(round.intro)}</p>
      ${round.questions.map((q, i) => qHtml(q, i)).join("")}
      <details class="note-more"${noteText ? " open" : ""}><summary>还有想补充的？</summary>
        <textarea rows="3" data-note maxlength="2000" placeholder="这一轮还有什么想让我们知道的，都可以写在这里（选填）">${esc(noteText)}</textarea></details>
    </main><aside>
      <div class="box"><h3>访谈记录</h3>${historyHtml(v)}</div>
      <div class="box"><h3>我现在的理解</h3><ul class="know">${v.understanding.map((u) => `<li><span class="k">${esc(u.topic)}：</span>${esc(u.text)}<span class="wrong" data-act="wrong">不对？</span></li>`).join("")}</ul></div>
      <div class="note">答一题存一题，关掉页面也不会丢；一个字都没写的题，可以“稍后再答”。</div>
    </aside></div>
    <div class="bar"><div class="bar-in"><div class="status"></div><div class="grow"></div>
      <button class="primary" id="submit" data-act="submit">${round.kind === "deferred" ? "提交补答" : "提交本轮，继续"}</button></div></div>`;
  refreshBar();
};

const roundLabel = (
  kind: "agent" | "deferred" | "checkpoint",
  seq: number,
  stage: InterviewView["stage"],
): string =>
  kind === "deferred"
    ? "回头补答"
    : kind === "checkpoint"
      ? `第 ${stage?.number ?? ""} 阶段小结`
      : `第 ${seq} 轮`;

/**
 * 阶段倒计时：系统数的，所以诚实——它只说“这个阶段还剩几轮”，不声称总共多少轮。
 * 淡淡的一行：十个点，走到哪个点亮到哪个；检查点那一轮是“这一阶段做完了”。
 */
const stageHtml = (v: InterviewView): string => {
  const s = v.stage;
  if (!s) return "";
  if (s.checkpoint)
    return `<div class="stage done">✓ 第 ${s.number} 阶段完成——${s.of} 轮问完了。看一眼我听到的，对不对？</div>`;
  // 满 of 轮之后，小结的时机由 agent 选（把手头这一块问完），所以后面不再画“还剩几轮”，只说第几轮、快有小结了
  if (s.round > s.of)
    return `<div class="stage">第 ${s.number} 阶段 · 第 ${s.round} 轮 · 把手头这一块问完，我就给你一份小结</div>`;
  const dots = Array.from({ length: s.of }, (_, i) => (i < s.round ? "●" : "○")).join("");
  const left = s.of - s.round;
  return `<div class="stage">第 ${s.number} 阶段 <span class="dots">${dots}</span> ${left === 0 ? "满十轮了，问完手头这一块我就给你一份小结" : `再问大约 ${left} 轮，我给你一份小结`}</div>`;
};

/** 访谈记录：一两百轮时只列最近几轮，更早的折成一行（按阶段数）。 */
const HISTORY_SHOWN = 6;
const historyHtml = (v: InterviewView): string => {
  const row = (
    kind: "agent" | "deferred" | "checkpoint",
    seq: number,
    stage: InterviewView["stage"],
  ) => (kind === "checkpoint" ? `阶段小结` : roundLabel(kind, seq, stage));
  const older = v.history.slice(0, Math.max(0, v.history.length - HISTORY_SHOWN));
  const rows: string[] = [];
  if (older.length) {
    const stages = older.filter((h) => h.kind === "checkpoint").length;
    rows.push(
      `<div class="hist older">更早的 ${older.length} 轮${stages ? `（含 ${stages} 次阶段小结）` : ""}</div>`,
    );
  }
  for (const h of v.history.slice(-HISTORY_SHOWN))
    rows.push(
      `<div class="hist"><span class="hd"></span>${row(h.kind, h.seq, null)}<span class="hs">${h.questions} 题${h.skipped ? ` · 待补 ${h.skipped}` : ""}</span></div>`,
    );
  if (v.round)
    rows.push(
      `<div class="hist cur"><span class="hd"></span>${row(v.round.kind, v.round.seq, v.stage)}<span class="hs">进行中</span></div>`,
    );
  return rows.join("");
};

const bodyHtml = (q: Question): string => {
  const a = values[q.id];
  switch (q.kind) {
    case "long":
      return `<textarea rows="4" data-in="${q.id}" placeholder="${esc(q.placeholder ?? "")}">${esc(a ?? "")}</textarea>`;
    case "text":
      return `<input type="text" data-in="${q.id}" placeholder="${esc(q.placeholder ?? "")}" value="${esc(a ?? "")}">`;
    case "number":
      return `<div class="numrow"><input type="number" data-in="${q.id}" value="${esc(a ?? "")}">${q.unit ? `<span>${esc(q.unit)}</span>` : ""}</div>`;
    case "single":
    case "multi": {
      const picked = (o: string): boolean =>
        q.kind === "single" ? a === o : Array.isArray(a) && a.includes(o);
      const mine =
        q.kind === "single"
          ? typeof a === "string" && isOther(a)
            ? otherText(a)
            : ""
          : otherText(String(Array.isArray(a) ? (a.find((x) => isOther(String(x))) ?? "") : ""));
      const open = isOtherOpen(q);
      return `<div class="opts">${q.options
        .map(
          (o) =>
            `<button class="opt ${picked(o.label) ? "on" : ""}" data-${q.kind === "single" ? "pick" : "multi"}="${q.id}" data-v="${esc(o.label)}">${esc(o.label)}${o.hint ? `<span class="hint">${esc(o.hint)}</span>` : ""}</button>`,
        )
        .join(
          "",
        )}<button class="opt other ${open ? "on" : ""}" data-other="${q.id}">${q.otherLabel ?? (q.kind === "single" ? "其他（自己写）" : "补充一个选项")}</button></div>${
        open
          ? `<input type="text" class="other-in" data-otherin="${q.id}" maxlength="200" placeholder="写下你的答案" value="${esc(mine)}">`
          : ""
      }`;
    }
    case "rich":
      return `<div class="rich-box"><div class="rich-tools">
        <button type="button" data-cmd="bold" title="加粗"><b>B</b></button><button type="button" data-cmd="italic" title="斜体"><i>I</i></button>
        <span class="sep"></span><button type="button" data-cmd="insertUnorderedList" title="项目符号">•</button><button type="button" data-cmd="insertOrderedList" title="编号">1.</button>
        <span class="sep"></span><button type="button" data-cmd="createLink" title="链接">🔗</button><button type="button" data-cmd="removeFormat" title="清除格式">Tx</button></div>
        <div class="rich" contenteditable="true" data-rich="${q.id}" data-ph="${esc(q.placeholder ?? "")}">${sanitizeRich(String(a ?? ""))}</div></div>`;
    case "link": {
      const rows = Array.isArray(a) && a.length ? a : [""];
      return `<div>${rows.map((u, i) => `<div class="linkrow"><input type="url" data-link="${q.id}" data-i="${i}" placeholder="https://" value="${esc(u)}"></div>`).join("")}</div>${rows.length < (q.max ?? 5) ? `<button class="link" data-addlink="${q.id}">+ 再加一个</button>` : ""}`;
    }
    case "image":
    case "file": {
      const fs = filesOf(q.id);
      const what = q.kind === "image" ? "图片" : "文件";
      const list =
        q.kind === "image"
          ? `<div class="thumbs">${fs.map((f) => `<div class="thumb">${thumbs.get(f.path) ? `<img src="${thumbs.get(f.path)}" alt="">` : esc(f.name)}<button title="移除" data-rm="${esc(f.path)}">×</button></div>`).join("")}</div>`
          : `<div class="files">${fs.map((f) => `<div class="file"><span class="ico">${esc(f.name.split(".").pop()?.slice(0, 4).toUpperCase() ?? "")}</span><span>${esc(f.name)}${f.status === "ok" ? ` <span class="ok">已解析</span>` : ` <span class="note">没能解析：${esc(f.note ?? "")}</span>`}</span><span class="size">${sizeText(f.size)}</span><button title="移除" data-rm="${esc(f.path)}">×</button></div>`).join("")}</div>`;
      return `<div class="drop" data-drop="${q.id}">把${what}拖到这里，或点击选择（可以一次选多个）<br><small>${esc(formatsText(q.kind))}</small></div>
        <input type="file" hidden multiple accept="${acceptFor(q.kind)}" data-file="${q.id}">
        ${uploading.has(q.id) ? `<div class="uploading">上传并解析中……</div>` : ""}${list}`;
    }
  }
};

const sizeText = (n: number): string =>
  n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;

const footHtml = (q: Question): string =>
  q.optional === true && !hasContent(q)
    ? "" // 选填：空着就是空着，不用“稍后再答”
    : isSkipped(q)
      ? `<div class="skipped-note">已放到“稍后再答”，一个都不会丢——访谈最后我们会再带你过一遍。<button class="link" data-unskip="${q.id}">现在就答</button></div>`
      : hasContent(q)
        ? ""
        : `<div class="q-foot"><button class="link" data-skip="${q.id}">不确定，稍后再答</button></div>`;

const qClass = (q: Question): string => (hasContent(q) ? "filled" : isSkipped(q) ? "skipped" : "");

const qHtml = (q: Question, i: number): string =>
  `<section class="q ${qClass(q)}" id="${q.id}">
    <div class="q-top"><span class="num">${hasContent(q) ? "✓" : i + 1}</span>
      <div><div class="q-title">${esc(q.title)}<span class="kind">${KIND_NAME[q.kind]}</span>${q.optional === true ? `<span class="kind opt-tag">选填</span>` : ""}</div><div class="q-why">${esc(q.why)}</div></div></div>
    <div class="q-body">${bodyHtml(q)}</div>
    <div class="err">${esc(errors[q.id] ?? "")}</div>
    <div class="q-foot-wrap">${footHtml(q)}</div><span class="flash"></span></section>`;

/** 输入时只更新这一题的底部和底栏，不重绘整题。 */
const refreshQ = (q: Question): void => {
  const el = $(`#${CSS.escape(q.id)}`);
  if (!el) return;
  if (hasContent(q)) skipped.delete(q.id);
  el.className = `q ${qClass(q)}`;
  $(".num", el)!.textContent = hasContent(q) ? "✓" : String(questions().indexOf(q) + 1);
  $(".q-foot-wrap", el)!.innerHTML = footHtml(q);
  $(".err", el)!.textContent = errors[q.id] ?? "";
  refreshBar();
};

const refreshBar = (): void => {
  const qs = questions();
  const filled = qs.filter(hasContent).length;
  const sk = qs.filter(isSkipped).length;
  const st = $(".bar .status");
  if (st)
    st.innerHTML = `已填 <b>${filled}</b> / ${qs.length}${sk ? ` · 稍后再答 <b>${sk}</b>` : ""}`;
  const b = $<HTMLButtonElement>("#submit");
  if (b)
    b.disabled =
      submitting ||
      uploading.size > 0 ||
      !(
        view?.round?.kind === "deferred" ||
        qs.every((q) => q.optional === true || hasContent(q) || isSkipped(q))
      );
};

// ---- 事件（委托）----

const find = (id: string): Question | undefined => questions().find((q) => q.id === id);

const setValue = (q: Question, v: Value | undefined): void => {
  if (v === undefined) delete values[q.id];
  else values[q.id] = v;
  if (hasContent(q)) skipped.delete(q.id);
  delete errors[q.id];
};

document.addEventListener("click", (e) => {
  const t = e.target as HTMLElement;
  const el = t.closest<HTMLElement>(
    "[data-act],[data-pick],[data-multi],[data-other],[data-skip],[data-unskip],[data-addlink],[data-rm],[data-drop]",
  );
  if (!el) return;
  const d = el.dataset;
  if (d["act"] === "wrong") return toast("可以直接告诉我们哪里不对，我们会改");
  if (d["act"] === "resume") return void request("POST", "/resume").then(refresh);
  if (d["act"] === "submit") return void submit();
  if (d["pick"]) {
    const q = find(d["pick"]);
    if (!q) return;
    otherOpen.delete(q.id); // 选了一个现成的选项，“自己写”就收起来
    setValue(q, values[q.id] === d["v"] ? undefined : (d["v"] as string)); // 再点一次已选的 = 取消
    save(q);
    render();
    return;
  }
  if (d["other"]) {
    const q = find(d["other"]);
    if (!q) return;
    if (isOtherOpen(q)) {
      // 收起：自己写的那条拿掉（单选就是清空答案）
      otherOpen.delete(q.id);
      const v = values[q.id];
      if (q.kind === "single") setValue(q, typeof v === "string" && isOther(v) ? undefined : v);
      else {
        const rest = (Array.isArray(v) ? v : []).filter((x) => !isOther(String(x)));
        setValue(q, rest.length ? rest : undefined);
      }
    } else {
      otherOpen.add(q.id);
      if (q.kind === "single") delete values[q.id]; // 单选：写自己的，就不再选现成的
    }
    save(q);
    render();
    $<HTMLInputElement>(`[data-otherin="${q.id}"]`)?.focus();
    return;
  }
  if (d["multi"]) {
    const q = find(d["multi"]);
    if (!q) return;
    const cur = new Set((values[q.id] as string[] | undefined) ?? []);
    if (cur.has(d["v"]!)) cur.delete(d["v"]!);
    else cur.add(d["v"]!);
    setValue(q, cur.size ? [...cur] : undefined);
    save(q);
    render();
    return;
  }
  if (d["skip"]) {
    const q = find(d["skip"]);
    if (!q) return;
    skipped.add(q.id);
    void request("PUT", `/answers/${q.id}`, { skipped: true });
    toast("已放到“稍后再答”");
    render();
    return;
  }
  if (d["unskip"]) {
    const q = find(d["unskip"]);
    if (!q) return;
    skipped.delete(q.id);
    void request("PUT", `/answers/${q.id}`, { value: null });
    render();
    return;
  }
  if (d["addlink"]) {
    const q = find(d["addlink"]);
    if (!q) return;
    values[q.id] = [...((values[q.id] as string[] | undefined) ?? [""]), ""];
    render();
    return;
  }
  if (d["rm"]) return void removeFile(d["rm"]);
  if (d["drop"]) $<HTMLInputElement>(`[data-file="${d["drop"]}"]`)?.click();
});

document.addEventListener("input", (e) => {
  const t = e.target as HTMLInputElement & HTMLElement;
  if (t.dataset["note"] !== undefined) {
    noteText = t.value;
    saveNote();
    return;
  }
  const otherQ = t.dataset["otherin"] ? find(t.dataset["otherin"]) : undefined;
  if (otherQ) {
    const text = t.value.trim();
    if (otherQ.kind === "single") setValue(otherQ, text ? OTHER_PREFIX + text : undefined);
    else {
      const rest = ((values[otherQ.id] as string[] | undefined) ?? []).filter((x) => !isOther(x));
      setValue(otherQ, text ? [...rest, OTHER_PREFIX + text] : rest.length ? rest : undefined);
    }
    save(otherQ);
    refreshQ(otherQ);
    return;
  }
  const qid = t.dataset["in"] ?? t.dataset["rich"] ?? t.dataset["link"];
  if (!qid) return;
  const q = find(qid);
  if (!q) return;
  if (t.dataset["in"])
    setValue(q, q.kind === "number" ? (t.value === "" ? undefined : Number(t.value)) : t.value);
  else if (t.dataset["rich"]) setValue(q, t.innerHTML);
  else {
    const arr = [...((values[q.id] as string[] | undefined) ?? [""])];
    arr[Number(t.dataset["i"])] = t.value;
    setValue(q, arr);
  }
  save(q);
  refreshQ(q);
});

// 链接：离开输入框时才提示“不像网址”（写到一半不打扰）
document.addEventListener("focusout", (e) => {
  const t = e.target as HTMLInputElement;
  const qid = t.dataset?.["link"];
  if (!qid) return;
  const q = find(qid);
  if (!q || !hasContent(q)) return;
  const checked = validateAnswer(q, values[q.id]);
  if (!checked.ok) {
    errors[q.id] = checked.error;
    refreshQ(q);
  }
});

// 富文本工具栏：mousedown 不抢走编辑区的选区
document.addEventListener("mousedown", (e) => {
  const b = (e.target as HTMLElement).closest<HTMLElement>("[data-cmd]");
  if (!b) return;
  e.preventDefault();
  const box = b.closest(".rich-box");
  const editor = box && $<HTMLElement>("[data-rich]", box);
  if (!editor) return;
  let arg: string | undefined;
  if (b.dataset["cmd"] === "createLink") {
    const u = prompt("链接地址", "https://");
    if (!u) return;
    arg = u;
  }
  editor.focus();
  document.execCommand(b.dataset["cmd"]!, false, arg);
  editor.dispatchEvent(new Event("input", { bubbles: true }));
});

document.addEventListener("change", (e) => {
  const t = e.target as HTMLInputElement;
  const qid = t.dataset?.["file"];
  if (!qid || !t.files) return;
  void upload(qid, [...t.files]);
  t.value = "";
});
document.addEventListener("dragover", (e) => {
  const d = (e.target as HTMLElement).closest<HTMLElement>("[data-drop]");
  if (!d) return;
  e.preventDefault();
  d.classList.add("over");
});
document.addEventListener("dragleave", (e) =>
  (e.target as HTMLElement).closest?.("[data-drop]")?.classList.remove("over"),
);
document.addEventListener("drop", (e) => {
  const d = (e.target as HTMLElement).closest<HTMLElement>("[data-drop]");
  if (!d) return;
  e.preventDefault();
  d.classList.remove("over");
  void upload(d.dataset["drop"]!, [...(e.dataTransfer?.files ?? [])]);
});
// 拖到页面别处时不要让浏览器把文件打开
for (const ev of ["dragover", "drop"] as const)
  window.addEventListener(ev, (e) => e.preventDefault());

// ---- 上传 / 提交 ----

const upload = async (qid: string, files: File[]): Promise<void> => {
  const q = find(qid);
  if (!q || (q.kind !== "file" && q.kind !== "image") || files.length === 0) return;
  const refused: string[] = [];
  const ok = files.filter((f) => {
    const why =
      rejectReason(f.name, f.size) ?? (acceptsKind(q.kind, f.name) ? null : "这道题只收图片");
    if (why) refused.push(`${f.name}：${why}`);
    return why === null;
  });
  errors[qid] = refused.join("；");
  if (ok.length === 0) return refreshQ(q);
  uploading.add(qid);
  render();
  const form = new FormData();
  for (const f of ok) form.append("file", f);
  const res = await fetch(`${api}/files?qid=${encodeURIComponent(qid)}`, {
    method: "POST",
    body: form,
  }).catch(() => null);
  const data = (await res?.json().catch(() => null)) as {
    ok: boolean;
    error?: string;
    results?: Array<{ name: string; ok: boolean; error?: string; path?: string }>;
  } | null;
  uploading.delete(qid);
  const problems = [...refused];
  if (!data || !data.ok) problems.push(data?.error ?? "上传失败，请重试");
  for (const r of data?.results ?? []) {
    if (!r.ok) problems.push(`${r.name}：${r.error}`);
    else if (q.kind === "image" && r.path) {
      const f = ok.find((x) => x.name === r.name);
      if (f) thumbs.set(r.path, URL.createObjectURL(f));
    }
  }
  errors[qid] = problems.join("；");
  await refresh();
  // 这道题的答案 = 这道题下现在所有文件的路径（先 refresh，files 才是最新的）
  const paths = filesOf(qid).map((f) => f.path);
  const cur = find(qid);
  if (cur) {
    setValue(cur, paths.length ? paths : undefined);
    save(cur);
    render();
  }
};

const removeFile = async (path: string): Promise<void> => {
  await fetch(`${api}/files?path=${encodeURIComponent(path)}`, { method: "DELETE" });
  const qid = view?.files.find((f) => f.path === path)?.qid;
  await refresh();
  const q = qid ? find(qid) : undefined;
  if (q) {
    const rest = filesOf(q.id).map((f) => f.path);
    setValue(q, rest.length ? rest : undefined);
    render();
  }
};

const submit = async (): Promise<void> => {
  const round = view?.round;
  if (!round || submitting) return;
  // 先把还在等防抖的保存冲掉，保证服务端拿到的就是屏幕上的
  window.clearTimeout(noteTimer);
  await request("PUT", `/rounds/${round.id}/note`, { text: noteText });
  for (const q of round.questions) {
    window.clearTimeout(saveTimers[q.id]);
    const v = hasContent(q) ? (values[q.id] ?? null) : null;
    if (v !== null) await request("PUT", `/answers/${q.id}`, { value: v });
  }
  submitting = true;
  refreshBar();
  const { status, data } = await request<{ ok: boolean; error?: string }>(
    "POST",
    `/rounds/${round.id}/submit`,
  );
  submitting = false;
  if (status !== 200 || !data.ok) {
    toast(data.error ?? "提交失败，请重试");
    return refreshBar();
  }
  roundId = null;
  await refresh();
  window.scrollTo(0, 0);
};

// ---- 杂项 ----

let toastTimer: number | undefined;
const toast = (m: string): void => {
  const t = $("#toast");
  if (!t) return;
  t.textContent = m;
  t.classList.add("show");
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => t.classList.remove("show"), 1800);
};

$("#deferredBtn")?.addEventListener("click", () => {
  const list = view?.deferred ?? [];
  $("#drawer")!.innerHTML =
    `<button class="pill-btn close" data-close>关闭</button><h2>稍后再答</h2>
    <div class="why" style="color:var(--mute)">你放到这里的问题都在，一个都不会丢。访谈最后我们会再带你过一遍。</div>
    ${list.length ? list.map((q) => `<div class="row"><div class="t">${esc(q.title)}</div><div class="why">${esc(q.why)}</div></div>`).join("") : `<div class="row">目前没有。</div>`}`;
  $("#mask")!.classList.add("open");
});
$("#mask")?.addEventListener("click", (e) => {
  const t = e.target as HTMLElement;
  if (t.id === "mask" || t.dataset["close"] !== undefined) $("#mask")!.classList.remove("open");
});

void refresh();
