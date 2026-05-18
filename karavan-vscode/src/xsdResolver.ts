/*
 * Licensed to the Apache Software Foundation (ASF) under one or more
 * contributor license agreements.  See the NOTICE file distributed with
 * this work for additional information regarding copyright ownership.
 * The ASF licenses this file to You under the Apache License, Version 2.0
 * (the "License"); you may not use this file except in compliance with
 * the License.  You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
import * as path from 'path';
import { XMLParser, XMLValidator } from 'fast-xml-parser';
import type { XsdNode, Warning } from './messages';

export type ReadFileFn = (absPath: string) => Promise<Buffer>;

const IMPORT_DEPTH_LIMIT = 20;

const XSD_ARRAY_TAGS = new Set([
    'xs:element', 'xsd:element',
    'xs:import', 'xsd:import',
    'xs:include', 'xsd:include',
    'xs:complexType', 'xsd:complexType',
    'xs:simpleType', 'xsd:simpleType',
    'xs:group', 'xsd:group',
    'xs:attributeGroup', 'xsd:attributeGroup',
    'xs:attribute', 'xsd:attribute',
    'xs:sequence', 'xsd:sequence',
    'xs:choice', 'xsd:choice',
    'xs:all', 'xsd:all',
    'xs:restriction', 'xsd:restriction',
    'xs:extension', 'xsd:extension',
    'xs:complexContent', 'xsd:complexContent',
    'xs:simpleContent', 'xsd:simpleContent',
    'xs:redefine', 'xsd:redefine',
]);

interface ParseCtx {
    readFile: ReadFileFn;
    visited: Set<string>;
    depth: number;
    warnings: Warning[];
    globalElements: Map<string, XsdNode>;
    globalTypes: Map<string, XsdNode>;
    globalGroups: Map<string, XsdNode>;
    /** Maps absolute XSD file path → targetNamespace URI */
    targetNsMap: Map<string, string>;
}

function arr<T>(v: T | T[] | undefined | null): T[] {
    if (v == null) return [];
    return Array.isArray(v) ? v : [v];
}

function localName(qname: string): string {
    const i = qname.indexOf(':');
    return i >= 0 ? qname.slice(i + 1) : qname;
}

function nsMap(schemaObj: Record<string, unknown>): Map<string, string> {
    const m = new Map<string, string>();
    for (const [k, v] of Object.entries(schemaObj)) {
        if (typeof v !== 'string') continue;
        if (k === '@_xmlns') m.set('', v);
        else if (k.startsWith('@_xmlns:')) m.set(k.slice(8), v);
    }
    return m;
}

function warn(code: string, message: string, detail?: string): Warning {
    return { code, message, detail, severity: 'error' };
}

function buildElementNode(
    el: Record<string, unknown>,
    parentPath: string,
    sourceFile: string,
    ctx: ParseCtx
): XsdNode | null {
    const ref = el['@_ref'] as string | undefined;
    if (ref) {
        const lname = localName(ref);
        const global = ctx.globalElements.get(lname);
        const nodePath = parentPath ? `${parentPath}.${lname}` : lname;
        if (global) {
            return { ...global, path: nodePath, children: global.children.map(c => rebase(c, nodePath)) };
        }
        return { name: lname, type: 'element', path: nodePath, sourceFile, children: [], warning: `Unresolved ref: ${ref}` };
    }

    const name = el['@_name'] as string | undefined;
    if (!name) return null;

    const nodePath = parentPath ? `${parentPath}.${name}` : name;
    const typeAttr = el['@_type'] as string | undefined;
    const children: XsdNode[] = [];

    for (const ct of arr(el['xs:complexType'] ?? el['xsd:complexType'])) {
        children.push(...buildComplexTypeChildren(ct as Record<string, unknown>, nodePath, sourceFile, ctx));
    }

    if (children.length === 0 && typeAttr) {
        if (!typeAttr.startsWith('xs:') && !typeAttr.startsWith('xsd:')) {
            const resolved = ctx.globalTypes.get(localName(typeAttr));
            if (resolved) {
                children.push(...resolved.children.map(c => rebase(c, nodePath)));
            }
        }
    }

    const node: XsdNode = { name, type: 'element', path: nodePath, sourceFile, children };
    if (typeAttr && children.length === 0) node.dataType = typeAttr;
    const nsUri = ctx.targetNsMap.get(sourceFile);
    if (nsUri) node.nsUri = nsUri;
    return node;
}

