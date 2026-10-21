/**
 * Find source text that reaches a host subagent member outside the seam.
 *
 * The scan walks the TypeScript syntax tree instead of matching text, and it
 * resolves the receiver by type rather than by name: a value is a seam receiver
 * when its written type annotation names the seam type, or when it is derived
 * from the host subagent service. A property read on such a receiver that names
 * a host member is a finding, whatever the spelling around it.
 *
 * The scan parses, it does not type-check: there is no Program and no checker
 * here, because the same scan must run over fixture samples that have no
 * project. It resolves four things, and only these: a variable, parameter or
 * class field with a written annotation naming a seam type; an `as`,
 * `satisfies` or angle-bracket assertion on a value that is then bound to a name
 * or read directly in the receiver position; a derivation from the host
 * subagent service, including a lookup and a destructuring pattern; and the
 * declared return type of a function declaration or a method.
 *
 * Four shapes stay out of scope, named so this comment is not read as a proof.
 * A receiver whose seam type is only INFERRED and never written is not resolved.
 * Neither is the service carried inside an object literal and read back through
 * its property. Neither is an arrow function or function expression assigned to
 * a const, even when its return type is written on it, because only a function
 * declaration or a method contributes a declared return type. Neither is a class
 * field without a written annotation, even when the value assigned to it is
 * asserted, because a field resolves from its annotation alone. Running the
 * checker would close all four at the cost of a Program over the whole project,
 * which the fixture samples cannot join.
 *
 * @module packages/market-bundle/test/repo/helpers/subagent-member-scan
 */
import ts from 'typescript'
import { readdir } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

/** The confirmed root of the repository, used to make paths repo-relative. */
export const ROOT = fileURLToPath(new URL('../../../../../', import.meta.url))

/** The one module allowed to name a host subagent member. */
export const SEAM_MODULE = 'packages/market-runtime/src/runtime/agents/subagent-seam.ts'

/** The host service whose members stay behind the seam. */
export const SERVICE = 'subagents'

/** Every host subagent member a plugin file must not reach directly. */
export const HOST_MEMBERS = [
  'start',
  'startContinuable',
  'startActivation',
  'drainChildren',
  'drainContinuableChildren',
  'registerProvider',
  'getProvider',
  'waitForChildren',
  'sendMessage',
  'drainDescendants'
] as const

/** The subset this plugin actually drives, which the seam module must therefore name. */
export const DRIVEN_MEMBERS = ['start', 'startContinuable', 'startActivation', 'drainChildren', 'drainContinuableChildren', 'registerProvider'] as const

/** Type names that denote the host subagent service. */
const SEAM_TYPES = new Set(['SubagentSeam', 'ContinuableSubagentSeam', 'SubagentRuntime'])

/** How one source text reached a host member; the label is the spelling that got through. */
export type ReadShape =
  | 'service member'
  | 'optional chaining'
  | 'bracket access'
  | 'local alias'
  | 'destructuring'
  | 'service lookup'
  | 'typed variable'
  | 'typed parameter'
  | 'typed field'
  | 'typed assertion'

/** One host member read: the member and the spelling that reached it. */
export interface MemberRead {
  readonly member: string
  readonly shape: ReadShape
}

/** Names bound to a seam receiver inside one source file, with the spelling that bound them. */
interface SeamNames {
  readonly values: Map<string, ReadShape>
  readonly fields: Map<string, ReadShape>
}

/** Strip parentheses, assertions, and non-null wrappers so the receiver shape is reachable. */
function unwrap(node: ts.Expression): ts.Expression {
  let current = node
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isSatisfiesExpression(current) ||
    ts.isNonNullExpression(current) ||
    ts.isTypeAssertionExpression(current)
  ) {
    current = current.expression
  }
  return current
}

/**
 * Whether an expression asserts the seam type in writing, through `as`,
 * `satisfies`, or an angle-bracket assertion, at any depth of wrapping.
 *
 * The assertion is a written form even when the value under it is opaque: a call
 * to a function with no declared return type says nothing until its result is
 * asserted, and that assertion is what names the receiver.
 * @param expression - the expression to inspect.
 * @returns true when some wrapper names the seam type.
 */
function assertedSeamType(expression: ts.Expression): boolean {
  let current: ts.Expression = expression
  for (;;) {
    if (ts.isAsExpression(current) || ts.isSatisfiesExpression(current) || ts.isTypeAssertionExpression(current)) {
      if (isSeamType(current.type)) return true
      current = current.expression
      continue
    }
    if (ts.isParenthesizedExpression(current) || ts.isNonNullExpression(current)) {
      current = current.expression
      continue
    }
    return false
  }
}

