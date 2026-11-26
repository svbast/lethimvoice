# Contributing

Thanks for helping with LetHim Voice. Bug reports and ideas go to
[Issues](https://github.com/svbast/lethimvoice/issues); for anything bigger than a
small fix, open an issue first so we can agree on the approach.

## Set up

You need [Bun](https://bun.sh) (the only package manager this repo uses).

```sh
bun install
bun run dev
```

## Where things are

- `electron/` is the main process, `src/` the React renderer, `locales/` the UI
  text (see [locales/README.md](locales/README.md)), `e2e/` the Playwright tests and
  `build/` the packaging.
- The renderer reaches the main process only through `window.electron`
  (`electron/preload.ts`); the IPC handlers live in `electron/ipc/`.
- Platform code goes in `*.win.ts`, `*.mac.ts` and `*.linux.ts` siblings.
- Tests sit next to the code as `*.test.ts`.

## Before you open a pull request

```sh
bun run check       # Biome: format and lint
bun run typecheck
bun run test        # unit tests
bun run test:e2e    # Playwright, for UI changes
```

The PR checks run Biome, TypeScript, the unit tests, Fallow (no new dead code,
duplication or complexity) and React Doctor. They must pass.

To test a first launch on a Mac, `bash build/uninstall.sh` removes the app, its
data and its permission grants.

- Branch from `master` as `story/<topic>` for a feature or `bug/<topic>` for a fix.
- Code, comments, commits and PR texts are in English. A new UI string goes into
  every catalog in `locales/`.
- Never commit API keys or other secrets; keys live only in the user's settings.
- Don't change `version` in `package.json`: a higher version merged into `master`
  publishes a release, so maintainers bump it in a separate PR.

## License

By contributing you agree that your contribution is licensed under the
[GPL-3.0](LICENSE).