function rebase(node: XsdNode, newParentPath: string): XsdNode {
    const suffix = node.path.includes('.') ? node.path.slice(node.path.lastIndexOf('.') + 1) : node.path;
    const newPath = `${newParentPath}.${suffix}`;
    return { ...node, path: newPath, children: node.children.map(c => rebase(c, newPath)) };
}

function buildComplexTypeChildren(
    ct: Record<string, unknown>,
    parentPath: string,
    sourceFile: string,
    ctx: ParseCtx
): XsdNode[] {
    const children: XsdNode[] = [];

    for (const seqKey of ['xs:sequence', 'xsd:sequence', 'xs:choice', 'xsd:choice', 'xs:all', 'xsd:all']) {
        for (const seq of arr(ct[seqKey])) {
            children.push(...buildSequenceChildren(seq as Record<string, unknown>, parentPath, sourceFile, ctx));
        }
    }

    for (const ccKey of ['xs:complexContent', 'xsd:complexContent', 'xs:simpleContent', 'xsd:simpleContent']) {
        for (const cc of arr(ct[ccKey])) {
            for (const extKey of ['xs:extension', 'xsd:extension', 'xs:restriction', 'xsd:restriction']) {
                for (const ext of arr((cc as Record<string, unknown>)[extKey])) {
                    children.push(...buildComplexTypeChildren(ext as Record<string, unknown>, parentPath, sourceFile, ctx));
                }
            }
        }
    }

    for (const attr of arr(ct['xs:attribute'] ?? ct['xsd:attribute'])) {
        const attrObj = attr as Record<string, unknown>;
        const attrName = attrObj['@_name'] as string | undefined;
        if (attrName) {
            const attrType = attrObj['@_type'] as string | undefined;
            const attrNode: XsdNode = { name: attrName, type: 'attribute', path: `${parentPath}.@${attrName}`, sourceFile, children: [] };
            if (attrType) attrNode.dataType = attrType;
            const attrNsUri = ctx.targetNsMap.get(sourceFile);
            if (attrNsUri) attrNode.nsUri = attrNsUri;
            children.push(attrNode);
        }
    }

    for (const grpRef of arr(ct['xs:group'] ?? ct['xsd:group'])) {
        const ref = (grpRef as Record<string, unknown>)['@_ref'] as string | undefined;
        if (ref) children.push(...resolveGroupRef(ref, parentPath, sourceFile, ctx));
    }

    return children;
}

function buildSequenceChildren(
    seq: Record<string, unknown>,
    parentPath: string,
    sourceFile: string,
    ctx: ParseCtx
): XsdNode[] {
    const children: XsdNode[] = [];

    for (const el of arr(seq['xs:element'] ?? seq['xsd:element'])) {
        const node = buildElementNode(el as Record<string, unknown>, parentPath, sourceFile, ctx);
        if (node) children.push(node);
    }

    for (const seqKey of ['xs:sequence', 'xsd:sequence', 'xs:choice', 'xsd:choice', 'xs:all', 'xsd:all']) {
        for (const inner of arr(seq[seqKey])) {
            children.push(...buildSequenceChildren(inner as Record<string, unknown>, parentPath, sourceFile, ctx));
        }
    }

    for (const grpRef of arr(seq['xs:group'] ?? seq['xsd:group'])) {
        const ref = (grpRef as Record<string, unknown>)['@_ref'] as string | undefined;
        if (ref) children.push(...resolveGroupRef(ref, parentPath, sourceFile, ctx));
    }

    const anyTag = seq['xs:any'] ?? seq['xsd:any'];
    if (anyTag) {
        children.push({ name: '##any', type: 'any', path: `${parentPath}.##any`, sourceFile, children: [] });
    }

    return children;
}

