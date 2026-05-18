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
import { XMLParser, XMLValidator } from 'fast-xml-parser';
import type { XsltConnection, Warning } from './messages';

function arr<T>(v: T | T[] | undefined | null): T[] {
    if (v == null) return [];
    return Array.isArray(v) ? v : [v];
}

function warn(code: string, message: string, detail?: string): Warning {
    return { code, message, detail, severity: 'warning' };
}

/** Strip a namespace prefix (ns:local → local). */
function stripNs(name: string): string {
    const i = name.indexOf(':');
    return i >= 0 ? name.slice(i + 1) : name;
}

/** Convert an XPath like "$var/ns:a/ns:b/ns:c" into { variable, nodePath }.
 *  Returns null for complex expressions that cannot be mapped. */
function parseXPathSelect(select: string): { variable: string; nodePath: string } | null {
    const m = select.match(/^(\$[\w-]+)(\/(.+))?$/);
    if (!m) return null;
    const variable = m[1];
    const rawPath = m[3] ?? '';
    // Complex if it contains functions, operators, predicates
    if (/[()[\]+\-*=!<>@|]/.test(rawPath)) return null;
    const nodePath = rawPath
        .split('/')
        .filter(Boolean)
        .map(stripNs)
        .join('.');
    return { variable, nodePath };
}

const XSLT_NAMESPACES = new Set(['xsl', 'xslt']);

function isXslKey(key: string): boolean {
    const prefix = key.split(':')[0];
    return XSLT_NAMESPACES.has(prefix);
}

/** Walk XSLT node tree. pathContext tracks the target element path being constructed. */
function walkNode(
    node: Record<string, unknown>,
    pathContext: string[],
    connections: XsltConnection[],
    warnings: Warning[]
): void {
    // xsl:value-of
    for (const vo of arr(node['xsl:value-of'])) {
        const select = (vo as Record<string, unknown>)['@_select'] as string | undefined;
        if (select) {
            const parsed = parseXPathSelect(select);
            const targetNodePath = pathContext.join('.');
            if (parsed) {
                connections.push({
                    id: crypto.randomUUID(),
                    sourceVariable: parsed.variable,
                    sourceNodePath: parsed.nodePath,
                    targetNodePath,
                    xpathExpression: select,
                });
            } else {
                connections.push({
                    id: crypto.randomUUID(),
                    sourceVariable: '',
                    sourceNodePath: '',
                    targetNodePath,
                    xpathExpression: select,
                    warning: 'Complex XPath expression — source path cannot be determined visually',
                });
            }
        }
    }

    // xsl:copy-of — similar to value-of
    for (const co of arr(node['xsl:copy-of'])) {
        const select = (co as Record<string, unknown>)['@_select'] as string | undefined;
        if (select) {
            const parsed = parseXPathSelect(select);
            const targetNodePath = pathContext.join('.');
            if (parsed) {
                connections.push({
                    id: crypto.randomUUID(),
                    sourceVariable: parsed.variable,
                    sourceNodePath: parsed.nodePath,
                    targetNodePath,
                    xpathExpression: select,
                });
            } else {
                connections.push({
                    id: crypto.randomUUID(),
                    sourceVariable: '',
                    sourceNodePath: '',
                    targetNodePath,
                    xpathExpression: select,
                    warning: 'Complex XPath expression — source path cannot be determined visually',
                });
            }
        }
    }

    // xsl:for-each — warn, then recurse with path context intact
    for (const fe of arr(node['xsl:for-each'])) {
        const select = (fe as Record<string, unknown>)['@_select'] as string | undefined;
        warnings.push(warn(
            'XSLT_UNREPRESENTABLE_CONSTRUCT',
            `xsl:for-each (select="${select ?? ''}") — inner connections extracted with approximate paths`,
        ));
        walkNode(fe as Record<string, unknown>, pathContext, connections, warnings);
    }

    // xsl:if — warn and recurse
    for (const ifNode of arr(node['xsl:if'])) {
        const test = (ifNode as Record<string, unknown>)['@_test'] as string | undefined;
        warnings.push(warn(
            'XSLT_UNREPRESENTABLE_CONSTRUCT',
            `xsl:if (test="${test ?? ''}") — inner connections extracted unconditionally`,
        ));
        walkNode(ifNode as Record<string, unknown>, pathContext, connections, warnings);
    }

    // xsl:choose/when/otherwise — warn and recurse
    for (const ch of arr(node['xsl:choose'])) {
        warnings.push(warn('XSLT_UNREPRESENTABLE_CONSTRUCT', 'xsl:choose — inner connections extracted from all branches'));
        for (const wh of arr((ch as Record<string, unknown>)['xsl:when'])) {
            walkNode(wh as Record<string, unknown>, pathContext, connections, warnings);
        }
        for (const ot of arr((ch as Record<string, unknown>)['xsl:otherwise'])) {
            walkNode(ot as Record<string, unknown>, pathContext, connections, warnings);
        }
    }

    // xsl:sequence (XSLT 2.0)
    for (const seq of arr(node['xsl:sequence'])) {
        const select = (seq as Record<string, unknown>)['@_select'] as string | undefined;
        if (select) {
            const parsed = parseXPathSelect(select);
            if (parsed) {
                connections.push({
                    id: crypto.randomUUID(),
                    sourceVariable: parsed.variable,
                    sourceNodePath: parsed.nodePath,
                    targetNodePath: pathContext.join('.'),
                    xpathExpression: select,
                });
            }
        }
    }

    // Non-XSL element children — these are the target element constructors
    for (const [key, value] of Object.entries(node)) {
        if (key.startsWith('@_') || isXslKey(key)) continue;
        const localName = stripNs(key);
        const newPath = [...pathContext, localName];
        for (const child of arr(value)) {
            if (child && typeof child === 'object') {
                walkNode(child as Record<string, unknown>, newPath, connections, warnings);
            }
        }
    }
}

