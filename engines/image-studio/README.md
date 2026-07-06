# Image Studio Engine

This directory contains the packaged image-generation engine for Laogui AI.

The vendored source lives at:

```text
engines/image-studio/source/go-cli
```

Build the runtime binary with:

```bash
npm run engine:image-studio
```

The command writes:

- Current platform folder: `engines/image-studio/<platform>-<arch>/gptcodex-image`
- Windows current platform folder: `engines/image-studio/<platform>-<arch>/gptcodex-image.exe`
- Legacy compatibility path: `engines/image-studio/gptcodex-image` or `engines/image-studio/gptcodex-image.exe`

Common distribution folders:

- macOS Apple Silicon: `engines/image-studio/darwin-arm64/gptcodex-image`
- macOS Intel: `engines/image-studio/darwin-x64/gptcodex-image`
- Windows x64: `engines/image-studio/win32-x64/gptcodex-image.exe`

At runtime, Laogui AI prefers this bundled CLI and sends all image generation/edit tasks through it. The app falls back to `IMAGE_STUDIO_CLI_PATH` only when the bundled binary is absent.

The Image Studio project is licensed under AGPLv3. Review the license obligations before distributing a build that bundles or modifies this engine.
