# Decisions

Dated records of choices a later change could undo by accident. Each says what was decided, why, and what would reopen it. Newest first.

- [[2026-11-06-restricted-mode-limited]]: the extension stays enabled in Restricted Mode, and the three settings it reads from any scope are restricted there
- [[2026-11-06-version-packages-auto-lands]]: the release workflow arms auto-merge on the Version Packages pull request, so it lands on the required checks alone; supersedes the 2026-10-21 hand merge
- [[2026-10-26-context-window-split]]: `maxInputTokens` is the context window minus the output limit, and the output limit is at most half the window
- [[2026-10-22-backfill-release-tags]]: one-off owner approval to tag v0.5.1 and v0.5.2 by hand; Open VSX is a no
- [[2026-10-21-agents-merge-version-packages]]: superseded by [[2026-11-06-version-packages-auto-lands]]; agents merged the Version Packages pull request under the normal bar
- [[2026-10-15-endpoint-user-settings-only]]: `vercelAiGateway.endpoint` comes from user settings only, because requests to it carry the credential
- [[2026-10-08-release-gated-on-variable]]: the release workflow does nothing unless `RELEASE_ENABLED` is `true` (set 2026-10-20), and publishes to the Marketplace only
- [[2026-08-09-system-prompt-as-instructions]]: VS Code's leading assistant messages travel as `instructions`, not `system` messages
- [[2026-08-09-active-session-from-own-provider]]: the chat provider reads the session from this extension's provider, not `authentication.getSession`
- [[2026-07-28-per-session-account-ids]]: every session is its own account
- [[2026-07-28-types-vscode-literal]]: `@types/vscode` is a literal version equal to the `engines.vscode` floor
