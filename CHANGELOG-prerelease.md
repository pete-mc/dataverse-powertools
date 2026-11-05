# Change Log — pre-release channel

Per-version notes for the **pre-release** builds published between full releases. They are
kept out of [CHANGELOG.md](CHANGELOG.md) so the Marketplace changelog stays readable: at each
full release these entries are rolled up into a single stable section over there and this file
is cleared to start accumulating the next cycle (`node scripts/rollupChangelog.mjs <version>`).

Everything below has shipped to the pre-release channel and is not yet in a full release.

## 1.0.11 (pre-release)

**Added: Build & Deploy registers step images declared on `[CrmPluginRegistration]`**

`Image1Name` / `Image1Type` / `Image1Attributes` (and the `Image2*` set) were generated on the attribute but
ignored at deploy, so pre/post images had to be added by hand in the Plugin Registration Tool. Each
declared image is now created or updated on its step, matched by alias (the image name). The image type
defaults to `PreImage`; names and attributes must be string literals. Images Dataverse would reject (a
pre-image on Create, a post-image on Delete or before PostOperation) are skipped with the reason in the
output channel. Images not declared in code are left alone.

**Build & deploy: step registrations are read more carefully**

- A commented-out `[CrmPluginRegistration]` (`// …` or `/* … */`) is no longer registered as a step.
- Steps on a `public sealed class` or `public partial class` are now registered against that class.
  Before, they were attached to the next plain `public class` in the file, or dropped.
- A registration that can't be used (too few arguments, or no public class after it) is now named in
  the output channel with the reason, instead of being skipped without a word.
- On macOS and Linux, `.cs` files under `bin/` and `obj/` are no longer scanned for registrations.
