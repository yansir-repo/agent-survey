import { bindings, defineConfig, exports } from "cf/config";

/**
 * The Worker's single runtime fact source. `cf dev` simulates D1 / R2 / the Durable Object locally under
 * `.cloudflare/state`; Workers AI (toMarkdown) is remote-only, so it is not bound in development.
 */
export default defineConfig((ctx) => ({
  accountId: "d1da6c26f60e13fb006a3d4b5dae3f09",
  worker: {
    name: "grill-me",
    compatibilityDate: "2026-09-08",
    compatibilityFlags: ["nodejs_compat"],
    entrypoint: "src/worker/index.ts",
    observability: { enabled: true },
    workersDev: true,
    previewUrls: false,
    assets: {
      // The interview page is only ever served by the Worker, behind its key.
      notFoundHandling: "none",
      runWorkerFirst: ["/", "/i/*", "/admin/*"],
    },
    // 访谈者：每个访谈一个 Think Durable Object（SQLite 存轮次、答案、对话和工作区文件）。
    exports: {
      Interviewer: exports.durableObject({ storage: "sqlite" }),
    },
    env: {
      Interviewer: bindings.durableObject({ worker: "grill-me", exportName: "Interviewer" }),
      DB: bindings.d1({ name: "grill-me", id: "55b344f6-d4b7-4bbe-bee5-b757cac93c1c" }),
      // 客户上传的原件（按 访谈/路径 存放）；转成 Markdown 的文字在访谈者的工作区里。
      FILES: bindings.r2({ name: "grill-me-files" }),
      ASSETS: bindings.assets(),
      // Workers AI 的 toMarkdown：PDF / Office / 图片 / HTML 转 Markdown。开发模式下没有（Workers AI 只能远程）。
      ...(ctx.mode === "development" ? {} : { AI: bindings.ai() }),
      DEEPSEEK_API_KEY: bindings.secret(),
      // 其他模型（Claude / GPT）走 AIHubMix（OpenAI 兼容的聚合接口）。线上不配真密钥时填 none，只有 DeepSeek 可用。
      AIHUBMIX_API_KEY: bindings.secret(),
      DEEPSEEK_MODEL: bindings.text("deepseek-flash"),
      // 运营接口（创建访谈、看进度）的凭证：Authorization: Bearer <ADMIN_TOKEN>。见 AGENTS.md。
      ADMIN_TOKEN: bindings.secret(),
      PUBLIC_URL: bindings.text(
        ctx.mode === "development"
          ? "http://localhost:5173"
          : "https://grill-me.yansir.workers.dev",
      ),
    },
  },
}));
