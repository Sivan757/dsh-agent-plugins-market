---
description: 'Source survey of repository, package, release, and runtime composition boundaries.'
---

# Host multi-package plugin survey

## Summary

The host organizes capability packages inside one workspace, rather than assigning a separate repository to every plugin. [pnpm-workspace.yaml](/Users/sivan/workspace/deepseek-harness/pnpm-workspace.yaml#L1-L15) [agent/package.json](/Users/sivan/workspace/deepseek-harness/packages/core/agent/package.json#L8-L12) A capability group is a directory container, not a package. [adding-a-package.md](/Users/sivan/workspace/deepseek-harness/docs/cookbook/adding-a-package.md#L25) The main DSH release family uses one shared version across public packages and private DSH workspaces. [bump.ts](/Users/sivan/workspace/deepseek-harness/scripts/release/bump.ts#L273-L316) Bundle selection, package availability, and service injection use different declarations. [profile.ts](/Users/sivan/workspace/deepseek-harness/packages/boot/app-boot/src/profile.ts#L5-L20) [Package entry](/Users/sivan/workspace/deepseek-harness/packages/shell/tool-bash/src/index.ts#L33-L34)

## Table of Contents

- [Scope and evidence](#scope-and-evidence)
- [Repository layout](#repository-layout)
- [Package organization](#package-organization)
- [Six capability comparisons](#six-capability-comparisons)
- [Published artifact observations](#published-artifact-observations)
- [Shared build and testing](#shared-build-and-testing)
- [Versions and publication](#versions-and-publication)
- [Package supply and runtime composition](#package-supply-and-runtime-composition)
- [Commonality and exceptions](#commonality-and-exceptions)
- [Recommendations](#recommendations)
- [Execution evidence](#execution-evidence)
- [Dev Note](#dev-note)

## Scope and evidence

This report separates source observations from recommendations and execution evidence. It does not claim that source inspection proves runtime behavior.

The host branch reference records `c55d6205ff4f8a7e2b64647f5147a67b5bd5024f`. [Host branch reference](/Users/sivan/workspace/deepseek-harness/.git/refs/heads/master#L1) The cached upstream reference records `5badb15009ae1756c3afe0ae0cef1faafc290ccc`. [Cached host upstream reference](/Users/sivan/workspace/deepseek-harness/.git/refs/remotes/origin/master#L1) The market branch and cached upstream both record `c19f08a2cf8eb725fed338d07fc2ed2abe267366`. [Market branch reference](/Users/sivan/workspace/dsh-agent-plugins-market/.git/refs/heads/dev#L1) [Cached market upstream reference](/Users/sivan/workspace/dsh-agent-plugins-market/.git/refs/remotes/origin/dev#L1) These references identify the inspected local snapshot. The host remote query failed with exit code 128, so current upstream freshness remains unknown. The market remote query returned the same dev commit as its local reference.

The market documentation rules place decision evidence under developer discussion and keep developer material English-only. [docs/AGENTS.md](/Users/sivan/workspace/dsh-agent-plugins-market/docs/AGENTS.md#L7-L23)

## Repository layout

The workspace includes capability packages, application assemblies, native packages, benchmarks, documentation, and a Python distribution manifest. [pnpm-workspace.yaml](/Users/sivan/workspace/deepseek-harness/pnpm-workspace.yaml#L1-L15) The root manifest is private and identifies pnpm as the package manager. [deepseek-harness/package.json](/Users/sivan/workspace/deepseek-harness/package.json#L2-L7)

| Area | Observed responsibility | Evidence |
| --- | --- | --- |
| `packages/<group>/<package>/` | Packages occupy exactly one group and one package directory below that group. | [packages/README.md](/Users/sivan/workspace/deepseek-harness/packages/README.md#L12-L27) [adding-a-package.md](/Users/sivan/workspace/deepseek-harness/docs/cookbook/adding-a-package.md#L25) |
| `apps/*` | Application assemblies sit above the package tier, and the CLI application owns the `dsh` executable. | [pnpm-workspace.yaml](/Users/sivan/workspace/deepseek-harness/pnpm-workspace.yaml#L8-L9) |
| `vendor/*` | The workspace includes the vendored framework and overrides selected packages with local links. | [pnpm-workspace.yaml](/Users/sivan/workspace/deepseek-harness/pnpm-workspace.yaml#L1-L3) [pnpm-workspace.yaml](/Users/sivan/workspace/deepseek-harness/pnpm-workspace.yaml#L17-L20) |
| `native/system` | Native code shares the workspace but keeps its build and publication scripts in its own area. | [pnpm-workspace.yaml](/Users/sivan/workspace/deepseek-harness/pnpm-workspace.yaml#L4-L7) [system/package.json](/Users/sivan/workspace/deepseek-harness/native/system/package.json#L8-L26) |
| `benchmarks` | A private workspace owns repository benchmark dependencies. | [pnpm-workspace.yaml](/Users/sivan/workspace/deepseek-harness/pnpm-workspace.yaml#L10-L11) |
| `website` | The workspace includes the documentation website. | [pnpm-workspace.yaml](/Users/sivan/workspace/deepseek-harness/pnpm-workspace.yaml#L12) [deepseek-harness/AGENTS.md](/Users/sivan/workspace/deepseek-harness/AGENTS.md#L79) |
| `python/sdk-runtime` | A dependency manifest selects packages distributed by the executable and Python runtime. | [pnpm-workspace.yaml](/Users/sivan/workspace/deepseek-harness/pnpm-workspace.yaml#L13-L15) |

The pnpm declaration includes benchmarks and the Python distribution manifest, but the root JSON workspace list omits both. [pnpm-workspace.yaml](/Users/sivan/workspace/deepseek-harness/pnpm-workspace.yaml#L10-L15) [deepseek-harness/package.json](/Users/sivan/workspace/deepseek-harness/package.json#L11-L18) The constraint implementation reads workspace membership from the pnpm declaration. [check-workspace-constraints.ts](/Users/sivan/workspace/deepseek-harness/scripts/check-workspace-constraints.ts#L152-L172)

### Repository ownership

Representative manifests declare the same Git repository URL and different source directories. [agent/package.json](/Users/sivan/workspace/deepseek-harness/packages/core/agent/package.json#L8-L12) [base/package.json](/Users/sivan/workspace/deepseek-harness/packages/bundle/base/package.json#L8-L12) [timeout/package.json](/Users/sivan/workspace/deepseek-harness/packages/util/timeout/package.json#L8-L12) The constraint implementation requires that shared URL and each release member directory. [check-workspace-constraints.ts](/Users/sivan/workspace/deepseek-harness/scripts/check-workspace-constraints.ts#L418-L427) This evidence supports one repository with multiple npm identities, rather than one repository per npm identity. [agent/package.json](/Users/sivan/workspace/deepseek-harness/packages/core/agent/package.json#L2-L12) [timeout/package.json](/Users/sivan/workspace/deepseek-harness/packages/util/timeout/package.json#L2-L12)

The Git transcript records tracked ownership and the absence of tracked submodule entries. [Git observations](/Users/sivan/workspace/dsh-agent-plugins-market/docs/developer/discussion/2026-10-06-host-multi-package-plugin-survey.md#repository-inspection-performed)

## Package organization

The group index assigns each capability family an owning README. [packages/README.md](/Users/sivan/workspace/deepseek-harness/packages/README.md#L12-L27) Its maps include service definitions, providers, model-facing tools, application composition, browser components, and support libraries. [packages/README.md](/Users/sivan/workspace/deepseek-harness/packages/README.md#L31-L85)

### Package responsibilities

| Package shape | Observed contract | Evidence |
| --- | --- | --- |
| Service definition | A capability package defines the interface that providers implement and consumers use. | [shell/README.md](/Users/sivan/workspace/deepseek-harness/packages/shell/README.md#L25-L35) [packages/AGENTS.md](/Users/sivan/workspace/deepseek-harness/packages/AGENTS.md#L10) |
| Provider | A provider implements a capability through a named mechanism or environment. | [adding-a-package.md](/Users/sivan/workspace/deepseek-harness/docs/cookbook/adding-a-package.md#L48-L50) [shell/README.md](/Users/sivan/workspace/deepseek-harness/packages/shell/README.md#L27-L31) |
| Consumer plugin | A tool plugin consumes service keys rather than selecting a concrete provider through `inject`. | [Package entry](/Users/sivan/workspace/deepseek-harness/packages/shell/tool-bash/src/index.ts#L28-L34) |
| Library | The timeout utility exposes functions through imports rather than a profile layer. | [timeout/README.md](/Users/sivan/workspace/deepseek-harness/packages/util/timeout/README.md#L1-L3) [timeout/README.md](/Users/sivan/workspace/deepseek-harness/packages/util/timeout/README.md#L25-L40) |
| Bundle | A bundle declares one patch file or an ordered patch list in `dsh.bundle.patch`. | [profile.ts](/Users/sivan/workspace/deepseek-harness/packages/boot/app-boot/src/profile.ts#L5-L14) |

The documented split applies when definitions, providers, and consumers evolve independently. [adding-a-package.md](/Users/sivan/workspace/deepseek-harness/docs/cookbook/adding-a-package.md#L42-L44) The same guidance keeps a single-purpose plugin in one package. [adding-a-package.md](/Users/sivan/workspace/deepseek-harness/docs/cookbook/adding-a-package.md#L44) The host therefore does not require every feature to become a three-package family. [adding-a-package.md](/Users/sivan/workspace/deepseek-harness/docs/cookbook/adding-a-package.md#L44)

### Shared package conventions

Package source uses explicit TypeScript import extensions, with compiled JavaScript and declarations exposed through package exports. [adding-a-package.md](/Users/sivan/workspace/deepseek-harness/docs/cookbook/adding-a-package.md#L27-L29) [agent/package.json](/Users/sivan/workspace/deepseek-harness/packages/core/agent/package.json#L13-L37) A package compiler configuration references workspace dependencies and joins one host or client aggregate. [packages/AGENTS.md](/Users/sivan/workspace/deepseek-harness/packages/AGENTS.md#L23) [tsconfig.json](/Users/sivan/workspace/deepseek-harness/packages/core/agent/tsconfig.json#L1-L40) Tests belong beside each package under its test directory. [packages/AGENTS.md](/Users/sivan/workspace/deepseek-harness/packages/AGENTS.md#L25) Package documentation owns configuration, extension points, model effects, and known limitations. [packages/README.md](/Users/sivan/workspace/deepseek-harness/packages/README.md#L105-L108)

Service packages default-export a service class, while function plugins use named exports for plugin declarations. [packages/AGENTS.md](/Users/sivan/workspace/deepseek-harness/packages/AGENTS.md#L5) Optional service access uses `ctx.get(name)`, while direct context properties require declared injection. [packages/AGENTS.md](/Users/sivan/workspace/deepseek-harness/packages/AGENTS.md#L6) Extension plugins depend on service definitions, while composition bundles can depend on concrete composition packages. [packages/README.md](/Users/sivan/workspace/deepseek-harness/packages/README.md#L99-L101)

### Manifest evidence versus older prose

The package cookbook says that package manifests use `private: true`. [adding-a-package.md](/Users/sivan/workspace/deepseek-harness/docs/cookbook/adding-a-package.md#L27) The current constraint code instead forbids that flag for release members and requires public publication metadata. [check-workspace-constraints.ts](/Users/sivan/workspace/deepseek-harness/scripts/check-workspace-constraints.ts#L418-L427) The inspected agent, base bundle, and timeout manifests use public publication metadata. [agent/package.json](/Users/sivan/workspace/deepseek-harness/packages/core/agent/package.json#L2-L12) [base/package.json](/Users/sivan/workspace/deepseek-harness/packages/bundle/base/package.json#L2-L12) [timeout/package.json](/Users/sivan/workspace/deepseek-harness/packages/util/timeout/package.json#L2-L12) This report treats those manifests and the constraint code as stronger evidence for publication policy. [check-workspace-constraints.ts](/Users/sivan/workspace/deepseek-harness/scripts/check-workspace-constraints.ts#L418-L427)

## Six capability comparisons

The six cases use one repository but different package structures. A runtime row is one configured plugin instance. A bundle is a package that supplies composition patches. A provider implements a capability through a specific mechanism.

| Capability | Package structure | Repository placement | Composition owner |
| --- | --- | --- | --- |
| Agent Teams | Bundle, service, model tools, browser UI. Four packages supply three inserted rows. | All four packages sit under experimental. | The Team bundle also disables four ordinary subagent tool rows. [Team composition](/Users/sivan/workspace/deepseek-harness/packages/experimental/agent-team-profile/cordis.patch.yml#L4-L33) |
| Schedule | Bundle, scheduler with tools, browser UI, reusable time context. Four packages supply three rows. | Experimental, schedule, client, and context groups. | The Schedule bundle selects the three runtime packages. [Schedule dependencies](/Users/sivan/workspace/deepseek-harness/packages/experimental/schedule-bundle/package.json#L35-L51) [Schedule composition](/Users/sivan/workspace/deepseek-harness/packages/experimental/schedule-bundle/cordis.patch.yml#L8-L16) |
| Voice Input | Bundle, service registry, SenseVoice provider, remote controller, browser UI. Five packages supply four rows. | All five packages sit under experimental. | The Voice Input bundle selects its provider and controller. [Voice composition](/Users/sivan/workspace/deepseek-harness/packages/experimental/voice-input-bundle/cordis.patch.yml#L1-L13) |
| Plan Mode | One host package owns state, guidance, command, and exit tool. A separate package owns its browser UI. | Plan and client groups. | Base and Web bundles select different scopes. [Plan rationale](/Users/sivan/workspace/deepseek-harness/packages/plan/plan-mode/README.md#L79-L81) [Web preset](/Users/sivan/workspace/deepseek-harness/packages/bundle/web-app/presets/standard.patch.yml#L42-L51) |
| Shell and Subprocess | Service contracts, local implementations, sandbox variants, model tools, environment, and browser configuration. | Shell, subprocess, client, and supporting groups. | Base chooses platform implementations. Web presets select model tools. [Base shell assembly](/Users/sivan/workspace/deepseek-harness/packages/bundle/base/cordis.patch.yml#L220-L273) [Web tool scope](/Users/sivan/workspace/deepseek-harness/packages/bundle/web-app/presets/standard.patch.yml#L20-L25) |
| LSP | Service registry, stdio provider, and model tool. Three packages, without a dedicated bundle or browser package. | The three packages sit under lsp. | An explicit deployment composition selects the packages and language servers. [LSP group](/Users/sivan/workspace/deepseek-harness/packages/lsp/README.md#L12-L31) [Loader fixture](/Users/sivan/workspace/deepseek-harness/snapshots/session/lsp-definition/cordis.yml#L1-L21) |

### Agent Teams

The service owns team state, journals, members, messages, and shared tasks. [Team service imports](/Users/sivan/workspace/deepseek-harness/packages/experimental/agent-team/src/index.ts#L7-L16) The tool package consumes the service through `agentTeams`, rather than duplicating that state. [Tool injection](/Users/sivan/workspace/deepseek-harness/packages/experimental/tool-agent-team/src/index.ts#L11-L28) The UI reads the Session projection and owns its browser contributions. [Team browser assembly](/Users/sivan/workspace/deepseek-harness/packages/experimental/client-ui-agent-team/src/client/mount.ts#L20-L62)

The service closes admission and drains work during disposal. [Team cleanup](/Users/sivan/workspace/deepseek-harness/packages/experimental/agent-team/src/index.ts#L251-L266) The tool package separately removes its registrations. [Tool cleanup](/Users/sivan/workspace/deepseek-harness/packages/experimental/tool-agent-team/src/index.ts#L392-L422) A test keeps a child alive after tool removal, then reinstalls the tools. [Tool lifetime test](/Users/sivan/workspace/deepseek-harness/packages/experimental/tool-agent-team/tests/tool-team.spec.ts#L609-L629) This report describes that assertion without claiming a test pass.

The UI does not inject `agentTeams` directly. [Team UI dependencies](/Users/sivan/workspace/deepseek-harness/packages/experimental/client-ui-agent-team/src/client/mount.ts#L20-L62) Therefore, separate switches do not establish identical dependency behavior for the tool and UI packages.

### Schedule

The scheduler owns recurrence, storage, delivery, remote operations, and model tools. [Schedule assembly](/Users/sivan/workspace/deepseek-harness/packages/schedule/schedule/src/index.ts#L10-L24) [Tool registration](/Users/sivan/workspace/deepseek-harness/packages/schedule/schedule/src/index.ts#L167-L187) Its source separates those implementations inside the same package. The time-context plugin supplies time information independently from scheduling. [Time context injection](/Users/sivan/workspace/deepseek-harness/packages/context/time-context/src/index.ts#L31-L53) The browser UI requires `remote.schedule` and calls the generated remote interface. [Schedule UI](/Users/sivan/workspace/deepseek-harness/packages/client/ui-schedule/src/client/index.ts#L76-L101)

This case rejects a universal rule that every feature needs a separate tool package. It also shows that one user-facing feature can cross several repository groups. [Bundle dependencies](/Users/sivan/workspace/deepseek-harness/packages/experimental/schedule-bundle/package.json#L35-L51) The browser UI and service have separate cleanup paths. [Schedule cleanup](/Users/sivan/workspace/deepseek-harness/packages/schedule/schedule/src/index.ts#L140-L187) [UI contributions](/Users/sivan/workspace/deepseek-harness/packages/client/ui-schedule/src/client/index.ts#L155-L201)

### Voice Input

The service registry owns provider selection, observation, admission, cancellation, and pending work. [Speech registry](/Users/sivan/workspace/deepseek-harness/packages/experimental/speech-to-text/src/index.ts#L27-L79) The SenseVoice package owns its local worker and registers one recognizer. [SenseVoice adapter](/Users/sivan/workspace/deepseek-harness/packages/experimental/speech-to-text-sensevoice/src/index.ts#L13-L40) The remote controller owns request limits and exposes speech operations to clients. [Speech controller](/Users/sivan/workspace/deepseek-harness/packages/experimental/api-speech-to-text/src/index.ts#L27-L55) [Transcription request](/Users/sivan/workspace/deepseek-harness/packages/experimental/api-speech-to-text/src/index.ts#L88-L108) The browser package owns recording controls, remote observation, and interface contributions. [Voice browser ownership](/Users/sivan/workspace/deepseek-harness/packages/experimental/client-ui-voice-input/src/client/mount.ts#L17-L50)

The interface does not own model preparation lifetime. The service exposes preparation and cancellation as separate operations. [Preparation operations](/Users/sivan/workspace/deepseek-harness/packages/experimental/speech-to-text/src/index.ts#L153-L172) The browser package removes its UI and remote contribution together. [Voice browser teardown](/Users/sivan/workspace/deepseek-harness/packages/experimental/client-ui-voice-input/src/client/mount.ts#L54-L64)

This case separates a replaceable implementation from both remote access and presentation. Its contract pattern is relevant to translation providers without implying that translation needs five packages.

### Plan Mode

Plan Mode keeps state, guidance, its command, and the exit tool together because it has no interchangeable backend. [Product package rationale](/Users/sivan/workspace/deepseek-harness/packages/plan/plan-mode/README.md#L79-L81) The host package requires tools, systemPrompt, and sessionProjections. [Plan injection](/Users/sivan/workspace/deepseek-harness/packages/plan/plan-mode/src/index.ts#L176-L177) It mounts commands through an optional child scope. [Optional command adapter](/Users/sivan/workspace/deepseek-harness/packages/plan/plan-mode/src/index.ts#L217-L235) The UI remains a separate package with an empty Host entry and a browser entry. [Plan UI entry](/Users/sivan/workspace/deepseek-harness/packages/client/ui-plan/src/index.ts#L1-L11)

The Web bundle disables the base Plan Mode row. [Base row override](/Users/sivan/workspace/deepseek-harness/packages/bundle/web-app/cordis.patch.yml#L499-L500) Its standard preset mounts Plan Mode inside an isolated group. [Agent scope](/Users/sivan/workspace/deepseek-harness/packages/bundle/web-app/presets/standard.patch.yml#L42-L51) Package identity therefore does not determine whether an instance is global or Agent-scoped.

### Shell and Subprocess

The model tool calls the shell contract, while concrete executors own execution details. [Shell contract](/Users/sivan/workspace/deepseek-harness/packages/shell/shell/src/index.ts#L36-L93) [Bash tool injection](/Users/sivan/workspace/deepseek-harness/packages/shell/tool-bash/src/index.ts#L14-L34) The local Bash executor consumes the subprocess contract. [Local Bash executor](/Users/sivan/workspace/deepseek-harness/packages/shell/bash-local/src/index.ts#L97-L107) The sandbox executor extends that implementation and replaces the mounted shell. [Sandbox executor](/Users/sivan/workspace/deepseek-harness/packages/shell/bash-sandbox/src/index.ts#L38-L50) The subprocess implementation owns process creation, output, and terminal resources. [Subprocess contract](/Users/sivan/workspace/deepseek-harness/packages/subprocess/subprocess/src/index.ts#L88-L162)

The base bundle chooses Bash or PowerShell by platform. [Platform composition](/Users/sivan/workspace/deepseek-harness/packages/bundle/base/cordis.patch.yml#L220-L273) The jobs service changes available tool behavior through optional runtime injection. [Jobs integration](/Users/sivan/workspace/deepseek-harness/packages/shell/tool-bash/src/index.ts#L536-L554) The browser configuration package remains separate. [Shell configuration UI](/Users/sivan/workspace/deepseek-harness/packages/client/ui-settings-shell/src/client/index.ts#L37-L52)

This case separates mechanisms that vary, rather than mirroring each visible switch. Class inheritance does not require two service instances. A package peer does not automatically become a mandatory runtime injection.

### LSP

The registry owns normalized operations and provider routing. [LSP contract](/Users/sivan/workspace/deepseek-harness/packages/lsp/lsp/src/types.ts#L1-L17) [Provider registry](/Users/sivan/workspace/deepseek-harness/packages/lsp/lsp/src/index.ts#L82-L148) The stdio provider owns configured language servers and workspace process instances. [Provider startup](/Users/sivan/workspace/deepseek-harness/packages/lsp/lsp-stdio/src/index.ts#L126-L185) [Workspace instances](/Users/sivan/workspace/deepseek-harness/packages/lsp/lsp-stdio/src/index.ts#L216-L237) The model tool owns tool schemas, cursor conversion, result limits, and presentation. [Tool adapter](/Users/sivan/workspace/deepseek-harness/packages/lsp/tool-lsp/src/index.ts#L1-L9) [Query dispatch](/Users/sivan/workspace/deepseek-harness/packages/lsp/tool-lsp/src/index.ts#L182-L194)

The three inspected manifests contain no family bundle declaration or browser entry. [Registry manifest](/Users/sivan/workspace/deepseek-harness/packages/lsp/lsp/package.json#L16-L38) [Provider manifest](/Users/sivan/workspace/deepseek-harness/packages/lsp/lsp-stdio/package.json#L16-L53) [Tool manifest](/Users/sivan/workspace/deepseek-harness/packages/lsp/tool-lsp/package.json#L16-L53) The family ships no language servers. [LSP scope](/Users/sivan/workspace/deepseek-harness/packages/lsp/README.md#L12-L31) A Loader fixture provides an explicit composition and a deterministic server. [LSP composition](/Users/sivan/workspace/deepseek-harness/snapshots/session/lsp-definition/cordis.yml#L1-L21) A capability family therefore does not require its own installable bundle.

### Repeated package structure

Each package owns source, tests, and documentation, while the repository supplies common compilation and release infrastructure. [Package layout rules](/Users/sivan/workspace/deepseek-harness/packages/AGENTS.md#L23-L28) The following tree illustrates the inspected package conventions. It is not a list of mandatory files for every package.

    a-package/
      package.json
      src/
        index.ts
        types.ts
        client/          # Browser packages only
      tests/
      README.md
      README.zh.md
      tsconfig.json
      tsdown.config.ts  # When a local bundler entry is needed

Host plugins use either a default service class or named function exports. [Plugin exports](/Users/sivan/workspace/deepseek-harness/packages/AGENTS.md#L5-L6) Browser plugins publish a separate `./client` entry, even when their Host entry performs no work. [Plan UI manifest](/Users/sivan/workspace/deepseek-harness/packages/client/ui-plan/package.json#L16-L42) Provider-specific dependencies stay with the provider. [SenseVoice dependencies](/Users/sivan/workspace/deepseek-harness/packages/experimental/speech-to-text-sensevoice/package.json#L35-L51) State belongs to the service or product owner, rather than being duplicated in the tool and UI packages.

## Published artifact observations

The research inspected version-specific registry metadata and published contents for rc.2 representatives from all six cases. These reads establish artifact contents, not successful installation or activation.

| Sample | Registry evidence | Payload evidence | Observed result |
| --- | --- | --- | --- |
| Agent Teams | [Bundle manifest](https://registry.npmjs.org/@deepseek-ai%2Fdsh-experimental-agent-team-profile/0.2.0-rc.2) | [Bundle inventory](https://unpkg.com/@deepseek-ai/dsh-experimental-agent-team-profile@0.2.0-rc.2/?meta) | Three runtime dependencies use exact rc.2 versions. The patch is present. |
| Schedule | [Service manifest](https://registry.npmjs.org/@deepseek-ai%2Fdsh-schedule/0.2.0-rc.2) | [Service inventory](https://unpkg.com/@deepseek-ai/dsh-schedule@0.2.0-rc.2/?meta) | The service exports generated remote artifacts and browser vocabulary. |
| Voice Input | [Bundle manifest](https://registry.npmjs.org/@deepseek-ai%2Fdsh-experimental-voice-input-bundle/0.2.0-rc.2) | [Bundle inventory](https://unpkg.com/@deepseek-ai/dsh-experimental-voice-input-bundle@0.2.0-rc.2/?meta) | Four runtime dependencies use exact rc.2 versions. |
| Plan Mode | [UI manifest](https://registry.npmjs.org/@deepseek-ai/dsh-client-ui-plan/0.2.0-rc.2) | [UI archive](https://registry.npmjs.org/@deepseek-ai/dsh-client-ui-plan/-/dsh-client-ui-plan-0.2.0-rc.2.tgz) | Host and browser bundles are separate exported artifacts. |
| Shell | [Tool manifest](https://registry.npmjs.org/@deepseek-ai/dsh-tool-bash/0.2.0-rc.2) | [Tool archive](https://registry.npmjs.org/@deepseek-ai/dsh-tool-bash/-/dsh-tool-bash-0.2.0-rc.2.tgz) | Host services appear as peers. The tool retains service injection declarations. |
| LSP | [Provider manifest](https://registry.npmjs.org/@deepseek-ai/dsh-lsp-stdio/0.2.0-rc.2) | [Provider archive](https://registry.npmjs.org/@deepseek-ai/dsh-lsp-stdio/-/dsh-lsp-stdio-0.2.0-rc.2.tgz) | The provider publishes compiled code, without an installable family bundle. |

The inspected manifests point to one Git repository and retain individual `repository.directory` values. The bundle manifests replace `workspace:*` with exact DSH versions at publication. The inspected payloads omit `src/` despite declaring `./src/*` exports. An export declaration alone therefore does not prove that its target ships.

Browser dependencies require a separate distinction. Npm dependency sections describe installation and development relationships. Cordis `inject` declares runtime service requirements. `dsh.client.inject` records informational package edges, while `dsh.client.external` controls module requests. [Browser dependency rules](/Users/sivan/workspace/deepseek-harness/packages/client/AGENTS.md#L60-L97)

Team UI declares many peers, while Schedule UI and Plan UI declare only Cordis as a peer. [Team UI peers](/Users/sivan/workspace/deepseek-harness/packages/experimental/client-ui-agent-team/package.json#L46-L78) [Schedule UI peers](/Users/sivan/workspace/deepseek-harness/packages/client/ui-schedule/package.json#L53-L82) [Plan UI peers](/Users/sivan/workspace/deepseek-harness/packages/client/ui-plan/package.json#L48-L80) Those differences prevent a universal recommendation based on one manifest. Consumers must follow the policy for their deployment rather than copy an arbitrary host package.

The Web bundle also qualifies the empty-entry pattern. It declares an ordered patch list and runtime startup exports. [Web bundle manifest](/Users/sivan/workspace/deepseek-harness/packages/bundle/web-app/package.json#L16-L51) Do not infer that all bundles contain empty JavaScript modules.

## Shared build and testing

The root build implementation invokes the native build, library build, and Web build in sequence. [build.ts](/Users/sivan/workspace/deepseek-harness/scripts/build.ts#L31-L47) The library script separates host compilation from client compilation. [deepseek-harness/package.json](/Users/sivan/workspace/deepseek-harness/package.json#L24-L27) The shared bundler discovers workspace packages and supports package-local client build configuration. [tsdown.config.ts](/Users/sivan/workspace/deepseek-harness/tsdown.config.ts#L10-L34)

| Concern | Observed arrangement | Evidence |
| --- | --- | --- |
| TypeScript | Host and client aggregate builds own their respective package projects. | [deepseek-harness/package.json](/Users/sivan/workspace/deepseek-harness/package.json#L24-L26) [adding-a-package.md](/Users/sivan/workspace/deepseek-harness/docs/cookbook/adding-a-package.md#L33-L38) |
| Runtime bundles | The shared bundler selects vendor packages, capability packages, and application entries. | [tsdown.config.ts](/Users/sivan/workspace/deepseek-harness/tsdown.config.ts#L19-L34) |
| Unit tests | The root test script builds the native addon before invoking Vitest. | [deepseek-harness/package.json](/Users/sivan/workspace/deepseek-harness/package.json#L56-L58) |
| Test discovery | Vitest selects package, application, script, and website tests through root patterns. | [vitest.config.ts](/Users/sivan/workspace/deepseek-harness/vitest.config.ts#L123-L128) |
| Composition tests | Product-visible plugins require a Loader-based composition test beyond hand-built plugin unit tests. | [packages/AGENTS.md](/Users/sivan/workspace/deepseek-harness/packages/AGENTS.md#L7) |
| Quality gates | Root scripts expose repository checks and separate CI groups. | [deepseek-harness/package.json](/Users/sivan/workspace/deepseek-harness/package.json#L81-L100) |

Package boundaries coexist with shared compiler, test discovery, and release infrastructure. [deepseek-harness/package.json](/Users/sivan/workspace/deepseek-harness/package.json#L24-L27) [vitest.config.ts](/Users/sivan/workspace/deepseek-harness/vitest.config.ts#L123-L128) [families.ts](/Users/sivan/workspace/deepseek-harness/scripts/release/families.ts#L321-L345) These are source observations, not results from running those commands.

## Versions and publication

The root scripts expose DSH, vendor, verification, packing, and publication entry points. [deepseek-harness/package.json](/Users/sivan/workspace/deepseek-harness/package.json#L195-L201) The release code defines separate DSH, vendor, and native sequences. [families.ts](/Users/sivan/workspace/deepseek-harness/scripts/release/families.ts#L1-L6) [system/package.json](/Users/sivan/workspace/deepseek-harness/native/system/package.json#L20-L26)

### DSH family

The DSH family selects manifests below capability groups and applications, then excludes private members. [families.ts](/Users/sivan/workspace/deepseek-harness/scripts/release/families.ts#L122-L145) [families.ts](/Users/sivan/workspace/deepseek-harness/scripts/release/families.ts#L321-L328) Its version validator requires one shared version, and its Git tags use `dsh-v`. [families.ts](/Users/sivan/workspace/deepseek-harness/scripts/release/families.ts#L335-L352) The bump implementation updates public members, private DSH packages, and the root manifest together. [bump.ts](/Users/sivan/workspace/deepseek-harness/scripts/release/bump.ts#L273-L316)

The pack interface selects a family, output directory, and concurrency, without a per-package selector. [pack.ts](/Users/sivan/workspace/deepseek-harness/scripts/release/pack.ts#L52-L66) It packs the complete selected family and records publication order. [pack.ts](/Users/sivan/workspace/deepseek-harness/scripts/release/pack.ts#L64-L87) The publication interface accepts a family and an existing packed directory. [publish.ts](/Users/sivan/workspace/deepseek-harness/scripts/release/publish.ts#L130-L146) It publishes absent versions, skips matching content, and rejects existing versions with different content. [publish.ts](/Users/sivan/workspace/deepseek-harness/scripts/release/publish.ts#L150-L174)

These scripts provide separate npm artifacts, but not independently selectable capability releases through the family interface. [pack.ts](/Users/sivan/workspace/deepseek-harness/scripts/release/pack.ts#L52-L66) [publish.ts](/Users/sivan/workspace/deepseek-harness/scripts/release/publish.ts#L130-L174) The publication workflow starts manually and selects the DSH family for packing and publication. [release-publish.yml](/Users/sivan/workspace/deepseek-harness/.github/workflows/release-publish.yml#L8-L9) [release-publish.yml](/Users/sivan/workspace/deepseek-harness/.github/workflows/release-publish.yml#L55-L64) [release-publish.yml](/Users/sivan/workspace/deepseek-harness/.github/workflows/release-publish.yml#L128-L131) It separates artifact creation from the credentialed publication job. [release-publish.yml](/Users/sivan/workspace/deepseek-harness/.github/workflows/release-publish.yml#L82-L98) [release-publish.yml](/Users/sivan/workspace/deepseek-harness/.github/workflows/release-publish.yml#L105-L131)

### Independent release sequences

Vendor packages retain separate version lines and package-specific tag prefixes. [families.ts](/Users/sivan/workspace/deepseek-harness/scripts/release/families.ts#L375-L400) The vendor bump still advances every member of that family together. [bump.ts](/Users/sivan/workspace/deepseek-harness/scripts/release/bump.ts#L319-L343) The native workspace records version `0.1.2` and owns separate release scripts. [system/package.json](/Users/sivan/workspace/deepseek-harness/native/system/package.json#L2-L4) [system/package.json](/Users/sivan/workspace/deepseek-harness/native/system/package.json#L20-L26) The root DSH version is `0.2.0-rc.2`. [deepseek-harness/package.json](/Users/sivan/workspace/deepseek-harness/package.json#L2-L5)

A separate baseline publisher exists, but its source requires a stable root version before package discovery proceeds. [deepseek-harness/package.json](/Users/sivan/workspace/deepseek-harness/package.json#L195) [publish-npm-baseline.ts](/Users/sivan/workspace/deepseek-harness/scripts/publish-npm-baseline.ts#L247-L250) That requirement differs from the inspected prerelease root manifest. [publish-npm-baseline.ts](/Users/sivan/workspace/deepseek-harness/scripts/publish-npm-baseline.ts#L247-L250) [deepseek-harness/package.json](/Users/sivan/workspace/deepseek-harness/package.json#L3) This report does not treat that publisher as evidence that the current release path succeeds.

## Package supply and runtime composition

Package installation supplies code, bundle selection supplies configuration layers, and injection declares runtime service requirements. [profile.ts](/Users/sivan/workspace/deepseek-harness/packages/boot/app-boot/src/profile.ts#L5-L20) [Package entry](/Users/sivan/workspace/deepseek-harness/packages/shell/tool-bash/src/index.ts#L33-L34)

| Declaration | Source-level role | Evidence |
| --- | --- | --- |
| Package dependencies | The base bundle lists the concrete packages that its installation requires. | [base/package.json](/Users/sivan/workspace/deepseek-harness/packages/bundle/base/package.json#L31-L55) |
| `dsh.bundle.patch` | The bundle manifest identifies the configuration patch artifact. | [base/package.json](/Users/sivan/workspace/deepseek-harness/packages/bundle/base/package.json#L21-L34) |
| `dsh.profile.bundles` | The profile selects an ordered list of bundle layers. | [profile.ts](/Users/sivan/workspace/deepseek-harness/packages/boot/app-boot/src/profile.ts#L5-L14) |
| Patch rows | The base patch inserts named plugin rows into the composition. | [cordis.patch.yml](/Users/sivan/workspace/deepseek-harness/packages/bundle/base/cordis.patch.yml#L15-L41) |
| `inject` | The Bash tool requires `tools`, `shell`, `systemPrompt`, and `shellEnv` services. | [Package entry](/Users/sivan/workspace/deepseek-harness/packages/shell/tool-bash/src/index.ts#L33-L34) |
| Provider injection | The local Bash provider requires the `subprocess` service. | [Package entry](/Users/sivan/workspace/deepseek-harness/packages/shell/bash-local/src/index.ts#L97-L98) |

The base bundle entry module exports no runtime API. [Package entry](/Users/sivan/workspace/deepseek-harness/packages/bundle/base/src/index.ts#L1-L9) Its dependency list and patch document perform different jobs. [base/package.json](/Users/sivan/workspace/deepseek-harness/packages/bundle/base/package.json#L31-L55) [cordis.patch.yml](/Users/sivan/workspace/deepseek-harness/packages/bundle/base/cordis.patch.yml#L15-L41) Patch row order does not define activation order, according to the base composition source. [cordis.patch.yml](/Users/sivan/workspace/deepseek-harness/packages/bundle/base/cordis.patch.yml#L12-L13)

### Installed does not mean active

The profile inventory records bundle status and enabled status separately. [profile-plugins.ts](/Users/sivan/workspace/deepseek-harness/packages/boot/app-boot/src/profile-plugins.ts#L16-L25) [profile-plugins.ts](/Users/sivan/workspace/deepseek-harness/packages/boot/app-boot/src/profile-plugins.ts#L64-L76) Reconciliation automatically activates new bundle dependencies, while reporting ordinary additions separately. [profile-plugins.ts](/Users/sivan/workspace/deepseek-harness/packages/boot/app-boot/src/profile-plugins.ts#L94-L125) The loader reads only the selected bundle list when it builds bundle layers. [profile.ts](/Users/sivan/workspace/deepseek-harness/packages/boot/app-boot/src/profile.ts#L661-L679) Unresolved or incompatible bundles enter the skipped list instead of contributing a layer. [profile.ts](/Users/sivan/workspace/deepseek-harness/packages/boot/app-boot/src/profile.ts#L668-L682)

The host declares installation-supplied optional bundles that shipped templates do not select. [profile.ts](/Users/sivan/workspace/deepseek-harness/packages/boot/app-boot/src/profile.ts#L205-L218) This provides direct source evidence that installed capability packages can remain inactive. [profile.ts](/Users/sivan/workspace/deepseek-harness/packages/boot/app-boot/src/profile.ts#L205-L218)

### Package supply does not replace injection

The generated profile configuration uses hoisted linking and disables automatic peer installation. [profile.ts](/Users/sivan/workspace/deepseek-harness/packages/boot/app-boot/src/profile.ts#L226-L235) The runtime resolver supplies packages from the installation and selected bundles. [profile.ts](/Users/sivan/workspace/deepseek-harness/packages/boot/app-boot/src/profile.ts#L16-L20) Those mechanisms resolve package code, while `inject` names service requirements. [profile.ts](/Users/sivan/workspace/deepseek-harness/packages/boot/app-boot/src/profile.ts#L16-L20) [Package entry](/Users/sivan/workspace/deepseek-harness/packages/shell/tool-bash/src/index.ts#L33-L34) The boot documentation describes an injected-service failure as a waiting plugin entry, not a package installation request. [app-boot/README.md](/Users/sivan/workspace/deepseek-harness/packages/boot/app-boot/README.md#L96-L103)

## Commonality and exceptions

The sources support a shared organizational model with exceptions, rather than one mandatory shape for every capability. [adding-a-package.md](/Users/sivan/workspace/deepseek-harness/docs/cookbook/adding-a-package.md#L42-L44)

| Common arrangement | Exception or qualification | Evidence |
| --- | --- | --- |
| Capability groups contain packages. | A group itself contains no package manifest or source implementation. | [adding-a-package.md](/Users/sivan/workspace/deepseek-harness/docs/cookbook/adding-a-package.md#L25) |
| Independent responsibilities can use separate packages. | A single-purpose plugin remains one package. | [adding-a-package.md](/Users/sivan/workspace/deepseek-harness/docs/cookbook/adding-a-package.md#L44) |
| Ordinary packages participate in shared builds. | Distinct host and client compiler needs use explicitly split project leaves. | [packages/AGENTS.md](/Users/sivan/workspace/deepseek-harness/packages/AGENTS.md#L23) |
| Public DSH packages share a version. | Vendor and native packages follow separate release sequences. | [families.ts](/Users/sivan/workspace/deepseek-harness/scripts/release/families.ts#L321-L400) [system/package.json](/Users/sivan/workspace/deepseek-harness/native/system/package.json#L2-L26) |
| Release membership excludes private packages. | Experimental publication uses a default-public policy with an empty private exception list. | [families.ts](/Users/sivan/workspace/deepseek-harness/scripts/release/families.ts#L128-L145) [experimental-package-policy.ts](/Users/sivan/workspace/deepseek-harness/scripts/experimental-package-policy.ts#L1-L15) |
| Bundles install profile layers. | Domain groups can own bundles outside the bundle group. | [bundle/README.md](/Users/sivan/workspace/deepseek-harness/packages/bundle/README.md#L12) |
| Several shipped profiles build on the base bundle. | The minimal SDK profile supplies its complete tree through one standalone bundle. | [bundle/README.md](/Users/sivan/workspace/deepseek-harness/packages/bundle/README.md#L12-L30) |
| Plugin packages expose runtime services or behavior. | The timeout package is a library, and the base bundle has an empty runtime entry. | [timeout/README.md](/Users/sivan/workspace/deepseek-harness/packages/util/timeout/README.md#L1-L3) [Package entry](/Users/sivan/workspace/deepseek-harness/packages/bundle/base/src/index.ts#L1-L9) |

## Recommendations

These recommendations are proposals, not observations about required market changes.

Keep repository ownership, npm packaging, release selection, and runtime activation as separate design decisions. Use one repository when several packages need coordinated changes. Retain explicit exports and tests for each package. Split a service definition, provider, and consumer only when their responsibilities need independent evolution. Keep a single-purpose plugin together when a split provides no current benefit.

Use bundles to assemble packages, and use injection to state runtime service requirements. Do not interpret a peer declaration as an installation plan. Do not copy the host shared version policy without deciding whether the market needs coordinated releases.

These proposals use the observed package guidance, release policy, and profile mechanisms as comparison points. [adding-a-package.md](/Users/sivan/workspace/deepseek-harness/docs/cookbook/adding-a-package.md#L42-L44) [bump.ts](/Users/sivan/workspace/deepseek-harness/scripts/release/bump.ts#L273-L316) [profile.ts](/Users/sivan/workspace/deepseek-harness/packages/boot/app-boot/src/profile.ts#L226-L235)

## Execution evidence

### Repository inspection performed

The following transcript records read-only Git commands from this research pass. It provides execution evidence for repository state, not execution evidence for host behavior.

Host inspection:

```text
$ git rev-parse HEAD
c55d6205ff4f8a7e2b64647f5147a67b5bd5024f
$ git rev-parse @{upstream}
5badb15009ae1756c3afe0ae0cef1faafc290ccc
$ git rev-list --left-right --count HEAD...@{upstream}
2       266
$ git ls-files --stage | awk '$1 == "160000" {print}'
<no output>
$ git ls-files packages/core/agent/package.json packages/bundle/base/package.json pnpm-workspace.yaml
packages/bundle/base/package.json
packages/core/agent/package.json
pnpm-workspace.yaml
```

The host remote query returned exit code 128:

```text
fatal: unable to access 'https://github.com/deepseek-ai/deepseek-harness/': Failed to connect to github.com port 443 after 75015 ms: Couldn't connect to server
```

Market inspection:

```text
$ git rev-parse HEAD
c19f08a2cf8eb725fed338d07fc2ed2abe267366
$ git rev-parse refs/remotes/origin/dev
c19f08a2cf8eb725fed338d07fc2ed2abe267366
$ git status --short
<existing unrelated tracked modifications and untracked files>
```

The recorded host history diverges from its cached upstream by two local commits and 266 upstream commits. [Git divergence](/Users/sivan/workspace/dsh-agent-plugins-market/docs/developer/discussion/2026-10-06-host-multi-package-plugin-survey.md#repository-inspection-performed) The tracked-file command finds no Git submodule entries. [Git submodule scan](/Users/sivan/workspace/dsh-agent-plugins-market/docs/developer/discussion/2026-10-06-host-multi-package-plugin-survey.md#repository-inspection-performed) The selected manifests and workspace declaration belong to the host Git index. [Tracked files](/Users/sivan/workspace/dsh-agent-plugins-market/docs/developer/discussion/2026-10-06-host-multi-package-plugin-survey.md#repository-inspection-performed) These statements refer only to the command transcript above.

### Operations not performed

This research pass did not fetch remote history, install dependencies, build packages, run tests, or publish artifacts. It did not launch profiles or exercise bundle activation. It did not modify host files or architecture HTML. No runtime success, publication success, or green repository state is claimed.

## Dev Note

This report compares six capability families against the inspected source snapshot and published rc.2 artifacts. The host remote query failed, so the report does not claim coverage of the latest remote tree. The architecture proposal remains unchanged. Its next revision can use these findings after the product decisions are explicit.
