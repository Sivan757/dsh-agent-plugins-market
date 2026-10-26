import { describe, expect, it } from 'vitest'
import { APPENDED_INPUT_LABEL, expandCommandArguments, splitCommandInput } from '../src/application/command-arguments.js'

describe('command input splitting', () => {
  it('splits on whitespace', () => {
    expect(splitCommandInput('  payment-service   fast  ')).toEqual(['payment-service', 'fast'])
  })

  it('keeps a quoted segment whole and drops the quotes', () => {
    expect(splitCommandInput(`payment-service "the old billing service" 'core module'`)).toEqual(['payment-service', 'the old billing service', 'core module'])
  })

  it('joins an unquoted segment with the quoted one beside it', () => {
    expect(splitCommandInput(`--message "two words"`)).toEqual(['--message', 'two words'])
    expect(splitCommandInput(`a"b c"d`)).toEqual(['ab cd'])
  })

  it('keeps an empty quoted segment as one empty argument', () => {
    expect(splitCommandInput(`system ""`)).toEqual(['system', ''])
  })

  it('runs an unterminated quote to the end of the input', () => {
    expect(splitCommandInput('system "still typing')).toEqual(['system', 'still typing'])
  })
})

describe('command argument expansion', () => {
  it('binds declared names positionally', () => {
    const expansion = expandCommandArguments('Harden $system for $target_stack.', 'payment-service ".NET 8"', ['system', 'target_stack'])
    expect(expansion.text).toBe('Harden payment-service for .NET 8.')
    expect(expansion.missing).toEqual([])
  })

  it('binds a quoted argument as one value', () => {
    const expansion = expandCommandArguments('Scope: $module_pattern', 'billing "invoice lines"', ['system', 'module_pattern'])
    expect(expansion.text).toBe('Scope: invoice lines')
  })

  it('reports a declared argument the input left out and leaves it empty', () => {
    const expansion = expandCommandArguments('Uplift $system from $source_version to $target_version.', 'billing', ['system', 'source_version', 'target_version'])
    expect(expansion.text).toBe('Uplift billing from  to .')
    expect(expansion.missing).toEqual(['$source_version', '$target_version'])
  })

  it('does not report a declared argument the body never uses', () => {
    const expansion = expandCommandArguments('Status of $system.', 'billing', ['system', 'target_stack'])
    expect(expansion.missing).toEqual([])
  })

  it('substitutes $ARGUMENTS with the whole trimmed input', () => {
    const expansion = expandCommandArguments('Review: $ARGUMENTS', '  the staged diff  ', [])
    expect(expansion.text).toBe('Review: the staged diff')
  })

  it('substitutes $1..$N positionally', () => {
    const expansion = expandCommandArguments('Transform $1 module $2 into $3', 'legacy payments java', [])
    expect(expansion.text).toBe('Transform legacy module payments into java')
    expect(expansion.missing).toEqual([])
  })

  it('reports a positional placeholder the input left out', () => {
    const expansion = expandCommandArguments('Transform $1 module $2', 'legacy', [])
    expect(expansion.text).toBe('Transform legacy module ')
    expect(expansion.missing).toEqual(['$2'])
  })

  it('leaves an unknown dollar alone', () => {
    const expansion = expandCommandArguments('Run in $HOME with ${CLAUDE_PLUGIN_ROOT} and $? then $system', 'billing', ['system'])
    expect(expansion.text).toBe('Run in $HOME with ${CLAUDE_PLUGIN_ROOT} and $? then billing')
    expect(expansion.missing).toEqual([])
  })

  it('never re-reads a substituted value', () => {
    const expansion = expandCommandArguments('Harden $system.', '$system', ['system'])
    expect(expansion.text).toBe('Harden $system.')
  })

  it('appends the input to a body with no placeholder at all', () => {
    const expansion = expandCommandArguments('Follow the release checklist.\n', 'deploy staging', [])
    expect(expansion.text).toBe(`Follow the release checklist.\n\n${APPENDED_INPUT_LABEL}deploy staging`)
    expect(expansion.missing).toEqual([])
  })

  it('appends the input when only an undeclared name is written', () => {
    const expansion = expandCommandArguments('Harden $system.', 'payment-service', [])
    expect(expansion.text).toBe(`Harden $system.\n\n${APPENDED_INPUT_LABEL}payment-service`)
  })

  it('appends nothing when the input is empty', () => {
    const expansion = expandCommandArguments('Follow the checklist.\n', '   ', [])
    expect(expansion.text).toBe('Follow the checklist.\n')
  })

  it('expands placeholders inside a code fence like the rest of the body', () => {
    const expansion = expandCommandArguments('Run:\n\n```sh\npython3 scan.py $system\n```\n', 'billing', ['system'])
    expect(expansion.text).toBe('Run:\n\n```sh\npython3 scan.py billing\n```\n')
  })
})
