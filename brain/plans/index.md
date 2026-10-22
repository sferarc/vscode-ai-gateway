# Plans

The repository has no roadmap file and no open plan. The first release shipped as `0.5.0`; the untagged `0.5.1` and `0.5.2` were backfilled with tags and releases on 2026-10-22 ([[development/release]]).

Add a note here, one per plan, when work is planned that is too large for a single pull request, or when a multi-step process waits on the owner.

Gaps left open after the first release:

- Open VSX is not published to, and no record says whether it is wanted ([[decisions/2026-10-08-release-gated-on-variable]]).
- It is still unknown whether the `Canceled` and `AuthCancelledError` names survive `authentication.getSession`. The extension host test cannot reach the picker: `getSession` with `createIfNone` first asks consent through a modal dialog, which the test build refuses ([[architecture/chat-provider]]). A manual check in a normal VS Code window remains.
