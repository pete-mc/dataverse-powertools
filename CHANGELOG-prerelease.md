# Change Log — pre-release channel

Per-version notes for the **pre-release** builds published between full releases. They are
kept out of [CHANGELOG.md](CHANGELOG.md) so the Marketplace changelog stays readable: at each
full release these entries are rolled up into a single stable section over there and this file
is cleared to start accumulating the next cycle (`node scripts/rollupChangelog.mjs <version>`).

Everything below has shipped to the pre-release channel and is not yet in a full release.

## 1.0.9 (pre-release)

**Fixed: Generate Early Bound Classes silently generated nothing when a table filter was set**

If you had configured an entity filter, the generated folder came back empty — and the run looked
like it had succeeded. `pac modelbuilder` takes its `--entitynamesfilter` and `--messagenamesfilter`
as **semicolon**-separated lists; we were passing commas, so pac read the whole thing as one table
name, matched nothing, wrote no classes and still exited successfully. Nothing surfaced the
failure, so a later *Build & deploy* would ship a package with none of the expected early-bound
classes in it.

Both filters are now joined the way pac documents. If you worked around this by entering your
tables with semicolons, switch back to the normal comma-separated list — the settings format is
unchanged, only what we hand to pac was wrong.

Reported from a pilot running 0.14.48; the bug was still present in 1.0.8.