/** The literal text of a string argument, when the argument is a plain literal. */
function literalText(node: ts.Expression | undefined): string | undefined {
  if (node === undefined) return undefined
  const expression = unwrap(node)
  if (ts.isStringLiteral(expression) || ts.isNoSubstitutionTemplateLiteral(expression)) return expression.text
  return undefined
}

/** Whether a type annotation names the seam type. */
function isSeamType(type: ts.TypeNode | undefined): boolean {
  if (type === undefined) return false
  let seam = false
  const visit = (node: ts.Node): void => {
    if (ts.isTypeReferenceNode(node)) {
      const name = ts.isIdentifier(node.typeName) ? node.typeName.text : node.typeName.right.text
      if (SEAM_TYPES.has(name)) seam = true
    }
    ts.forEachChild(node, visit)
  }
  visit(type)
  return seam
}

/** Whether an expression is the host subagent service itself: `x.subagents`, `x['subagents']`, or `x.get('subagents')`. */
function isServiceAccess(node: ts.Expression): boolean {
  const expression = unwrap(node)
  if (ts.isPropertyAccessExpression(expression)) return expression.name.text === SERVICE
  if (ts.isElementAccessExpression(expression)) return literalText(expression.argumentExpression) === SERVICE
  if (!ts.isCallExpression(expression)) return false
  const callee = unwrap(expression.expression)
  const isGet = (ts.isPropertyAccessExpression(callee) && callee.name.text === 'get') || (ts.isElementAccessExpression(callee) && literalText(callee.argumentExpression) === 'get')
  return isGet && literalText(expression.arguments[0]) === SERVICE
}

/** Collect the names one file binds to a seam receiver, then the seam-typed fields. */
function collectSeamNames(source: ts.SourceFile): SeamNames {
  const values = new Map<string, ReadShape>()
  const fields = new Map<string, ReadShape>()
  /** Function names whose declared return type is the seam, so an assigned call is a receiver. */
  const returnsSeam = new Set<string>()

  const bindDeclaration = (declaration: ts.VariableDeclaration): void => {
    if (ts.isIdentifier(declaration.name)) {
      const name = declaration.name.text
      // A written seam type is the strongest signal, whatever the initializer is.
      if (isSeamType(declaration.type)) values.set(name, 'typed variable')
      // An `as` or `satisfies` assertion is the next strongest: it names the seam
      // even when the value under it is opaque, and it is checked before the
      // service derivation so the assertion is what the failure reports.
      else if (declaration.initializer !== undefined && assertedSeamType(declaration.initializer)) values.set(name, 'typed assertion')
      else if (declaration.initializer !== undefined && isServiceAccess(declaration.initializer)) values.set(name, 'local alias')
      else if (declaration.initializer !== undefined && ts.isCallExpression(unwrap(declaration.initializer))) {
        const callee = unwrap((unwrap(declaration.initializer) as ts.CallExpression).expression)
        if (ts.isIdentifier(callee) && returnsSeam.has(callee.text)) values.set(name, 'typed variable')
      }
      return
    }
    // `const { subagents } = ctx` and `const { subagents: service } = ctx` both bind the service.
    if (!ts.isObjectBindingPattern(declaration.name)) return
    for (const element of declaration.name.elements) {
      const property = element.propertyName ?? element.name
      if (!ts.isIdentifier(property) || property.text !== SERVICE || !ts.isIdentifier(element.name)) continue
      values.set(element.name.text, 'destructuring')
    }
  }

  const visit = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node)) bindDeclaration(node)
    if (ts.isParameter(node) && ts.isIdentifier(node.name)) {
      if (isSeamType(node.type)) values.set(node.name.text, 'typed parameter')
      // A constructor parameter property is a field reachable through `this`.
      if (ts.isConstructorDeclaration(node.parent) && node.modifiers !== undefined && ts.getCombinedModifierFlags(node) !== ts.ModifierFlags.None) {
        if (isSeamType(node.type)) fields.set(node.name.text, 'typed field')
      }
    }
    if (ts.isPropertyDeclaration(node) && ts.isIdentifier(node.name) && isSeamType(node.type)) fields.set(node.name.text, 'typed field')
    if (ts.isFunctionDeclaration(node) && node.name !== undefined && isSeamType(node.type)) returnsSeam.add(node.name.text)
    if (ts.isMethodDeclaration(node) && ts.isIdentifier(node.name) && isSeamType(node.type)) returnsSeam.add(node.name.text)
    ts.forEachChild(node, visit)
  }
  visit(source)
  return { values, fields }
}

