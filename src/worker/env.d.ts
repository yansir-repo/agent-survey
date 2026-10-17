// Bindings and secrets the Worker reads (cloudflare.config.ts; `.dev.vars` locally, `--secrets-file` in production).
declare namespace Cloudflare {
  interface Env {
    Interviewer: DurableObjectNamespace<import("./interviewer.ts").Interviewer>;
    /** 访谈登记（migrations/）。 */
    DB: D1Database;
    /** 客户上传的原件。 */
    FILES: R2Bucket;
    /** The SPA shell, served after an interview's key checks out. */
    ASSETS: Fetcher;
    /** Workers AI (deployed only): toMarkdown. */
    AI?: Ai;
    DEEPSEEK_API_KEY: string;
    DEEPSEEK_MODEL: string;
    ADMIN_TOKEN: string;
    PUBLIC_URL: string;
  }
}
