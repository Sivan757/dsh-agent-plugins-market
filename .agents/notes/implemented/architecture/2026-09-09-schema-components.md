# Agent Note: Schema component resources and real repository coverage

Status: implemented

## Problem

A multi-layout repository could pass a scan while a lower-priority dialect was never read. Counts also came from conventional directories even when manifests declared different command, hook or server paths. Kimi Code's primary manifest and runtime instructions were missing despite being documented in schemas.

## Decision

Normalize declared file/directory/inline components once into suite resources, and let runtime consumers and detail projections use those resources. Keep legacy/native fallback for suites without resource tables; an explicitly empty/invalid component must not revive defaults. Kimi startup/system instructions use the existing agent-scoped prompt API. Config readers enforce realpath containment and diagnose malformed declarations.

Commit-pinned README repository snapshots include original text, hashes and licenses. Tests scan both the original tree and an isolated dialect at every suite root, validate real schemas and exercise component consumers. The scanner reports its productive marketplace directly. See [the audit](../../../../docs/layout-coverage.md).

## Alternatives considered

**Schema-only or nonempty-scan assertions** cannot show which dialect or resource was used. **Copying components into conventional runtime directories** would break source ownership. **Per-consumer path parsing** would allow discovery, execution and editing to disagree.

## Consequences

Snapshots add about 2 MB of test data but remove network dependence from regressions. Tests do not run untrusted upstream scripts or certify every vendor-native runtime behavior. The [layout registry decision](2026-09-09-layout-registry.md) is partially extended: its source/identity/scope decisions remain, while declared component files and Kimi instructions are now consumed. The [report process](../process/2026-09-08-compatibility-report.md) remains the source acquisition/report owner; this note owns isolated tests and the normalized resource contract.
