/**
 * TypeScript adapter: import edges, class/interface/enum/function entities,
 * class-body composition, and decorators, via tree-sitter-typescript.
 * @module @deepseek-ai/dsh-code-index-tree-sitter/src/ts-adapter
 */

import { parse, type TsNode } from './parser.ts'
import type { CallEdge, CodeEntity, CodeImport } from '@deepseek-ai/dsh-code-index'

/** Recursively collect nodes of one type. */
function collect(node: TsNode, type: string, out: TsNode[] = []): TsNode[] {
  if (node.type === type) out.push(node)
  for (const child of node.children) collect(child, type, out)
  return out
}

/** First direct child with the given type. */
function childOf(node: TsNode, type: string): TsNode | undefined {
  return node.children.find(candidate => candidate.type === type)
}

/** Direct children with the given type. */
function childrenOf(node: TsNode, type: string): TsNode[] {
  return node.children.filter(candidate => candidate.type === type)
}

/** Text of the node's `name` field child (identifier/type_identifier/property_identifier). */
function nameOf(node: TsNode): string {
  const name = node.children.find(candidate =>
    candidate.type === 'identifier'
    || candidate.type === 'type_identifier'
    || candidate.type === 'property_identifier'
    || candidate.type === 'abstract')
  return name === undefined ? '' : name.text
}

