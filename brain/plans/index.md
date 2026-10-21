# Plans

The repository has no roadmap file and no open plan. The first release shipped on 2026-10-21 (0.5.0, see [[development/release]]).

Add a note here, one per plan, when work is planned that is too large for a single pull request, or when a multi-step process waits on the owner.

Gaps left open after the first release, each recorded in its own note:

- Open VSX is not published to, and no record says whether it is wanted ([[decisions/2026-10-08-release-gated-on-variable]]).
- No test launches VS Code; `pnpm package` is the only check of the manifest as VS Code sees it ([[development/testing]]).
- It is unknown whether the `Canceled` and `AuthCancelledError` names survive `authentication.getSession`; verify in a real VS Code ([[architecture/chat-provider]]).
