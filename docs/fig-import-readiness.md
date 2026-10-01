# Local `.fig` import

Tiny Image Star can import a local Figma Design `.fig` file. Import runs in a dedicated browser worker, on the user's device. It does not call a service. The existing `.flocal` open path is unchanged. The import review shows an explicit loss summary before switching designs, and the accepted design and extracted image assets are saved through the existing local package flow.

This is an **experimental, best-effort import**, not a guarantee of full Figma fidelity or a promise that every `.fig` release will remain readable. `.fig` is a proprietary format that can change; Figma describes saving local copies in its [help documentation](https://help.figma.com/hc/en-us/articles/8403626871063-Save-a-local-copy-of-files). The importer uses the pinned community parser [`openfig-core@0.4.1`](https://github.com/OpenFig-org/openfig-core), not an official Figma implementation or specification.

## Current import surface

The adapter makes frames, groups, sections, rectangles, ellipses, lines, stars, polygons, text, supported Boolean operations, and vector paths into local editable layers. It maps solid paints, supported embedded raster image fills, basic text settings, page order, visibility, opacity, clipping, constraints, and common stroke settings. Horizontal and vertical Auto Layout frames retain editable direction, gap, padding, wrap, fixed or hug sizing, main/cross-axis alignment, and direct-child absolute, fill, align-self, and min/max sizing where the source exposes those fields. Grid Auto Layout retains ordered tracks, fixed/fill/hug track sizes, row-major or manual cell placement, cell spans and alignment, gaps, padding, and automatic hug rows. Grid min/max track bounds that cannot be represented by the local model are approximated with the maximum sizing function and reported in the import review. Image sources are checked against the local image engine's dimension ceiling before they enter the design library.

It flattens component and instance links, unsupported transforms, wrapped-track alignment behavior, and some text/image/stroke settings. It omits unsupported visible node types, unsupported paints, unsupported effects, masks, invalid or oversized vector paths, and missing or unsafe raster sources. An unsupported container with children becomes a local group so its child layers remain editable. The review dialog lists examples and totals; when there are more than 40 examples, it states that the list is truncated.

Import limits are enforced before the synchronous parser runs: 32 MiB archive, 2,048 ZIP entries, 64 MiB expanded data, 32 MiB canvas/message, 1 MiB schema, 250 pages, 25,000 source nodes, and 24 MiB total embedded image data. The worker is terminated after 45 seconds. Unsupported ZIP64/encrypted entries, unsafe names, duplicate paths, integrity failures, malformed frames, and inputs exceeding these limits are rejected. The worker timeout and byte limits bound input work; they are not a strict browser process-memory guarantee.

## Evidence and gaps

The checked-in `circle-v101.fig` and `openfigs-v106.fig` samples come from the OpenFig project's test corpus at a pinned commit, and are retained with the package-declared MIT notice. They demonstrate parser/archive compatibility across versions 101 and 106, but are not official format documentation and do not represent broad production designs. Adapter tests also use synthetic decoded nodes to cover editable text, embedded image fills, horizontal and vertical Auto Layout conversion and reflow, unsupported grids, unsupported layers, loss reporting, corrupt archives, resource bounds, parent cycles, and excessive nesting.

Before calling this production-ready, add permission-cleared Figma Design exports that include real text, raster fills, mixed text styles, effects, masks, horizontal, vertical, and grid auto-layout, components, and rotated/scaled nested frames. Compare the resulting layers and rendered output on supported mobile browsers and desktop browsers, then revise this support table and limits from measured evidence. The current tests do not establish visual parity for those cases.

## Build and verification

`npm run dev` builds the isolated importer worker before starting the local server. `npm run verify:static` rebuilds that worker and checks that the deployable static tree contains it. The Pages workflow installs from `package-lock.json` and builds the worker in both verification and deployment jobs.

Run `node --test tests/fig-import.test.mjs` for focused import checks, `node scripts/ci-test.mjs` for the full Node test suite, and `npm run verify:static` for deployment-input checks. The browser smoke suite is intentionally not part of this importer change's verification yet.

No `.fig` export, live Figma API access, Figma authentication, `.jam`/`.deck`/`.buzz`/`.site` import, or round-trip preservation is implemented.
