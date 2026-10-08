# Architecture

The extension contributes a language model chat provider to VS Code, backed by the Vercel AI Gateway, plus an authentication provider that holds the credentials for it. Source is `src/`, bundled by bunchee into `out/extension.js` (`package.json` `main` and `build`).

- [[activation]]: what `activate()` registers and when VS Code calls it
- [[chat-provider]]: model listing, chat requests, token counting
- [[configuration]]: the two settings and the constants behind them
- [[authentication]]: API key and Vercel OIDC sessions, and where they are stored
