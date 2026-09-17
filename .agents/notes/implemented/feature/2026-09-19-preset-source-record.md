# Agent Note: The preset source record — the market lists the first-party collection on first run

Status: implemented

## Problem

The market had no content of its own. A fresh install opened the Market tab empty and stayed that way until the user found a repository URL and added it, which is a poor first run for a plugin whose entire purpose is installing suites: nothing to look at, no way to tell a correct install from a broken one, and no example of the Agent Plugins v1 shape this package spent a release supporting.

The collection also had a home problem. `dsh-agent-plugins` (the suite-authoring repository) is the home for first-party suites, but a user had to add its URL like any third-party source — so the suites that most directly demonstrate the plugin's own format were the ones requiring the most setup.

## Decision

The plugin presets one source **record** pointing at the collection repository, and nothing else.

**Registration, not content.** `model/preset-source.ts` holds the record — id `dsh-agent-plugins`, the repository URL, `kind: 'git'` — and activation appends it through `mergeSources`, the same seeded-source path configured sources use. The package carries no suites and no checkout. The repository stays the single authoring home; this package only removes the step of pasting its URL.

**Registration performs no network access.** Activation writes the record and stops there. The source appears in the market as registered but not cloned, and the ordinary refresh path fetches it — the same lifecycle as any other seeded source, and consistent with the rule that startup does not fetch Git updates. The refresh button, an explicit install, or **Background source updates** all acquire it.

**No switch and no marker.** The record is a plain `SourceRef` in `state.json`. Nothing in the model, the routes or the client distinguishes it from a user-added source, and no setting owns it: a user who does not want it removes the row, exactly as they would for any other source. Because it is seeded, the next activation registers it again while the seed stays configured — the same behavior every configured source already has.

## Alternatives considered

- **Give the record its own plugin setting** (`builtinSource`, default on, adding or dropping the registration). Rejected: a dedicated switch turns an ordinary source into a feature with a lifecycle of its own — install entries to preserve across flips, a card row, copy in two languages — for a record the user can already delete with the action every source row carries. Configured sources have no such switch, and this is one.
- **Mark the record as built-in** in the source row or the model. Rejected: the marker buys nothing the id does not already say, and every consumer would grow a branch for it.
- **Vendor the collection into the package** (`suites/` beside `lib/`, registered as a local source, refreshed by a sync script). Rejected: content duplicated across two repositories, a drift check to keep the copy honest, and package weight on every install, all to avoid one clone the user triggers with the refresh button they already have.
- **Clone the repository during activation.** Rejected: it makes every start depend on GitHub reachability and turns a local action into network work. The registration is instant; the fetch is the user's explicit refresh.
- **Delete the install entries when the source is removed.** Rejected as a special case: `removeSource` already drops a source's install entries, and the preset record takes that ordinary path rather than inventing a gentler one.

## Consequences

- A fresh install shows the first-party source and one refresh away from its suites; the repository URL is nowhere for the user to type.
- The collection's content, history and releases stay in `dsh-agent-plugins`; this package's release only carries the URL.
- Deleting the row is temporary while the seed remains in the plugin's configuration, which is the behavior configured sources already document.
