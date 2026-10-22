# Plans

The repository has no roadmap file and no open plan. The first release shipped as `0.5.0` ([[development/release]]).

Add a note here, one per plan, when work is planned that is too large for a single pull request, or when a multi-step process waits on the owner.

Gaps left open after the first release:

- It is still unknown whether the `Canceled` and `AuthCancelledError` names survive `authentication.getSession`. The extension host test cannot reach the picker: `getSession` with `createIfNone` first asks consent through a modal dialog, which the test build refuses ([[architecture/chat-provider]]). A manual check in a normal VS Code window remains.
