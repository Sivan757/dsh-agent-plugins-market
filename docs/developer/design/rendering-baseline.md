# Client rendering baseline

## Scope

The first performance measurement isolates market view-model derivation from browser and React scheduling. It verifies that normalized searchable fields are cached per response object and that repeated filtering performs one derived pass without rebuilding the searchable strings.

It does not claim to measure browser paint, React commit time, network latency, or host filesystem discovery.

## Reproduction

```sh
pnpm exec vitest run tests/client-view-models.test.ts --reporter verbose
```

The benchmark test creates 5,000 suite cards and performs 20 searches against the same overview object.

The observed run recorded `4.48ms` for 20 searches and `22,220` visible-card results in the Node/Vitest process.

The timing is an indicative local baseline, not a release threshold. Run it on the same machine and Node version when comparing later changes.

## Browser measurement to add before virtualization

Use the real Web GUI and record these paths with the browser Performance panel and React Profiler:

1. First open of Settings → Agent Plugins Market.
2. Search and source filtering over a large checkout catalog.
3. Grid/list switching while an MCP status detail modal is open.
4. Add-source progress polling while another panel remains mounted.

Record request count, host response time, browser scripting time, React commit duration, and the components rendered for each interaction.

The current refactor does not add list virtualization. Add it only when the real catalog size and profiler output show that list rendering, rather than discovery or network time, is the dominant cost.
