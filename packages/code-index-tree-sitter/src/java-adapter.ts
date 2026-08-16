/**
 * Java adapter: import edges, class/interface/enum entities, class-body
 * method/field composition, and annotations, via tree-sitter-java.
 * @module @deepseek-ai/dsh-code-index-tree-sitter/src/java-adapter
 */

import { parse, type TsNode } from './parser.ts'
import type { CodeEntity, CodeImport } from '@deepseek-ai/dsh-code-index'

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

/** Annotation names (e.g. `Service` from `@Service` / `@Service("x")`). */
function annotationsOf(node: TsNode): string[] {
  const annotations: string[] = []
  for (const child of childrenOf(node, 'annotation')) {
    const name = child.children.find(candidate =>
      candidate.type === 'identifier' || candidate.type === 'scoped_identifier')
    if (name === undefined) continue
    const text = name.text.replace(/@/, '')
    if (text !== '') annotations.push(text)
  }
  return annotations
}

/** Extract imports from one source file. */
function importsOf(relPath: string, statements: TsNode[]): CodeImport[] {
  const imports: CodeImport[] = []
  for (const statement of statements) {
    const text = statement.text.replace(/^import\s+/, '').replace(/;\s*$/, '').trim()
    if (text === '') continue
    const isStatic = text.startsWith('static ')
    const path = (isStatic ? text.slice('static '.length) : text).trim()
    if (path === '') continue
    imports.push({ from: relPath, to: path, names: [], ...(isStatic ? {} : {}) })
  }
  return imports
}

/** Extract entities (with class-body composition) from one source file. */
function entitiesOf(relPath: string, declarations: TsNode[]): CodeEntity[] {
  const entities: CodeEntity[] = []
  for (const declaration of declarations) {
    const kind = declaration.type === 'interface_declaration'
      ? 'interface'
      : declaration.type === 'enum_declaration'
        ? 'enum'
        : declaration.type === 'record_declaration'
          ? 'class'
          : 'class'
    const name = childOf(declaration, 'identifier')
    if (name === undefined) continue
    const entity: CodeEntity = {
      name: name.text,
      kind,
      file: relPath,
      line: declaration.startPosition.row + 1,
    }
    const modifiers = annotationsOf(declaration)
    if (modifiers.length > 0) entity.modifiers = modifiers
    const body = childOf(declaration, 'class_body')
    if (body !== undefined) {
      const children: CodeEntity[] = []
      for (const member of body.children) {
        if (member.type === 'method_declaration' || member.type === 'constructor_declaration') {
          const methodName = childOf(member, 'identifier')
          if (methodName === undefined) continue
          children.push({
            name: methodName.text,
            kind: 'method',
            file: relPath,
            line: member.startPosition.row + 1,
          })
        } else if (member.type === 'field_declaration') {
          for (const declarator of childrenOf(member, 'variable_declarator')) {
            const fieldName = childOf(declarator, 'identifier')
            if (fieldName === undefined) continue
            children.push({
              name: fieldName.text,
              kind: 'field',
              file: relPath,
              line: declarator.startPosition.row + 1,
            })
          }
        }
      }
      if (children.length > 0) entity.children = children
    }
    entities.push(entity)
  }
  return entities
}

/**
 * Extract imports and entities from a Java source file.
 * @param relPath - file path relative to the workspace root.
 * @param source - source text.
 * @returns imports and entities.
 */
export function extractJava(relPath: string, source: string): { imports: CodeImport[]; entities: CodeEntity[] } {
  const tree = parse('java', source)
  const root = tree.rootNode
  return {
    imports: importsOf(relPath, collect(root, 'import_declaration')),
    entities: entitiesOf(relPath, collect(root, 'class_declaration')
      .concat(collect(root, 'interface_declaration'))
      .concat(collect(root, 'enum_declaration'))
      .concat(collect(root, 'record_declaration'))),
  }
}
