/**
 * Python adapter: import edges, class/function entities, class-body method
 * composition, and decorators, via tree-sitter-python.
 * @module @deepseek-ai/dsh-code-index-tree-sitter/src/python-adapter
 */
import { parse } from "./parser.js";
/** Recursively collect nodes of one type. */
function collect(node, type, out = []) {
    if (node.type === type)
        out.push(node);
    for (const child of node.children)
        collect(child, type, out);
    return out;
}
/** First direct child with the given type. */
function childOf(node, type) {
    return node.children.find(candidate => candidate.type === type);
}
/** Direct children with the given type. */
function childrenOf(node, type) {
    return node.children.filter(candidate => candidate.type === type);
}
/** Decorator names (e.g. `app.route` from `@app.route('/x')`). */
function decoratorsOf(node) {
    const decorators = [];
    for (const child of childrenOf(node, 'decorator')) {
        const inner = child.children.find(candidate => candidate.type === 'identifier'
            || candidate.type === 'dotted_name'
            || candidate.type === 'attribute'
            || candidate.type === 'call');
        if (inner === undefined)
            continue;
        const text = inner.text.replace(/\(.*$/, '').trim();
        if (text !== '')
            decorators.push(text);
    }
    return decorators;
}
/** Extract imports from one source file. */
function importsOf(relPath, statements) {
    const imports = [];
    for (const statement of statements) {
        if (statement.type === 'import_statement') {
            for (const dotted of collect(statement, 'dotted_name')) {
                if (dotted.text !== '')
                    imports.push({ from: relPath, to: dotted.text, names: [] });
            }
        }
        else if (statement.type === 'import_from_statement') {
            const moduleName = childOf(statement, 'module_name') ?? childOf(statement, 'dotted_name') ?? childOf(statement, 'relative_import');
            const to = moduleName === undefined ? '' : moduleName.text.replace(/^\.+/, '');
            if (to === '')
                continue;
            const names = [];
            // Items are the dotted_name/aliased_import children AFTER the `import`
            // keyword (tree-sitter-python 0.25 has no import_list wrapper node).
            let afterImport = false;
            for (const child of statement.children) {
                if (child.type === 'import') {
                    afterImport = true;
                    continue;
                }
                if (!afterImport)
                    continue;
                if (child.type === 'aliased_import') {
                    const first = child.children.find(candidate => candidate.type === 'dotted_name' || candidate.type === 'identifier');
                    if (first !== undefined)
                        names.push(first.text.split('.')[0] ?? first.text);
                }
                else if (child.type === 'dotted_name' || child.type === 'identifier') {
                    names.push(child.text.split('.')[0] ?? child.text);
                }
            }
            imports.push({ from: relPath, to, names });
        }
    }
    return imports;
}
/** Extract entities (with class-body method composition) from one source file. */
function entitiesOf(relPath, classes, functions) {
    const entities = [];
    const classSpans = [];
    for (const klass of classes) {
        classSpans.push({ start: klass.startPosition.row, end: klass.endPosition.row });
        const name = childOf(klass, 'identifier');
        if (name === undefined)
            continue;
        const entity = {
            name: name.text,
            kind: 'class',
            file: relPath,
            line: klass.startPosition.row + 1,
        };
        const modifiers = decoratorsOf(klass);
        if (modifiers.length > 0)
            entity.modifiers = modifiers;
        const body = childOf(klass, 'block');
        if (body !== undefined) {
            const children = [];
            for (const member of childrenOf(body, 'function_definition')) {
                const methodName = childOf(member, 'identifier');
                if (methodName === undefined)
                    continue;
                children.push({
                    name: methodName.text,
                    kind: 'method',
                    file: relPath,
                    line: member.startPosition.row + 1,
                });
            }
            if (children.length > 0)
                entity.children = children;
        }
        entities.push(entity);
    }
    for (const fn of functions) {
        // Module-level functions only: skip anything inside a class span (the
        // class body pass already recorded those as methods).
        if (classSpans.some(span => fn.startPosition.row > span.start && fn.startPosition.row < span.end))
            continue;
        const name = childOf(fn, 'identifier');
        if (name === undefined)
            continue;
        const entity = {
            name: name.text,
            kind: 'function',
            file: relPath,
            line: fn.startPosition.row + 1,
        };
        const modifiers = decoratorsOf(fn);
        if (modifiers.length > 0)
            entity.modifiers = modifiers;
        entities.push(entity);
    }
    return entities;
}
/**
 * Extract imports and entities from a Python source file.
 * @param relPath - file path relative to the workspace root.
 * @param source - source text.
 * @returns imports and entities.
 */
export function extractPython(relPath, source) {
    const tree = parse('python', source);
    const root = tree.rootNode;
    return {
        imports: importsOf(relPath, collect(root, 'import_statement').concat(collect(root, 'import_from_statement'))),
        entities: entitiesOf(relPath, collect(root, 'class_definition'), collect(root, 'function_definition')),
    };
}
//# sourceMappingURL=python-adapter.js.map