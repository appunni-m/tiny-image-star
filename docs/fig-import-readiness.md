# Offline `.fig` import readiness

## Decision

Do not expose `.fig` import in the app yet. Keep the existing `.flocal` decoder unchanged. There are no real Figma-exported `.fig` fixtures in this repository, so node conversion, asset linking, and fidelity cannot be verified against actual files.

Figma documents `.fig` as a proprietary format that may change, and recommends supported APIs for third-party access: [Save a local copy of files](https://help.figma.com/hc/en-us/articles/8403626871063-Save-a-local-copy-of-files). The REST API returns a JSON node tree and image URLs, but requires `file_content:read`; it is not an offline route: [Figma REST file endpoints](https://developers.figma.com/docs/rest-api/file-endpoints/).

## Parser probe

`openfig-core@0.4.1` is an MIT-licensed community parser with browser support through bundlers. A scratch build with esbuild bundled its parser and `fflate`, `kiwi-schema`, and `fzstd` dependencies into a self-contained 23.4 KB browser worker module. This establishes packaging feasibility, not real-file compatibility. The parser calls synchronous `unzipSync()` and whole-buffer Zstandard decompression without an exposed resource budget. Worker isolation alone does not prevent a malicious or unusually large file from exhausting browser memory. See the [parser README](https://github.com/OpenFig-org/openfig-core) and [community format notes](https://github.com/OpenFig-org/openfig-core/blob/main/docs/research.md); neither is an official `.fig` specification.

## Gate before implementation

1. Add small, owned Figma Design exports from more than one file-format version, including text, vectors, nested frames, components, and embedded images. Keep files free of private or licensed user content.
2. Add a locked, reproducible browser-worker bundle build. Before calling the parser, enforce bounded ZIP entry count, compressed and expanded sizes, `canvas.fig` chunk lengths, and a documented parse-time/memory envelope. Reject files that exceed limits or use structures that cannot be checked safely.
3. Build a separate adapter from parsed Figma nodes to the existing `figma-local/1` document. Define the supported node/property subset and show a loss report; never silently drop visible content. Import only `.fig` Design files. Reject `.jam`, `.deck`, `.buzz`, `.site`, and `.make`.
4. Add fixture-based expected-tree, embedded-image, corrupt/truncated archive, resource-limit, unsupported-node, and atomic-import tests. Keep `.fig` import out of the picker until these pass.

Do not add `.fig` export or round-trip editing as part of this work. A future authenticated REST API importer should remain a separate online feature with its own consent and asset-expiry handling.
