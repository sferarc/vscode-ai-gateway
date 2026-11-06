# Plans

GitHub issues in sferarc/vscode-ai-gateway are the source of truth for pending work, progress and the roadmap. This note keeps the phases and links to their tracking issues; it holds no todo list.

The first release shipped as `0.5.0`; the untagged `0.5.1` and `0.5.2` were backfilled with tags and releases on 2026-10-22 ([[development/release]]).

Add a phase here, with a tracking issue labelled `roadmap`, when work is planned that is too large for a single pull request, or when a multi-step process waits on the owner.

## Phases

- Gaps left open after the first release: [#123](https://github.com/sferarc/vscode-ai-gateway/issues/123), closed 2026-11-03 with both children done ([#122](https://github.com/sferarc/vscode-ai-gateway/issues/122), [#124](https://github.com/sferarc/vscode-ai-gateway/issues/124) via #127).
- Marketplace listing, onboarding and positioning: [#196](https://github.com/sferarc/vscode-ai-gateway/issues/196), open. Done: the description and README opening (#188), the manifest's pricing, Q and A, banner and keywords (#190), the Get Started walkthrough (#191) and the grouped settings in the README (#192). The rest waits on the owner: README screenshots (#189), the display name (#193), Open VSX (#194), a comparison with VS Code's built in providers (#195), and the repository website, the sferadev.com docs page and a Sponsor link (sferarc/hq#888, sferarc/hq#889, sferarc/hq#890).
- Localized UI: [#274](https://github.com/sferarc/vscode-ai-gateway/issues/274), open, filed 2026-11-06 under the owner rule that machine translations ship and get fixed on feedback. Manifest strings into `package.nls.json` (#275), runtime messages through `vscode.l10n.t` (#276), the model picker text (#280), then machine translated locale files (#277).
- Findable and usable by AI agents: [#200](https://github.com/sferarc/vscode-ai-gateway/issues/200), open. Done: the `AI_GATEWAY_API_KEY` session (#198), `AGENTS.md` (#197) and the status tool with its search input (#199, #217). Open: the owner's #189, #193 and #194 shared with #196, and llms.txt on sferarc.com (sferarc/platform#2954), which the platform lane ships.
