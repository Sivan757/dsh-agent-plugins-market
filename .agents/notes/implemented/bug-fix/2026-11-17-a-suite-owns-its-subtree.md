# Agent Note: A suite owns its subtree

Status: implemented

## Problem

Marketplace discovery supplements a productive catalog with packages it did not list by walking `plugins/`, `external_plugins/` and `skills/`. The walk asked only whether a candidate carries a suite manifest, never whether it sits inside a suite the same scan already resolved. `JuliusBrussee/caveman` declares one plugin `caveman` at `./` and ships a second packaging of it for Codex at `plugins/caveman`, carrying six of the root suite's twenty-two skills. The scan published both roots as suite `caveman`. Install state, suite data directories, mount keys and preset resource ids all key on `${sourceId}/${suiteId}` (`packages/market-catalog/src/scanning/paths.ts`), so one install record enabled both cards, the skills page listed twenty-eight rows and the preset editor rendered two identities for one name. The persisted index recorded both suites with no note, so the invention was silent.

## Decision

A resolved suite owns its subtree. The supplement loop (`MarketplaceStrategy` in `packages/market-catalog/src/scanning/scan-resolvers.ts`) skips a candidate whose directory lies inside a resolved root and records a scan note naming both checkout-relative paths (`suite .: "plugins/caveman" is the content of this suite, not a separate suite; skipped`). The rule narrows supplemental discovery only: marketplace-declared entries keep their authority, so a catalog that declares `plugins/alpha` while an undeclared sibling `plugins/beta` carries its own manifest still yields two suites.

`SOURCE_INDEX_VERSION` moves from 1 to 2 (`packages/market-catalog/src/application/source-index-schema.ts`). A version 1 record can describe the nested package as a suite; the mismatch makes the reader discard the record and rediscover the source instead of serving the stale shape.

`docs/user/sources.md` and its Chinese pair state the boundary where supplemental discovery is described.

### What the rule does not decide

Two suites from different roots that sanitize to the same id still share one install key. Same-name siblings remain possible in any source whose layout produces them, and closing that is an identity-model decision (checkout-relative suite keys) that would migrate `state.json`, suite data directories, mount keys and preset ids. The boundary rule removes the case that produced this defect; it does not claim the identity model is collision-free.

## Alternatives considered

**Deduplicate by id after discovery.** Keeping the first suite and renaming or dropping later duplicates treats the symptom: a nested packaging copy would still be eligible to become an installable suite, and a renamed copy leaves two identical-looking cards with duplicate skill names.

**Remove container supplementation.** The walk exists for sources whose catalog declares only some of the packages under `plugins/`; removing it makes the rest undiscoverable. The boundary rule keeps that case.

**Key suites by checkout-relative root.** Structurally collision-free, but it changes the persisted `sourceId/suiteId` key used by install state, data directories, mount registries and preset resource ids. That migration is a separate decision from this defect and is recorded above as open.

## Consequences

The caveman source yields one suite with its twenty-two skills, one install key and no duplicate skill identities.

A package nested inside a plugin is no longer installable implicitly; a repository that wants it published lists it as a marketplace entry, which is the declared route and still works.

Every source rediscovers once after the upgrade because the index version changed. The discarded records were caches, not state.

The same-name sibling coupling remains: a future source with two distinct roots sharing a manifest name still needs the identity decision recorded above.

## Testing

Browser verification through an isolated profile linked to this checkout: the caveman source renders one card with `技能 22 · Hooks 4 · 快捷指令 1 · 专家 3`, the skills tab shows `全部 22 / 套件 22`, `state.json` holds one key `caveman/caveman`, and the persisted index reports one suite plus the skip note. Temporary scanner fixtures cover the preserved case (a declared `plugins/alpha` with an undeclared sibling `plugins/beta`) and the skipped case (a root suite with `plugins/gamma` inside it).

## Related

- [Source-owned discovery indexes](../architecture/2026-11-12-source-owned-discovery-indexes.md) owns the index lifecycle and the versioned record this change bumps.
