# Repository Guidelines

## Project Structure & Module Organization

Locknote MCP is a Go 1.24 application with a Wails desktop window and an embedded HTTP/MCP server. `main.go` handles CLI modes; `gui.go` integrates Wails and the server. Backend packages live in `internal/`: `store/` manages SQLite persistence, `api/` provides REST and events, `mcp/` implements tools and transports, and `textutil/` contains text helpers. `web/` contains plain JavaScript, HTML, CSS, localization, and Markdown rendering. Tests sit beside Go sources as `*_test.go`. `build/` holds desktop assets and generated application bundles.

## Build, Test, and Development Commands

- `./dev.sh`: start Wails development with desktop reload support; requires Wails v2.12.0 and the platform toolchain.
- `go test ./...`: run Go tests, including storage, MCP, and desktop resource integration.
- `go vet ./...`: check Go code for common correctness issues.
- `wails build -skipbindings`: package the desktop application under `build/bin/`.
- `go build -o /tmp/locknote-mcp .`: build an executable; run `/tmp/locknote-mcp serve` for HTTP service without a window.

The frontend has no bundler or npm build step. Embedded `web/` changes require restarting development or rebuilding the executable.

## Coding Style & Naming Conventions

Format Go with `gofmt`; use standard Go naming, tabs, and lowercase package names. Follow existing frontend conventions: two-space indentation, camelCase functions, and descriptive DOM IDs. Keep user-facing translations in `web/i18n.js`. Preserve the separation between persistence, REST handlers, and MCP protocol code. Avoid editing generated `web/wailsjs/` runtime files or packaged binaries.

## Testing Guidelines

Use Go’s standard `testing` package and descriptive `TestBehavior` names. Storage tests should create isolated databases with `t.TempDir()` and close them through cleanup hooks. Add regression coverage for changed backend behavior. No numeric coverage threshold is documented. Manually verify desktop/browser navigation, editing, localization, and appearance when changing the frontend.

## Commit & Pull Request Guidelines

This checkout has no Git metadata, so existing commit conventions cannot be verified. Use concise imperative subjects describing one change. Pull requests should explain the problem, resulting behavior, and verification commands; link relevant issues and include screenshots for visible interface changes.

## Security & Configuration

Configure the address and data directory with `LOCKNOTE_MCP_ADDR` and `LOCKNOTE_MCP_HOME`. Prefer loopback binding for development. Notes are plaintext SQLite data; never commit databases, access tokens, or real user exports.
