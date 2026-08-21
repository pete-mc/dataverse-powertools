# Change Log — pre-release channel

Per-version notes for the **pre-release** builds published between full releases. They are
kept out of [CHANGELOG.md](CHANGELOG.md) so the Marketplace changelog stays readable: at each
full release these entries are rolled up into a single stable section over there and this file
is cleared to start accumulating the next cycle (`node scripts/rollupChangelog.mjs <version>`).

Everything below has shipped to the pre-release channel and is not yet in a full release.

## 1.0.8 (pre-release)

**Choose your web resource's bundle name when you create the component**

1.0.7 gave each Web Resources component its own bundle name so two of them stop deploying over
each other, but it picked that name for you. Creating a component in bundled output mode now asks,
prefilled with the same suggestion and showing the full name it will deploy as
(`<prefix>_<name>.js`). Per-file mode doesn't ask, because those names come from your source
filenames.
