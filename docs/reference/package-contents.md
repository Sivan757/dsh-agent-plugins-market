# Package contents

The published tarball is what a user installs, and it is smaller than the checkout: `files` in package.json decides what travels. An emitted module that imports a file the tarball does not carry compiles here, passes every test here, and fails only after installation.

`pnpm run check:package` (`scripts/check-package-contents.mjs`) walks the built `lib/` graph, resolves every relative specifier against the paths the manifest ships, and fails on either of two findings:

- `unresolved-import`: a specifier that names no file at all;
- `outside-package`: a specifier that resolves to a file the manifest does not ship.

It also reports `missing-entry` when `files` names a path that does not exist.

## Why it exists

The package keeps cross-package imports relative (`lib/packages/market-bundle` reaches `../../market-runtime/src/index.js`), because the sibling packages are private and a package specifier would not resolve for an installed user. That choice makes the built tree's own shape the contract, and nothing else checks it: `typecheck` resolves through tsconfig paths to `src/`, and the test suite runs against the repository rather than the tarball.

Measured on the current artifact: 189 modules, 531 relative specifiers, 0 findings, and the same check run against a real `pnpm pack` plus `npm install` install reports the same.

## The gap this closed in itself

The first version read only `from '...'` and `import('...')`, so a side-effect import (`import './setup.js'`) was invisible. The negative control caught it: a probe module importing a path the tarball does not carry passed the gate. Side-effect imports now have their own patterns, which matters because the client bundle and the emitted modules both load setup modules that way.
