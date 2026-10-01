# .fig parser compatibility fixtures

These small fixtures are copied from OpenFig-org/openfig-core's `test-fixtures` at commit `0d67354fcd6d14c37b89c42f55330faf0a79e1ce`. The upstream package metadata declares the MIT license; its attribution and license notice are included as `OPENFIG-CORE-LICENSE.txt`.

- `circle-v101.fig` (32,231 bytes), upstream `test-fixtures/circle.fig`, SHA-256 `5f8d89ce07c06615323ad5406cacc41e8da78d8fc0439ad0cdb2c2ba7e0d4038`. Parsed archive version 101; includes a page, frame, and ellipse.
- `openfigs-v106.fig` (48,052 bytes), upstream `test-fixtures/OpenFigs.fig`, SHA-256 `eecd50d4d4135ab4b146bbbb7079b7b0743ee0325f2b8e6f2b37454b59c79c4b`. Parsed archive version 106; includes a page, frame, and editable vector geometry.

These files test archive and parser compatibility; they are not an official `.fig` specification. They do not cover text, embedded raster assets, components, or every paint/effect type. Those paths have unit coverage with synthetic decoded nodes, and any simplifications or omissions are listed in the import review.
