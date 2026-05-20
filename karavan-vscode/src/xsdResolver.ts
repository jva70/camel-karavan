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
    /** Keyed by both qualified "{ns}:name" and unqualified "name" for fallback lookups. */
    globalGroups: Map<string, XsdNode>;
    targetNsMap: Map<string, string>;
    paramName?: string;
    /** Absolute path of the root XSD file passed to buildXsdTree — used to capture rawSource. */
    primaryAbsPath: string;
    /** UTF-8 content of the root XSD file, captured on first read. */
    primaryRawSource?: string;
}

function arr<T>(v: T | T[] | undefined | null): T[] {
    if (v == null) return [];
    return Array.isArray(v) ? v : [v];
}

function localName(qname: string): string {
    const i = qname.indexOf(':');
    return i >= 0 ? qname.slice(i + 1) : qname;
}

/** Build prefix→namespace URI map from xs:schema attributes. */
function buildNsMap(schemaObj: Record<string, unknown>): Map<string, string> {
    const m = new Map<string, string>();
    for (const [k, v] of Object.entries(schemaObj)) {
        if (typeof v !== 'string') continue;
        if (k === '@_xmlns') m.set('', v);
        else if (k.startsWith('@_xmlns:')) m.set(k.slice(8), v);
    }
    return m;
}

/**
 * Resolve a prefixed qname (e.g. "tns:Foo") to a registry lookup key.
 * Returns "{nsURI}:localName" when the prefix resolves via fileNsMap, else just localName.
 */
function resolveKey(qname: string, fileNsMap: Map<string, string>): string {
    const i = qname.indexOf(':');
    if (i < 0) return qname;
    const prefix = qname.slice(0, i);
    const local = qname.slice(i + 1);
    const nsUri = fileNsMap.get(prefix);
    return nsUri ? `${nsUri}:${local}` : local;
}

function warn(code: string, message: string, detail?: string): Warning {
    return { code, message, detail, severity: 'error' };
}

/**
 * Rebase a node's path under a new parent.
 * P5: uses only the leaf segment (after the last dot) to prevent path corruption
 * from node.path values that contain unexpected separators or empty strings.
 */
function rebase(node: XsdNode, newParentPath: string): XsdNode {
    const lastDot = node.path.lastIndexOf('.');
    const suffix = lastDot >= 0 ? node.path.slice(lastDot + 1) : node.path;
    const newPath = suffix ? `${newParentPath}.${suffix}` : newParentPath;
    return { ...node, path: newPath, children: node.children.map(c => rebase(c, newPath)) };
}

