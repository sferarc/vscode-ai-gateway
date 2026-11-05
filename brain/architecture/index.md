# Architecture

The extension contributes a language model chat provider to VS Code, backed by the Vercel AI Gateway, plus an authentication provider that holds the credentials for it. Source is `src/`, bundled by bunchee into `out/extension.js` (`package.json` `main` and `build`).

- [[activation]]: what `activate()` registers and when VS Code calls it, the diagnostics commands, the agent mode status tool and the Get Started walkthrough
- [[chat-provider]]: model listing, chat requests, token counting
- [[configuration]]: each setting, the scope it is read from and the request it changes, and the constants behind them
- [[authentication]]: API key and Vercel OIDC sessions, and where they are stored