/** Decorator names attached to a declaration (e.g. `Component` from `@Component()`). */
function decoratorsOf(node: TsNode): string[] {
  const decorators: string[] = []
  for (const child of node.children) {
    if (child.type !== 'decorator') continue
    const inner = child.children.find(candidate =>
      candidate.type === 'identifier'
      || candidate.type === 'call_expression'
      || candidate.type === 'member_expression')
    if (inner === undefined) continue
    const text = inner.text.replace(/\(.*$/, '').trim()
    if (text !== '') decorators.push(text)
  }
  return decorators
}

/** Extract imports from one source file. */
function importsOf(relPath: string, statements: TsNode[]): CodeImport[] {
  const imports: CodeImport[] = []
  for (const statement of statements) {
    const source = childOf(statement, 'string')
    if (source === undefined) continue
    const to = source.text.slice(1, -1)
    if (to === '') continue
    const typeOnly = statement.text.startsWith('import type')
    const names: string[] = []
    const clause = childOf(statement, 'import_clause')
    if (clause !== undefined) {
      for (const spec of childrenOf(clause, 'import_specifier')) {
        const name = childOf(spec, 'identifier') ?? childOf(spec, 'type_identifier')
        if (name !== undefined) names.push(name.text)
      }
      for (const ns of childrenOf(clause, 'namespace_import')) {
        const alias = childOf(ns, 'identifier')
        if (alias !== undefined) names.push(alias.text)
      }
      for (const ns of childrenOf(clause, 'named_imports')) {
        for (const spec of childrenOf(ns, 'import_specifier')) {
          const name = childOf(spec, 'identifier') ?? childOf(spec, 'type_identifier')
          if (name !== undefined) names.push(name.text)
        }
      }
    }
    imports.push({ from: relPath, to, names, ...(typeOnly ? { typeOnly: true } : {}) })
  }
  return imports
}

/** Extract entities (with class-body composition) from one source file. */
function entitiesOf(relPath: string, declarations: TsNode[]): CodeEntity[] {
  const entities: CodeEntity[] = []
  for (const declaration of declarations) {
    const kind = declaration.type === 'class_declaration' || declaration.type === 'abstract_class_declaration'
      ? 'class'
      : declaration.type === 'interface_declaration'
        ? 'interface'
        : declaration.type === 'enum_declaration'
          ? 'enum'
          : declaration.type === 'type_alias_declaration'
            ? 'type'
            : 'function'
    const name = nameOf(declaration)
    if (name === '') continue
    const entity: CodeEntity = {
      name,
      kind,
      file: relPath,
      line: declaration.startPosition.row + 1,
    }
    const modifiers = decoratorsOf(declaration)
    if (modifiers.length > 0) entity.modifiers = modifiers
    // Composition: class/interface/enum bodies contribute methods and fields.
    if (kind === 'class' || kind === 'interface' || kind === 'enum') {
      const body = childOf(declaration, 'class_body')
      if (body !== undefined) {
        const children: CodeEntity[] = []
        for (const member of body.children) {
          if (member.type === 'method_definition' || member.type === 'abstract_method_signature') {
            const methodName = nameOf(member)
            if (methodName === '') continue
            children.push({
              name: methodName,
              kind: 'method',
              file: relPath,
              line: member.startPosition.row + 1,
            })
          } else if (member.type === 'public_field_definition' || member.type === 'field_definition') {
            const fieldName = nameOf(member)
            if (fieldName === '') continue
            children.push({
              name: fieldName,
              kind: 'field',
              file: relPath,
              line: member.startPosition.row + 1,
            })
          }
        }
        if (children.length > 0) entity.children = children
      }
    }
    entities.push(entity)
  }
  return entities
}

/**
 * Extract imports, entities, and call edges from a TypeScript source file.
 * One parse serves all three extractions (a second parse per file roughly
 * doubles full-workspace re-index time on large repos).
 * @param relPath - file path relative to the workspace root.
 * @param source - source text.
 * @returns imports, entities, and raw call edges.
 */
export function extractTs(relPath: string, source: string): { imports: CodeImport[]; entities: CodeEntity[]; calls: CallEdge[] } {
  const tree = parse('typescript', source)
  const root = tree.rootNode
  return {
    imports: importsOf(relPath, collect(root, 'import_statement')),
    entities: entitiesOf(relPath, collect(root, 'class_declaration')
      .concat(collect(root, 'abstract_class_declaration'))
      .concat(collect(root, 'interface_declaration'))
      .concat(collect(root, 'enum_declaration'))
      .concat(collect(root, 'type_alias_declaration'))
      .concat(collect(root, 'function_declaration'))),
    calls: callsOf(relPath, root),
  }
}

/** Call-site symbols that carry no architecture signal (globals/stdlib). */
const GLOBAL_CALLS = new Set([
  'console', 'require', 'process', 'Object', 'Array', 'String', 'Number',
  'Boolean', 'JSON', 'Math', 'Date', 'Promise', 'RegExp', 'Map', 'Set',
  'Symbol', 'Error', 'setTimeout', 'setInterval', 'clearTimeout', 'clearInterval',
  'parseInt', 'parseFloat', 'isNaN', 'isFinite', 'fetch', 'structuredClone',
  'queueMicrotask', 'encodeURIComponent', 'decodeURIComponent',
])

/** Last identifier/property in a call target (`a.b.c()` → `c`, `foo()` → `foo`). */
function calleeOf(node: TsNode): string {
  // call_expression children: the call target (identifier / member_expression
  // / optional_chain …) comes before `arguments`.
  const fn = node.children.find(candidate =>
    candidate.type === 'identifier'
    || candidate.type === 'member_expression'
    || candidate.type === 'optional_chain')
  if (fn === undefined) return ''
  const scan = (n: TsNode): string => {
    if (n.type === 'identifier' || n.type === 'property_identifier') return n.text
    for (let i = n.children.length - 1; i >= 0; i -= 1) {
      const text = scan(n.children[i]!)
      if (text !== '') return text
    }
    return ''
  }
  return scan(fn)
}

/** Root object of a call target (`a.b.c()` → `a`, `foo()` → `foo`). */
function rootOf(node: TsNode): string {
  const fn = node.children.find(candidate =>
    candidate.type === 'identifier'
    || candidate.type === 'member_expression'
    || candidate.type === 'optional_chain')
  if (fn === undefined) return ''
  if (fn.type === 'identifier') return fn.text
  const scan = (n: TsNode): string => {
    if (n.type === 'identifier') return n.text
    for (const child of n.children) {
      const text = scan(child)
      if (text !== '') return text
    }
    return ''
  }
  return scan(fn)
}

/**
 * Extract raw call edges: every `call_expression` inside a function/class
 * body, tagged with the enclosing function/class name when resolvable.
 * Bounded per file; globals and framework-level noise are skipped.
 * @param relPath - file path relative to the workspace root.
 * @param root - the already-parsed syntax tree root.
 */
function callsOf(relPath: string, root: TsNode): CallEdge[] {
  const out: CallEdge[] = []
  const LIMIT = 200
  const walk = (node: TsNode, fnName: string | undefined, clsName: string | undefined): boolean => {
    let fn = fnName
    let cls = clsName
    if (node.type === 'function_declaration') {
      fn = node.children.find(candidate => candidate.type === 'identifier')?.text ?? fnName
    } else if (node.type === 'method_definition' || node.type === 'abstract_method_signature') {
      fn = node.children.find(candidate =>
        candidate.type === 'property_identifier' || candidate.type === 'identifier')?.text ?? fnName
    } else if (node.type === 'class_declaration' || node.type === 'abstract_class_declaration') {
      cls = node.children.find(candidate =>
        candidate.type === 'type_identifier' || candidate.type === 'identifier')?.text ?? clsName
    }
    if (node.type === 'call_expression') {
      const to = calleeOf(node)
      const root = rootOf(node)
      if (to !== '' && !GLOBAL_CALLS.has(to) && !GLOBAL_CALLS.has(root) && !to.startsWith('$')) {
        const edge: CallEdge = { fromFile: relPath, to, line: node.startPosition.row + 1 }
        if (fn !== undefined || cls !== undefined) edge.from = fn ?? cls
        out.push(edge)
        if (out.length >= LIMIT) return false
      }
    }
    for (const child of node.children) {
      if (!walk(child, fn, cls)) return false
    }
    return true
  }
  walk(root, undefined, undefined)
  return out
}