/** The spelling that binds `expression` to a seam receiver, or undefined when it is not one. */
function receiverShape(expression: ts.Expression, names: SeamNames): ReadShape | undefined {
  // A receiver asserted in place, as in `(makeSeam(ctx) as SubagentSeam).start(...)`.
  if (assertedSeamType(expression)) return 'typed assertion'
  const node = unwrap(expression)
  if (ts.isIdentifier(node)) return names.values.get(node.text)
  if (ts.isPropertyAccessExpression(node)) {
    // The service itself, as in `ctx.subagents` or `this.subagents`.
    if (node.name.text === SERVICE) return 'service member'
    // `this.<field>` for any other field declared with a seam type.
    if (node.expression.kind === ts.SyntaxKind.ThisKeyword) return names.fields.get(node.name.text)
    return undefined
  }
  if (ts.isElementAccessExpression(node)) return literalText(node.argumentExpression) === SERVICE ? 'service lookup' : undefined
  if (ts.isCallExpression(node)) return isServiceAccess(node) ? 'service lookup' : undefined
  return undefined
}

/** Read the host member a property or element access names, when the access reads a seam receiver. */
function readOf(node: ts.Node, names: SeamNames): MemberRead | undefined {
  if (ts.isPropertyAccessExpression(node)) {
    const shape = receiverShape(node.expression, names)
    if (shape === undefined) return undefined
    if (!(HOST_MEMBERS as readonly string[]).includes(node.name.text)) return undefined
    // An optional chain on the service access itself is its own spelling, because
    // the chain is the only thing between the author and the member. On an alias
    // or a destructured binding the binding is the finding, and it is reported.
    const direct = shape === 'service member' || shape === 'service lookup'
    return { member: node.name.text, shape: node.questionDotToken !== undefined && direct ? 'optional chaining' : shape }
  }
  if (ts.isElementAccessExpression(node)) {
    const shape = receiverShape(node.expression, names)
    if (shape === undefined) return undefined
    const member = literalText(node.argumentExpression)
    if (member === undefined || !(HOST_MEMBERS as readonly string[]).includes(member)) return undefined
    return { member, shape: 'bracket access' }
  }
  // `const { start } = ctx.subagents` reads the member through a destructuring pattern.
  if (ts.isVariableDeclaration(node) && ts.isObjectBindingPattern(node.name) && node.initializer !== undefined && receiverShape(node.initializer, names) !== undefined) {
    for (const element of node.name.elements) {
      const property = element.propertyName ?? element.name
      if (ts.isIdentifier(property) && (HOST_MEMBERS as readonly string[]).includes(property.text)) return { member: property.text, shape: 'destructuring' }
    }
  }
  return undefined
}

/**
 * Find every read of a host subagent member in one source text.
 * @param source - one TypeScript source file's text.
 * @returns one entry per member and spelling, in source order.
 */
export function findMemberReads(source: string): MemberRead[] {
  const file = ts.createSourceFile('scanned.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const names = collectSeamNames(file)
  const findings: MemberRead[] = []
  const visit = (node: ts.Node): void => {
    const read = readOf(node, names)
    if (read !== undefined) findings.push(read)
    ts.forEachChild(node, visit)
  }
  visit(file)
  const unique = new Map(findings.map(finding => [finding.member + ':' + finding.shape, finding]))
  return [...unique.values()]
}

/** Every TypeScript source file under packages/<pkg>/src, relative to the repository root. */
export async function sourceFiles(): Promise<string[]> {
  const visit = async (directory: string): Promise<string[]> => {
    const entries = await readdir(directory, { withFileTypes: true })
    const found = await Promise.all(
      entries.map(async entry => {
        const path = join(directory, entry.name)
        if (entry.isDirectory()) return visit(path)
        return /[.]tsx?$/.test(entry.name) ? [path] : []
      })
    )
    return found.flat()
  }
  const packagesDirectory = join(ROOT, 'packages')
  const names = (await readdir(packagesDirectory, { withFileTypes: true })).filter(entry => entry.isDirectory()).map(entry => entry.name)
  const files = (await Promise.all(names.map(name => visit(join(packagesDirectory, name, 'src'))))).flat()
  return files.map(file => relative(ROOT, file).replaceAll('\\', '/'))
}