function buildGroupChildren(
    grp: Record<string, unknown>,
    parentPath: string,
    sourceFile: string,
    ctx: ParseCtx
): XsdNode[] {
    const children: XsdNode[] = [];
    for (const seqKey of ['xs:sequence', 'xsd:sequence', 'xs:choice', 'xsd:choice', 'xs:all', 'xsd:all']) {
        for (const seq of arr(grp[seqKey])) {
            children.push(...buildSequenceChildren(seq as Record<string, unknown>, parentPath, sourceFile, ctx));
        }
    }
    return children;
}

function resolveGroupRef(ref: string, parentPath: string, sourceFile: string, ctx: ParseCtx): XsdNode[] {
    const lname = localName(ref);
    const grp = ctx.globalGroups.get(lname);
    if (grp) return grp.children.map(c => rebase(c, parentPath));
    return [{ name: lname, type: 'group', path: `${parentPath}.${lname}`, sourceFile, children: [], warning: `Unresolved group ref: ${ref}` }];
}

async function parseSchemaFile(absPath: string, ctx: ParseCtx): Promise<XsdNode[]> {
    if (ctx.visited.has(absPath)) return [];
    if (ctx.depth >= IMPORT_DEPTH_LIMIT) {
        ctx.warnings.push(warn('XSD_IMPORT_DEPTH_LIMIT', `Import chain depth limit (${IMPORT_DEPTH_LIMIT}) reached`, absPath));
        return [];
    }

    ctx.visited.add(absPath);
    ctx.depth++;

    let xmlContent: string;
    try {
        const buf = await ctx.readFile(absPath);
        xmlContent = buf.toString('utf8');
    } catch (err: any) {
        ctx.warnings.push(warn('XSD_FILE_NOT_FOUND', `Could not read XSD file: ${err.message}`, absPath));
        ctx.depth--;
        return [];
    }

    const validationResult = XMLValidator.validate(xmlContent);
    if (validationResult !== true) {
        const msg = typeof validationResult === 'object' && validationResult.err
            ? `line ${validationResult.err.line}: ${validationResult.err.msg}`
            : 'invalid XML';
        ctx.warnings.push(warn('XSD_PARSE_ERROR', `XML parse error in ${path.basename(absPath)}: ${msg}`, absPath));
        ctx.depth--;
        return [];
    }

    const parser = new XMLParser({
        ignoreAttributes: false,
        attributeNamePrefix: '@_',
        isArray: (tagName) => XSD_ARRAY_TAGS.has(tagName),
    });

    let parsed: Record<string, unknown>;
    try {
        parsed = parser.parse(xmlContent) as Record<string, unknown>;
    } catch (err: any) {
        ctx.warnings.push(warn('XSD_PARSE_ERROR', `XML parse error in ${path.basename(absPath)}: ${err.message}`, absPath));
        ctx.depth--;
        return [];
    }

    const schemaKey = Object.keys(parsed).find(k => k === 'xs:schema' || k === 'xsd:schema' || k.endsWith(':schema'));
    if (!schemaKey) {
        ctx.warnings.push(warn('XSD_PARSE_ERROR', `No xs:schema root element in ${path.basename(absPath)}`, absPath));
        ctx.depth--;
        return [];
    }

    const schema = parsed[schemaKey] as Record<string, unknown>;
    const targetNs = schema['@_targetNamespace'] as string | undefined;
    if (targetNs) ctx.targetNsMap.set(absPath, targetNs);
    const baseDir = path.dirname(absPath);

    for (const redef of arr(schema['xs:redefine'] ?? schema['xsd:redefine'])) {
        ctx.warnings.push(warn('XSD_UNSUPPORTED_REDEFINE', `xs:redefine is not supported`, absPath));
        void redef;
    }

    // Parse imports and includes first to populate global registries
    for (const imp of arr(schema['xs:import'] ?? schema['xsd:import'])) {
        const loc = (imp as Record<string, unknown>)['@_schemaLocation'] as string | undefined;
        if (loc) await parseSchemaFile(path.resolve(baseDir, loc), ctx);
    }
    for (const inc of arr(schema['xs:include'] ?? schema['xsd:include'])) {
        const loc = (inc as Record<string, unknown>)['@_schemaLocation'] as string | undefined;
        if (loc) await parseSchemaFile(path.resolve(baseDir, loc), ctx);
    }

    const topNodes: XsdNode[] = [];

    // Top-level complexTypes
    for (const ct of arr(schema['xs:complexType'] ?? schema['xsd:complexType'])) {
        const ctObj = ct as Record<string, unknown>;
        const name = ctObj['@_name'] as string | undefined;
        if (!name) continue;
        const node: XsdNode = {
            name,
            type: 'complexType',
            path: name,
            sourceFile: absPath,
            children: buildComplexTypeChildren(ctObj, name, absPath, ctx),
        };
        topNodes.push(node);
        ctx.globalTypes.set(name, node);
    }

    // Top-level simpleTypes
    for (const st of arr(schema['xs:simpleType'] ?? schema['xsd:simpleType'])) {
        const stObj = st as Record<string, unknown>;
        const name = stObj['@_name'] as string | undefined;
        if (!name) continue;
        const node: XsdNode = { name, type: 'simpleType', path: name, sourceFile: absPath, children: [] };
        topNodes.push(node);
        ctx.globalTypes.set(name, node);
    }

    // Top-level groups (must be before elements so group refs can be resolved)
    for (const grp of arr(schema['xs:group'] ?? schema['xsd:group'])) {
        const grpObj = grp as Record<string, unknown>;
        const name = grpObj['@_name'] as string | undefined;
        if (!name) continue;
        const node: XsdNode = {
            name,
            type: 'group',
            path: name,
            sourceFile: absPath,
            children: buildGroupChildren(grpObj, name, absPath, ctx),
        };
        topNodes.push(node);
        ctx.globalGroups.set(name, node);
    }

    // Top-level elements
    for (const el of arr(schema['xs:element'] ?? schema['xsd:element'])) {
        const node = buildElementNode(el as Record<string, unknown>, '', absPath, ctx);
        if (node) {
            topNodes.push(node);
            ctx.globalElements.set(node.name, node);
        }
    }

    ctx.depth--;
    return topNodes;
}