/**
 * Pure parser: XSLT content → XsltConnection[] + Warning[].
 * Supports direct xsl:value-of / xsl:copy-of / xsl:sequence patterns.
 * Flags xsl:for-each, xsl:if, xsl:choose as unrepresentable but still extracts inner connections.
 * Never throws.
 */
export function parseXsltConnections(
    xsltContent: string
): { connections: XsltConnection[]; warnings: Warning[] } {
    const connections: XsltConnection[] = [];
    const warnings: Warning[] = [];

    const validationResult = XMLValidator.validate(xsltContent);
    if (validationResult !== true) {
        const msg = typeof validationResult === 'object' && validationResult.err
            ? `line ${validationResult.err.line}: ${validationResult.err.msg}`
            : 'invalid XML';
        warnings.push(warn('XSLT_PARSE_ERROR', `XML parse error: ${msg}`));
        return { connections, warnings };
    }

    const parser = new XMLParser({
        ignoreAttributes: false,
        attributeNamePrefix: '@_',
        isArray: () => true,
    });

    let parsed: Record<string, unknown>;
    try {
        parsed = parser.parse(xsltContent) as Record<string, unknown>;
    } catch (err: any) {
        warnings.push(warn('XSLT_PARSE_ERROR', `XML parse error: ${err.message}`));
        return { connections, warnings };
    }

    const stylesheetKey = Object.keys(parsed).find(
        (k) => k === 'xsl:stylesheet' || k === 'xsl:transform' || k.endsWith(':stylesheet') || k.endsWith(':transform')
    );
    if (!stylesheetKey) {
        warnings.push(warn('XSLT_PARSE_ERROR', 'No xsl:stylesheet root element found'));
        return { connections, warnings };
    }

    const stylesheets = arr(parsed[stylesheetKey]);
    for (const stylesheet of stylesheets) {
        const ss = stylesheet as Record<string, unknown>;
        // Templates
        const templateKey = Object.keys(ss).find((k) => k === 'xsl:template' || k.endsWith(':template'));
        for (const template of arr(templateKey ? ss[templateKey] : undefined)) {
            walkNode(template as Record<string, unknown>, [], connections, warnings);
        }
        // Top-level variable / param (no template wrapper)
        for (const fn of arr(ss['xsl:function'])) {
            walkNode(fn as Record<string, unknown>, [], connections, warnings);
        }
    }

    return { connections, warnings };
}
