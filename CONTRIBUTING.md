# Contributing to Linty

Thanks for your interest in contributing to Linty! Here's how to get started.

## Development setup

1. **Clone the repo**

   ```bash
   git clone https://github.com/lintyai/linty.git
   cd linty
   ```

2. **Install prerequisites**

   - [Rust](https://rustup.rs/) (stable)
   - [Node.js](https://nodejs.org/) 20+
   - [Yarn](https://yarnpkg.com/) 1.x
   - Xcode Command Line Tools (`xcode-select --install`)

3. **Install dependencies and run**

   ```bash
   yarn install
   yarn tauri dev
   ```

   The frontend dev server (port 1420) uses HMR — don't restart it, changes reload automatically.

## Project structure

- `src/` — React 19 frontend (pages, components, hooks, store, services)
- `src-tauri/src/` — Rust backend (audio, transcription, macOS FFI, clipboard)
- `src-tauri/Cargo.toml` — Rust dependencies (use `--features local-stt` for Whisper)
- `.github/workflows/` — CI/CD pipeline

## Before submitting a PR

1. **Frontend builds cleanly**

   ```bash
   yarn build
   ```

2. **Rust compiles**

   ```bash
   cd src-tauri && cargo check --features local-stt
   ```

3. **Test from Finder** — if your change touches permissions, audio, or paste, test from a Finder launch (not terminal), since terminal bypasses entitlement checks.

## Commit conventions

We use [Conventional Commits](https://www.conventionalcommits.org/):

```
type(scope): short description
```

**Types**: `feat`, `fix`, `refactor`, `docs`, `chore`, `test`

**Scopes**: `frontend`, `rust`, `audio`, `transcribe`, `macos`, `clipboard`, `capsule`, `tauri`, `build`, `config`

## Code style

- **TypeScript**: Match existing formatting (Prettier config in repo). No `any` types.
- **Rust**: `cargo fmt` and `cargo clippy --features local-stt` should pass cleanly.
- **File naming**: `ComponentName.component.tsx`, `hookName.hook.ts`, `module.util.ts`
- Remove dead code, unused imports, and console.logs before submitting.

## Good first issues

Look for issues labeled [`good first issue`](https://github.com/lintyai/linty/labels/good%20first%20issue).

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
