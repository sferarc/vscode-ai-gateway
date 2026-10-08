# Decisions

Dated records of choices a later change could undo by accident. Each says what was decided, why, and what would reopen it. Newest first.

- [[2026-10-08-release-gated-on-variable]]: the release workflow does nothing until the owner sets `RELEASE_ENABLED`, and publishes to the Marketplace only
- [[2026-08-09-system-prompt-as-instructions]]: VS Code's leading assistant messages travel as `instructions`, not `system` messages
- [[2026-08-09-active-session-from-own-provider]]: the chat provider reads the session from this extension's provider, not `authentication.getSession`
- [[2026-07-28-per-session-account-ids]]: every session is its own account
- [[2026-07-28-types-vscode-literal]]: `@types/vscode` is a literal version equal to the `engines.vscode` floor