/**
 * Pure, testable XSD tree builder. Accepts an absolute path and injectable readFile.
 * Parses the XSD, follows xs:import / xs:include chains (depth limit 20), resolves
 * xs:group and xs:element ref attributes, and returns a typed XsdNode tree + warnings.
 */
export async function buildXsdTree(
    absPath: string,
    readFile: ReadFileFn
): Promise<{ root: XsdNode; warnings: Warning[] }> {
    const ctx: ParseCtx = {
        readFile,
        visited: new Set(),
        depth: 0,
        warnings: [],
        globalElements: new Map(),
        globalTypes: new Map(),
        globalGroups: new Map(),
        targetNsMap: new Map(),
    };

    const topNodes = await parseSchemaFile(absPath, ctx);

    const filename = path.basename(absPath, path.extname(absPath));
    const root: XsdNode = topNodes.length === 1
        ? topNodes[0]
        : {
            name: filename,
            type: 'complexType',
            path: '',
            sourceFile: absPath,
            children: topNodes,
        };

    return { root, warnings: ctx.warnings };
}

/**
 * Production entry point. Resolves a stored path (file:{{project.root.*}}/…) to an
 * absolute path via propertiesResolver, then delegates to buildXsdTree using
 * vscode.workspace.fs for file I/O. paramName is included in XSD_FILE_NOT_FOUND
 * warnings so callers can surface the YAML parameter name responsible.
 */
export async function resolveXsdTree(
    storedPath: string,
    workspaceRoot: string,
    paramName?: string
): Promise<{ root: XsdNode; warnings: Warning[] }> {
    const { resolveStoredPath } = await import('./propertiesResolver');
    const vscode = await import('vscode');
    const absPath = await resolveStoredPath(storedPath, workspaceRoot);
    const readFile: ReadFileFn = async (p: string) =>
        Buffer.from(await vscode.workspace.fs.readFile(vscode.Uri.file(p)));
    const result = await buildXsdTree(absPath, readFile);
    if (paramName) {
        for (const w of result.warnings) {
            if (w.code === 'XSD_FILE_NOT_FOUND' && w.detail === absPath) {
                w.detail = `${absPath} (YAML parameter: ${paramName})`;
            }
        }
    }
    return result;
}
