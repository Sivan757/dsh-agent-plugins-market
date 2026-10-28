# What the gates protect, and what nothing does

`pnpm run check:refactor` is the local bar, and it is the same bar CI runs. Each member below exists because something landed that it would have caught. This page is the map: one line per gate, the failure it owns, and the cases nothing here can see.

| gate                | command              | catches                                                                                                  |
| ------------------- | -------------------- | -------------------------------------------------------------------------------------------------------- |
| types and lint      | `check:quick`        | a change that does not compile, or that the linter rejects                                               |
| formatting          | `format:check`       | a file Prettier would rewrite, which is how a hand-inserted JSON line broke CI once                      |
| contracts           | `test:contract`      | published wire and settings contracts drifting from their consumers                                      |
| layering            | `check:architecture` | an import that crosses a boundary the layering allows only one way                                       |
| reuse               | `check:reuse`        | a new helper that duplicates one already in the manifest ([reference](reuse-manifest.md))                |
| dead exports        | `check:exports`      | an exported symbol no other package reads and no ledger row records ([reference](public-exports.md))     |
| duplicate bodies    | `check:duplication`  | the same function body in two files ([reference](duplicate-functions.md))                                |
| unreachable modules | `check:modules`      | a source file no package entry reaches and no ledger row records ([reference](module-reachability.md))   |
| package contents    | `check:package`      | an emitted import that resolves here and not in the tarball ([reference](package-contents.md))           |
| unreferenced CSS    | `check:css`          | a class no importer of its stylesheet names and the ledger does not record ([reference](css-classes.md)) |
| documentation links | `check:doc-links`    | a relative link to a file or heading that does not exist                                                 |
| bundle budget       | `check:bundle`       | the client bundle growing past its ceiling                                                               |

Two guards live in the test suite instead, because they need the source rather than the tree: the theme-token allowlist (`packages/market-ui/test/theme-tokens.test.ts`) fails on a `--dsw-*` token the host does not define, and the tab-layout sharing cases fail if the two rows that render one layout stop agreeing.

## What nothing here sees

These are known, not hypothetical. Each has produced a real defect in this repository.

- **Behaviour in a browser.** The theme-token defect, the 404 poll storm and the not-ready copy were all invisible to every gate and visible in one running instance.
- **Unreferenced CSS classes.** Measured at 27 of 308 with a name-level mapping, which is too weak to delete on: it cannot follow a computed key, and some names collide with unrelated identifiers.
- **Upgrade paths.** The tarball is checked for internal consistency, not for whether a host version lacks a service the plugin injects.
- **A gate's own blind spot.** Every gate here was proved to reject a deliberate violation before landing, and one still shipped with a hole: the package-contents gate first ignored side-effect imports, so a probe it should have caught passed.

A green `check:refactor` means the mechanical properties hold. It has never meant the feature works, and treating it that way is how the three defects above reached a user.
