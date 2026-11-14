Fixtures for `scripts/test/pi-inventory.test.mjs`. Files end in `.txt` so the real
inventory scan (and biome/tsgo) never sees them; the test copies them into a temp git repo
as `src/*.ts` / `src/*.cjs`.

The scope regression also creates temporary source, script, test and nested vendor
files, using runtime-built specifiers so the test itself adds no inventory rows.
All seven detection kinds, including catch-all string mentions, must use the same
file scope precedence: `test`, then `scripts`, then nested `vendor`, else `src`.
The test preserves every detected row, checks deterministic regeneration, and
requires `--check` to reject an altered scope without rewriting the inventory.
Passing the inventory check means the recorded list matches source, not that Pi
runtime dependencies have been removed or that the Pi-zero gate has passed.