function buildElementNode(
    el: Record<string, unknown>,
    parentPath: string,
    sourceFile: string,
    ctx: ParseCtx,
    fileNsMap: Map<string, string>,
): XsdNode | null {
    const ref = el['@_ref'] as string | undefined;
    if (ref) {
        const lname = localName(ref);
        const key = resolveKey(ref, fileNsMap);
        const global = ctx.globalElements.get(key) ?? ctx.globalElements.get(lname);
        const nodePath = parentPath ? `${parentPath}.${lname}` : lname;
        if (global) {
            return { ...global, path: nodePath, children: global.children.map(c => rebase(c, nodePath)) };
        }
        const w = `Unresolved ref: ${ref}`;
        ctx.warnings.push(warn('XSD_UNRESOLVED_REF', w, sourceFile)); // P10
        return { name: lname, type: 'element', path: nodePath, sourceFile, children: [], warning: w };
    }

    const name = el['@_name'] as string | undefined;
    if (!name) return null;

    const nodePath = parentPath ? `${parentPath}.${name}` : name;
    const typeAttr = el['@_type'] as string | undefined;
    const children: XsdNode[] = [];

    for (const ct of arr(el['xs:complexType'] ?? el['xsd:complexType'])) {
        children.push(...buildComplexTypeChildren(ct as Record<string, unknown>, nodePath, sourceFile, ctx, fileNsMap));
    }

    if (children.length === 0 && typeAttr) {
        if (!typeAttr.startsWith('xs:') && !typeAttr.startsWith('xsd:')) {
            const key = resolveKey(typeAttr, fileNsMap);
            const resolved = ctx.globalTypes.get(key) ?? ctx.globalTypes.get(localName(typeAttr));
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

function buildComplexTypeChildren(
    ct: Record<string, unknown>,
    parentPath: string,
    sourceFile: string,
    ctx: ParseCtx,
    fileNsMap: Map<string, string>,
): XsdNode[] {
    const children: XsdNode[] = [];

    for (const seqKey of ['xs:sequence', 'xsd:sequence', 'xs:choice', 'xsd:choice', 'xs:all', 'xsd:all']) {
        for (const seq of arr(ct[seqKey])) {
            children.push(...buildSequenceChildren(seq as Record<string, unknown>, parentPath, sourceFile, ctx, fileNsMap));
        }
    }

    for (const ccKey of ['xs:complexContent', 'xsd:complexContent', 'xs:simpleContent', 'xsd:simpleContent']) {
        for (const cc of arr(ct[ccKey])) {
            const ccObj = cc as Record<string, unknown>;
            for (const extKey of ['xs:extension', 'xsd:extension']) {
                for (const ext of arr(ccObj[extKey])) {
                    const extObj = ext as Record<string, unknown>;
                    // P16: resolve xs:extension base — prepend inherited fields
                    const base = extObj['@_base'] as string | undefined;
                    if (base) {
                        const baseKey = resolveKey(base, fileNsMap);
                        const baseType = ctx.globalTypes.get(baseKey) ?? ctx.globalTypes.get(localName(base));
                        if (baseType) {
                            children.push(...baseType.children.map(c => rebase(c, parentPath)));
                        }
                    }
                    children.push(...buildComplexTypeChildren(extObj, parentPath, sourceFile, ctx, fileNsMap));
                }
            }
            for (const rstKey of ['xs:restriction', 'xsd:restriction']) {
                for (const rst of arr(ccObj[rstKey])) {
                    children.push(...buildComplexTypeChildren(rst as Record<string, unknown>, parentPath, sourceFile, ctx, fileNsMap));
                }
            }
        }
    }

    for (const attr of arr(ct['xs:attribute'] ?? ct['xsd:attribute'])) {
        const attrObj = attr as Record<string, unknown>;
        const attrName = attrObj['@_name'] as string | undefined;
        if (attrName) {
            const attrType = attrObj['@_type'] as string | undefined;
            const attrNode: XsdNode = {
                name: attrName,
                type: 'attribute',
                path: `${parentPath}.@${attrName}`,
                sourceFile,
                children: [],
            };
            if (attrType) attrNode.dataType = attrType;
            const attrNsUri = ctx.targetNsMap.get(sourceFile);
            if (attrNsUri) attrNode.nsUri = attrNsUri;
            children.push(attrNode);
        }
    }

    for (const grpRef of arr(ct['xs:group'] ?? ct['xsd:group'])) {
        const ref = (grpRef as Record<string, unknown>)['@_ref'] as string | undefined;
        if (ref) children.push(...resolveGroupRef(ref, parentPath, sourceFile, ctx, fileNsMap));
    }

    // P4: expand xs:attributeGroup references
    for (const agRef of arr(ct['xs:attributeGroup'] ?? ct['xsd:attributeGroup'])) {
        const ref = (agRef as Record<string, unknown>)['@_ref'] as string | undefined;
        if (ref) {
            const key = resolveKey(ref, fileNsMap);
            const grp = ctx.globalGroups.get(key) ?? ctx.globalGroups.get(localName(ref));
            if (grp) {
                children.push(...grp.children.map(c => rebase(c, parentPath)));
            } else {
                const w = `Unresolved attributeGroup ref: ${ref}`;
                ctx.warnings.push(warn('XSD_UNRESOLVED_REF', w, sourceFile)); // P10
                children.push({
                    name: localName(ref),
                    type: 'attributeGroup',
                    path: `${parentPath}.${localName(ref)}`,
                    sourceFile,
                    children: [],
                    warning: w,
                });
            }
        }
    }

    return children;
}

function buildSequenceChildren(
    seq: Record<string, unknown>,
    parentPath: string,
    sourceFile: string,
    ctx: ParseCtx,
    fileNsMap: Map<string, string>,
): XsdNode[] {
    const children: XsdNode[] = [];

    for (const el of arr(seq['xs:element'] ?? seq['xsd:element'])) {
        const node = buildElementNode(el as Record<string, unknown>, parentPath, sourceFile, ctx, fileNsMap);
        if (node) children.push(node);
    }

    for (const seqKey of ['xs:sequence', 'xsd:sequence', 'xs:choice', 'xsd:choice', 'xs:all', 'xsd:all']) {
        for (const inner of arr(seq[seqKey])) {
            children.push(...buildSequenceChildren(inner as Record<string, unknown>, parentPath, sourceFile, ctx, fileNsMap));
        }
    }

    for (const grpRef of arr(seq['xs:group'] ?? seq['xsd:group'])) {
        const ref = (grpRef as Record<string, unknown>)['@_ref'] as string | undefined;
        if (ref) children.push(...resolveGroupRef(ref, parentPath, sourceFile, ctx, fileNsMap));
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
    ctx: ParseCtx,
    fileNsMap: Map<string, string>,
): XsdNode[] {
    const children: XsdNode[] = [];
    for (const seqKey of ['xs:sequence', 'xsd:sequence', 'xs:choice', 'xsd:choice', 'xs:all', 'xsd:all']) {
        for (const seq of arr(grp[seqKey])) {
            children.push(...buildSequenceChildren(seq as Record<string, unknown>, parentPath, sourceFile, ctx, fileNsMap));
        }
    }
    return children;
}

function resolveGroupRef(
    ref: string,
    parentPath: string,
    sourceFile: string,
    ctx: ParseCtx,
    fileNsMap: Map<string, string>,
): XsdNode[] {
    const lname = localName(ref);
    const key = resolveKey(ref, fileNsMap);
    const grp = ctx.globalGroups.get(key) ?? ctx.globalGroups.get(lname);
    if (grp) return grp.children.map(c => rebase(c, parentPath));
    const w = `Unresolved group ref: ${ref}`;
    ctx.warnings.push(warn('XSD_UNRESOLVED_REF', w, sourceFile)); // P10
    return [{ name: lname, type: 'group', path: `${parentPath}.${lname}`, sourceFile, children: [], warning: w }];
}

async function parseSchemaFile(absPath: string, ctx: ParseCtx): Promise<XsdNode[]> {
    // P12: mark visited before depth check — prevents partial revisit from alternative import paths
    if (ctx.visited.has(absPath)) return [];
    ctx.visited.add(absPath);

    if (ctx.depth >= IMPORT_DEPTH_LIMIT) {
        ctx.warnings.push(warn('XSD_IMPORT_DEPTH_LIMIT', `Import chain depth limit (${IMPORT_DEPTH_LIMIT}) reached`, absPath));
        return [];
    }

    // P1: try/finally guarantees depth is always decremented even on unexpected throws
    ctx.depth++;
    try {
        let xmlContent: string;
        try {
            const buf = await ctx.readFile(absPath);
            // P7: strip UTF-8 BOM before validation — BOM (0xFEFF) causes false XSD_PARSE_ERROR
            xmlContent = buf.toString('utf8').replace(/^﻿/, '');
            if (absPath === ctx.primaryAbsPath) ctx.primaryRawSource = xmlContent;
        } catch (err: any) {
            // P11: include paramName in detail when available
            const paramSuffix = ctx.paramName ? ` (YAML parameter: ${ctx.paramName})` : '';
            ctx.warnings.push(warn('XSD_FILE_NOT_FOUND', `Could not read XSD file: ${err.message}`, `${absPath}${paramSuffix}`));
            return [];
        }

        const validationResult = XMLValidator.validate(xmlContent);
        if (validationResult !== true) {
            const msg = typeof validationResult === 'object' && validationResult.err
                ? `line ${validationResult.err.line}: ${validationResult.err.msg}`
                : 'invalid XML';
            ctx.warnings.push(warn('XSD_PARSE_ERROR', `XML parse error in ${path.basename(absPath)}: ${msg}`, absPath));
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
            return [];
        }

        const schemaKey = Object.keys(parsed).find(k => k === 'xs:schema' || k === 'xsd:schema' || k.endsWith(':schema'));
        if (!schemaKey) {
            ctx.warnings.push(warn('XSD_PARSE_ERROR', `No xs:schema root element in ${path.basename(absPath)}`, absPath));
            return [];
        }

        const schema = parsed[schemaKey] as Record<string, unknown>;
        const targetNs = schema['@_targetNamespace'] as string | undefined;
        if (targetNs) ctx.targetNsMap.set(absPath, targetNs);
        const baseDir = path.dirname(absPath);
        const fileNsMap = buildNsMap(schema);

        for (const redef of arr(schema['xs:redefine'] ?? schema['xsd:redefine'])) {
            ctx.warnings.push(warn('XSD_UNSUPPORTED_REDEFINE', `xs:redefine is not supported`, absPath));
            void redef;
        }

        // Process imports and includes first to populate global registries from other files
        for (const imp of arr(schema['xs:import'] ?? schema['xsd:import'])) {
            const loc = (imp as Record<string, unknown>)['@_schemaLocation'] as string | undefined;
            // P8: skip absolute URLs (http://, https://, urn:, etc.) — treat as namespace hints only
            if (loc && !/^[a-zA-Z][a-zA-Z\d+\-.]*:\/\//i.test(loc)) {
                await parseSchemaFile(path.resolve(baseDir, loc), ctx);
            }
        }
        for (const inc of arr(schema['xs:include'] ?? schema['xsd:include'])) {
            const loc = (inc as Record<string, unknown>)['@_schemaLocation'] as string | undefined;
            if (loc && !/^[a-zA-Z][a-zA-Z\d+\-.]*:\/\//i.test(loc)) {
                await parseSchemaFile(path.resolve(baseDir, loc), ctx);
            }
        }

        // P2: Two-pass type/group registration to handle forward references within same file.
        // Pass 1: pre-register all named top-level definitions with empty children.
        // Both the qualified key ("{ns}:name") and the unqualified key ("name") point to
        // the same stub object so that Pass 2's child mutations are visible under both keys.
        for (const ct of arr(schema['xs:complexType'] ?? schema['xsd:complexType'])) {
            const name = (ct as Record<string, unknown>)['@_name'] as string | undefined;
            if (!name) continue;
            if (!ctx.globalTypes.has(name)) {
                const stub: XsdNode = { name, type: 'complexType', path: name, sourceFile: absPath, children: [] };
                ctx.globalTypes.set(name, stub);
                if (targetNs) ctx.globalTypes.set(`${targetNs}:${name}`, stub); // P3
            }
        }
        for (const st of arr(schema['xs:simpleType'] ?? schema['xsd:simpleType'])) {
            const name = (st as Record<string, unknown>)['@_name'] as string | undefined;
            if (!name) continue;
            if (!ctx.globalTypes.has(name)) {
                const stub: XsdNode = { name, type: 'simpleType', path: name, sourceFile: absPath, children: [] };
                ctx.globalTypes.set(name, stub);
                if (targetNs) ctx.globalTypes.set(`${targetNs}:${name}`, stub); // P3
            }
        }
        for (const grp of arr(schema['xs:group'] ?? schema['xsd:group'])) {
            const name = (grp as Record<string, unknown>)['@_name'] as string | undefined;
            if (!name) continue;
            if (!ctx.globalGroups.has(name)) {
                const stub: XsdNode = { name, type: 'group', path: name, sourceFile: absPath, children: [] };
                ctx.globalGroups.set(name, stub);
                if (targetNs) ctx.globalGroups.set(`${targetNs}:${name}`, stub); // P3
            }
        }
        // P4: pre-register attributeGroup definitions
        for (const ag of arr(schema['xs:attributeGroup'] ?? schema['xsd:attributeGroup'])) {
            const name = (ag as Record<string, unknown>)['@_name'] as string | undefined;
            if (!name) continue;
            if (!ctx.globalGroups.has(name)) {
                const stub: XsdNode = { name, type: 'attributeGroup', path: name, sourceFile: absPath, children: [] };
                ctx.globalGroups.set(name, stub);
                if (targetNs) ctx.globalGroups.set(`${targetNs}:${name}`, stub);
            }
        }

        const topNodes: XsdNode[] = [];

        // Pass 2: build children now that all types/groups from this file are registered
        for (const ct of arr(schema['xs:complexType'] ?? schema['xsd:complexType'])) {
            const name = (ct as Record<string, unknown>)['@_name'] as string | undefined;
            if (!name) continue;
            const node = ctx.globalTypes.get(name)!;
            node.children = buildComplexTypeChildren(ct as Record<string, unknown>, name, absPath, ctx, fileNsMap);
            topNodes.push(node);
        }

        for (const st of arr(schema['xs:simpleType'] ?? schema['xsd:simpleType'])) {
            const name = (st as Record<string, unknown>)['@_name'] as string | undefined;
            if (!name) continue;
            topNodes.push(ctx.globalTypes.get(name)!);
        }

        for (const grp of arr(schema['xs:group'] ?? schema['xsd:group'])) {
            const name = (grp as Record<string, unknown>)['@_name'] as string | undefined;
            if (!name) continue;
            const node = ctx.globalGroups.get(name)!;
            node.children = buildGroupChildren(grp as Record<string, unknown>, name, absPath, ctx, fileNsMap);
            topNodes.push(node);
        }

        // P4: build attributeGroup children in Pass 2
        for (const ag of arr(schema['xs:attributeGroup'] ?? schema['xsd:attributeGroup'])) {
            const name = (ag as Record<string, unknown>)['@_name'] as string | undefined;
            if (!name) continue;
            const node = ctx.globalGroups.get(name)!;
            node.children = buildComplexTypeChildren(ag as Record<string, unknown>, name, absPath, ctx, fileNsMap);
            topNodes.push(node);
        }

        for (const el of arr(schema['xs:element'] ?? schema['xsd:element'])) {
            const node = buildElementNode(el as Record<string, unknown>, '', absPath, ctx, fileNsMap);
            if (node) {
                topNodes.push(node);
                ctx.globalElements.set(node.name, node); // unqualified fallback
                if (targetNs) ctx.globalElements.set(`${targetNs}:${node.name}`, node); // P3 qualified key
            }
        }

        return topNodes;
    } finally {
        ctx.depth--; // P1: always decrement even on unexpected error
    }
}

/**
 * Pure, testable XSD tree builder. Accepts an absolute path and injectable readFile.
 * Parses the XSD, follows xs:import / xs:include chains (depth limit 20), resolves
 * xs:group, xs:element ref, and xs:extension base attributes. Returns typed XsdNode tree + warnings.
 *
 * @param paramName - P14: Kamelet YAML parameter name; included in XSD_FILE_NOT_FOUND warnings.
 */
export async function buildXsdTree(
    absPath: string,
    readFile: ReadFileFn,
    paramName?: string,
): Promise<{ root: XsdNode; warnings: Warning[]; rawSource?: string }> {
    const ctx: ParseCtx = {
        readFile,
        visited: new Set(),
        depth: 0,
        warnings: [],
        globalElements: new Map(),
        globalTypes: new Map(),
        globalGroups: new Map(),
        targetNsMap: new Map(),
        paramName,
        primaryAbsPath: absPath,
    };

    const topNodes = await parseSchemaFile(absPath, ctx);

    // P17: wrapper schemas that consist solely of xs:import / xs:include declarations have no
    // own top-level elements — surface the globally-registered elements from the import chain
    // instead.  new Set() deduplicates because each element is stored under both its unqualified
    // name and its "{ns}:name" qualified key but both point to the same object reference.
    const effectiveNodes = topNodes.length > 0
        ? topNodes
        : [...new Set(ctx.globalElements.values())];

    const filename = path.basename(absPath, path.extname(absPath));
    // P6: use filename as wrapper path instead of '' so callers have a meaningful root path
    const root: XsdNode = effectiveNodes.length === 1
        ? effectiveNodes[0]
        : {
            name: filename,
            type: 'complexType',
            path: filename,
            sourceFile: absPath,
            children: effectiveNodes,
        };

    return { root, warnings: ctx.warnings, rawSource: ctx.primaryRawSource };
}

/**
 * Production entry point. Resolves a stored path (file:{{project.root.*}}/…) to an
 * absolute path via propertiesResolver, then delegates to buildXsdTree using
 * vscode.workspace.fs for file I/O.
 */
export async function resolveXsdTree(
    storedPath: string,
    workspaceRoot: string,
    paramName?: string,
): Promise<{ root: XsdNode; warnings: Warning[]; rawSource?: string }> {
    // P9: wrap entire resolution in try/catch — prevents unhandled exceptions from escaping to caller
    try {
        const { resolveStoredPath } = await import('./propertiesResolver');
        const vscode = await import('vscode');
        const absPath = await resolveStoredPath(storedPath, workspaceRoot);
        const readFile: ReadFileFn = async (p: string) =>
            Buffer.from(await vscode.workspace.fs.readFile(vscode.Uri.file(p)));
        return await buildXsdTree(absPath, readFile, paramName);
    } catch (err: any) {
        const detail = paramName
            ? `${storedPath} (YAML parameter: ${paramName})`
            : storedPath;
        const w = warn('XSD_FILE_NOT_FOUND', `Failed to resolve stored path: ${err.message}`, detail);
        const stub: XsdNode = { name: 'error', type: 'element', path: 'error', sourceFile: storedPath, children: [] };
        return { root: stub, warnings: [w] };
    }
}
