-- profile → template, mission → goal (agent-survey: docs/design-agent-survey.md).
-- A template is a reusable interview template; `goal` is the snapshot of its goal text (plus whatever the caller appended
-- or overrode) taken when the interview was created. Existing rows keep their values.
ALTER TABLE interviews RENAME COLUMN profile TO template;
ALTER TABLE interviews RENAME COLUMN mission TO goal;
