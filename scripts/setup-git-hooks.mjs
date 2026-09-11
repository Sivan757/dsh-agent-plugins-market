#!/usr/bin/env node
/**
 * Point git at the checked-in `.githooks/` directory.
 *
 * The alignment gate has to run on the developer's machine, not only in CI, so the hook is
 * versioned with the code instead of living in `.git/hooks`. `prepare` calls this on every
 * install, which keeps a fresh clone and an existing clone on the same hook without a hook
 * manager dependency.
 *
 * No-ops outside a work tree (a published tarball has no `.git`) and never fails the install.
 */
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join, resolve } from 'node:path'

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)))
const HOOKS_DIR = '.githooks'

const git = args =>
  execFileSync('git', args, { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'] })
    .toString()
    .trim()
/** A read whose failure just means "no value", unlike a write that must succeed. */
const gitRead = args => {
  try {
    return git(args)
  } catch {
    return undefined
  }
}

try {
  if (!existsSync(join(ROOT, HOOKS_DIR))) process.exit(0)
  if (gitRead(['rev-parse', '--is-inside-work-tree']) !== 'true') process.exit(0)
  // A relative path is resolved by git against the working-tree root, so the checkout stays
  // portable and a moved repository needs no reconfiguration beyond the next install.
  if (gitRead(['config', '--local', '--get', 'core.hooksPath']) !== HOOKS_DIR) {
    git(['config', '--local', 'core.hooksPath', HOOKS_DIR])
  }
} catch {
  // A published tarball, a shallow export, or a machine without git: nothing to configure.
}
