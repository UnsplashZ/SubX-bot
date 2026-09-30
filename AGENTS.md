# Repository Guidelines

## Code Change Confirmation Rule

- Local documentation-only edits can proceed without prior approval.
- Documentation-only edits include writing/updating local `.md` docs (for example `README.md`, `docs/**`, `AGENTS.md`, `CLAUDE.md`) with no code/config/script/test changes.
- Exception: governance documentation changes still require explicit user approval, including `AGENTS.md`, `CLAUDE.md`, and `docs/policies/**`.
- Any non-documentation code modification still requires explicit user approval first, including source files, scripts, configs, and tests.
- If a change mixes docs and code/config/script/test edits, get user approval before making any edits.
- Treat explicit approval as a hard gate: before approval is granted, do not perform any non-documentation write operation.
- Non-documentation write operations include direct edits and automated writes, such as `apply_patch`, shell redirection (`>`, `>>`), in-place edits (`sed -i`, `perl -pi`), formatters with write mode, and scripts that generate or rewrite code/config/test files.
- If approval is missing or ambiguous, stop at read-only analysis and ask for explicit authorization before editing.
- Approval scope is limited to the files/tasks that were clearly authorized; if scope changes, request authorization again before writing.

## Documentation Location Rule

- Default location for newly created work documents is `docs/plans/`.
- Work documents include analysis notes, implementation plans, review reports, investigation summaries, and execution records produced during an active request.
- Do **not** place new work documents directly under `docs/done/` unless the user explicitly asks for archival/completion placement.
- Moving a document from `docs/plans/` to `docs/done/` requires explicit user instruction.
- If the user explicitly specifies a target doc path/directory, follow the user instruction first.
- Keep date-prefixed naming for new work docs, e.g. `YYYY-MM-DD-topic.md`.

## Commit Message Rules

- Branch-aware subject format:
  - On `main` branch: `vxx.yy.zz <summary>`
  - On non-`main` branches: `<type>: <summary>`
- Allowed `<type>` values on non-`main` branches: `feat`, `fix`, `refactor`, `docs`, `test`, `chore`.
- On `main` branch, do not add type prefix in subject (`feat:`/`fix:`/etc.).
- Commit body is required by default for both `main` and non-`main` branches.
- If you intentionally omit commit body, get explicit user approval first.
- On `main` branch, before creating a commit, read the latest commit subject on `main`, parse `vxx.yy.zz` as the baseline version, then apply the bump policy below.
- If the latest `main` subject cannot be parsed as `vxx.yy.zz`, stop automatic version inference and require manual baseline version input from the user before committing.
- Version bump policy for `vxx.yy.zz`:
  - Minor bug fix or small feature adjustment: increment `zz` by 1
  - Major feature adjustment: increment `yy` by 1 and reset `zz` to `0`
  - `xx` remains unchanged by default unless explicitly decided
- Commit body formatting rule:
  - Use real newline characters; do not write literal `\n` inside a single `-m` string.
  - Prefer heredoc for multiline messages, for example:
    `git commit -F - <<'EOF' ... EOF`
  - If using `-m`, pass multiple `-m` flags for separate paragraphs instead of embedding escaped newlines.
- Examples:
  - `main`: `v1.4.3 修复订阅刷新超时问题`
  - non-`main`: `fix: 修复订阅刷新超时问题`

## Python Test Environment Rule

- Before running local Python tests, first check whether a local `venv` virtual environment exists.
- If `venv` exists, use that virtual environment for test execution.
- If `venv` does not exist, create it first and then run tests within that environment.

## Verification Before Completion Rule

- For any non-documentation change, run the smallest relevant verification before claiming completion.
- For Node.js changes, run the affected test file(s) or equivalent minimal verification command.
- For Python changes, run tests using the local `venv` per the Python Test Environment Rule.
- For frontend/dashboard changes, run targeted checks first; if build or broader checks are relevant, run them before completion when feasible.
- If verification cannot be executed due to environment or external constraints, explicitly report unverified scope and residual risk in the final response.

## Local Preview Output Rule

- For local testing that generates preview images, always write outputs directly to the root of `./test/output`.
- Do not place such generated preview files in `./test/debug` or other directories unless the user explicitly requests otherwise.

## Test Script Tracking Rule

- Automated test scripts under `test/` may be tracked when they are part of the product's repeatable verification suite.
- Keep committed tests organized under stable categorized paths such as `test/unit/<category>/**`.
- Keep reusable local test helpers under `test/tools/**`, and keep test runners under `test/runners/**`.
- Local verification artifacts must remain untracked, including generated previews in `test/output/**`, temporary scripts like `test/temp_*`, and files under `test/debug/**`.
- Do not commit one-off debugging helpers or generated files under `test/`.

## NapCat Interface Lookup Rule

- If a feature requires NapCat interfaces, first consult `docs/napcat_interface/llms.txt`.
- Use that index file to locate the corresponding interface documentation link and details.

## External Platform Parsing Rule

- Douyin/Xiaohongshu parsing is implemented entirely on the Node side under `src/services/externalParsers/` and does not go through the Python Bilibili service.
- When adding or modifying external platform support, reuse `src/services/externalParsers/`, the `src/services/link/linkTypes/` handlers, and `src/services/externalMediaDeliveryService.js` for media delivery instead of introducing parallel pipelines.
- External platform secrets (such as the Xiaohongshu cookie) are schema `secret: true` fields and must never be logged or exposed outside the configured-marker projection.

## Review Quality & Reliability Rule

- For any review request, prioritize code quality and runtime reliability over style suggestions.
- Reviews should focus first on: bugs, regression risks, error handling gaps, edge cases, and missing/weak tests.
- For Node.js changes, pay special attention to async flow correctness (`await`/Promise chains), timeout and retry behavior, null/undefined safety, and resource cleanup.
- For Python changes, pay special attention to exception paths, I/O or async blocking risks, data validation, and cleanup of external resources.
- For CSS changes, verify layout stability and consistency (especially responsive behavior, overflow/truncation, and cross-module visual regressions).
- When tests or runtime checks cannot be executed, explicitly state the unverified parts and residual risk in the review output.

  
## References

- Read `CLAUDE.md` for more details on development commands, project architecture, and key directories.

<!-- SPECKIT START -->
For additional context about technologies to be used, project structure,
shell commands, and other important information, read the current plan
<!-- SPECKIT END -->
