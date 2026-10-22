/**
 * Answers the respondent must not have read back: passwords, account logins. The value is encrypted at
 * rest in the interview's own storage and never written into the answers table — that table holds only
 * `SECRET_MARKER`. Everything that reads answers (the interviewer's context, the record, the result, the
 * respondent's own page, the admin snapshot) therefore sees the marker and nothing else, by
 * construction. Only the inquirer's reveal endpoint (Bearer) decrypts, and it records when it did.
 */
export const SECRET_MARKER = "[已填写·加密保存]";
export const MAX_SECRET = 500;
export const isSecretMarker = (v: unknown): boolean => v === SECRET_MARKER;
