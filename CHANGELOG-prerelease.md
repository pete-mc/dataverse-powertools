# Change Log — pre-release channel

Per-version notes for the **pre-release** builds published between full releases. They are
kept out of [CHANGELOG.md](CHANGELOG.md) so the Marketplace changelog stays readable: at each
full release these entries are rolled up into a single stable section over there and this file
is cleared to start accumulating the next cycle (`node scripts/rollupChangelog.mjs <version>`).

Everything below has shipped to the pre-release channel and is not yet in a full release.

## 1.0.8 (pre-release)

**Change a web resource's bundle name after the fact — and be told when two components clash**

The new bundle name only helped components created after 1.0.7; anything older still shared
`<prefix>_library.js` with every other component in the workspace and quietly overwrote it. There
is now a *Change Web Resource Bundle Name* command (in the card's overflow, next to *Output mode*),
and Deploy warns when more than one component in the workspace would deploy the same web resource
name — in either output mode. Renaming keeps the previous name registered as yours, so handlers
still bound to it are cleaned up rather than left pointing at a resource nobody deploys.

**Fixed: Debug Web Resources did nothing for a component with its own bundle name**

The debug session hardcoded `<prefix>_library.js` when deciding which request to intercept and
which built file to serve, so for any component that had been given its own bundle name it
intercepted nothing, served nothing, and never hot-reloaded.

**Fixed: form registrations in files that per-file mode doesn't build**

In one-file-per-web-resource mode only the top-level `webresources_src/*.ts` are built —
`library.ts` and anything in a subfolder are not. A form registration in one of those was still
written to the form, pointing at a web resource that never gets deployed. Those registrations are
now skipped with a message naming the files, instead of leaving a form bound to a missing library.

**Choose your web resource's bundle name when you create the component**

1.0.7 gave each Web Resources component its own bundle name so two of them stop deploying over
each other, but it picked that name for you. Creating a component in bundled output mode now asks,
prefilled with the same suggestion and showing the full name it will deploy as
(`<prefix>_<name>.js`). Per-file mode doesn't ask, because those names come from your source
filenames.
