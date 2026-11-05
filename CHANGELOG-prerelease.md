# Change Log — pre-release channel

Per-version notes for the **pre-release** builds published between full releases. They are
kept out of [CHANGELOG.md](CHANGELOG.md) so the Marketplace changelog stays readable: at each
full release these entries are rolled up into a single stable section over there and this file
is cleared to start accumulating the next cycle (`node scripts/rollupChangelog.mjs <version>`).

Everything below has shipped to the pre-release channel and is not yet in a full release.

## 1.0.11 (pre-release)

**Build & deploy: step registrations are read more carefully**

- A commented-out `[CrmPluginRegistration]` (`// …` or `/* … */`) is no longer registered as a step.
- Steps on a `public sealed class` or `public partial class` are now registered against that class.
  Before, they were attached to the next plain `public class` in the file, or dropped.
- A registration that can't be used (too few arguments, or no public class after it) is now named in
  the output channel with the reason, instead of being skipped without a word.
- On macOS and Linux, `.cs` files under `bin/` and `obj/` are no longer scanned for registrations.
