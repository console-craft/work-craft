# Pinned OpenTUI Terminal Contracts

Private downstream version: `0.6.6-workcraft.1`. Nothing is published to a registry.
The source baseline is upstream OpenTUI `212eb27da4adf5b907031ad153fc6a5b9f713fbf`
(0.6.6); downstream source commit is `d1e5dfab235d47362a3c52731ffccdac556ca71d`
on local branch `work-craft/native-terminal-contract`.

`source.patch` contains that complete baseline-to-source change, including tests,
the native lockfile and package/build changes. `manifest.json` records source and
archive SHA-256 checksums and tool versions. Ten repository-local tarballs keep
core, React and all eight existing native variants together. Work Craft remains
macOS/Linux-only; producing a binary is not runtime/platform acceptance.

## Reproduce From Source

Use an isolated OpenTUI worktree at the exact baseline; leave native main and live
Work Craft installations alone. Read its `AGENTS.md`. From that worktree:

```sh
git apply --check /absolute/work-craft/vendor/opentui/source.patch
git apply /absolute/work-craft/vendor/opentui/source.patch
bun install --frozen-lockfile
bun run build
```

On this macOS host cross-target symbol tools are the already installed Homebrew
LLVM 22.1.8. From `packages/core`:

```sh
LLVM_BIN=/opt/homebrew/opt/llvm/bin bun scripts/build.ts --native --all
bun run build:lib
bun run test:native
bun run test:native:lifetime
bun run test:js
bun run test:js:node
bun run test:dist
bun run test:standalone
```

From `packages/react`, run `bun run build`, `bun run test` and
`bun run test:dist:contract`. Run root `bun run fmt:check` and `bun run lint`.
Node checks require >=26.4.0. The standalone test ad-hoc signs only its generated
macOS Node SEA executable; it changes no OS security settings or installed app.

Pack with `bun pm pack --destination /absolute/work-craft/vendor/opentui` from
`packages/core/dist`, `packages/react/dist`, and each generated
`packages/core/node_modules/@opentui/core-<variant>` directory. Those native
directories are normal build outputs, not hand-patched dependencies. Variants:
`darwin-arm64`, `darwin-x64`, `linux-arm64`, `linux-x64`, `linux-arm64-musl`,
`linux-x64-musl`, `win32-arm64`, `win32-x64`.

Record new checksums only after successful builds/tests. Verify from Work Craft:

```sh
bun scripts/verify-opentui-artifacts.ts vendor/opentui
```

The patch plus frozen dependencies reproduces the source and contracts; archive
timestamps, source-map paths and compiler identities need not be bit-identical.
Never replace native binaries with registry 0.6.6 binaries or directory links.
Application adoption and its full acceptance gate are separately recorded in the
[implementation plan](../../docs/superpowers/plans/2026-10-22-native-terminal-contract-amendment.md).

## Licensing

Preserve the generated packages' MIT/OpenTUI license and native third-party notices,
including Ghostty/Unicode and bundled image/audio libraries. The normal build
copies these notices into the native distributions; this directory does not
replace or relicense them.
