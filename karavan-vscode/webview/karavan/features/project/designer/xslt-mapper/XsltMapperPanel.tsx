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
import React, { useRef } from 'react';
import {
    Alert,
    Badge,
    Button,
    Content,
    Skeleton,
    TreeView,
    TreeViewDataItem,
} from '@patternfly/react-core';
import { TimesIcon } from '@patternfly/react-icons';
import { useXsltMapperStore } from './XsltMapperStore';
import { XsltMapperCanvas } from './XsltMapperCanvas';
import { SchemaTreeView } from '../schema-panel/SchemaTreeView';
import { useSchemaPanelStore } from '../schema-panel/SchemaPanelStore';
import type { XsltConnection, XsdNode } from '../../../../../../src/messages';
import './XsltMapperPanel.css';

/** Build a virtual XsdNode tree from connection source paths for one variable. */
function buildVirtualTree(variable: string, connections: XsltConnection[]): XsdNode {
    const root: XsdNode = {
        name: variable,
        type: 'complexType',
        path: variable,
        sourceFile: '',
        children: [],
    };

    for (const conn of connections.filter((c) => c.sourceVariable === variable && c.sourceNodePath)) {
        const segments = conn.sourceNodePath.split('.');
        let parent = root;
        let cumulativePath = variable;

        for (const seg of segments) {
            cumulativePath = `${cumulativePath}.${seg}`;
            let child = parent.children.find((c) => c.name === seg);
            if (!child) {
                child = {
                    name: seg,
                    type: 'element',
                    path: cumulativePath,
                    sourceFile: '',
                    children: [],
                };
                parent.children.push(child);
            }
            parent = child;
        }
    }

    return root;
}

/** Collect distinct source variables from connections. */
function getSourceVariables(connections: XsltConnection[]): string[] {
    const seen = new Set<string>();
    const result: string[] = [];
    for (const c of connections) {
        if (c.sourceVariable && !seen.has(c.sourceVariable)) {
            seen.add(c.sourceVariable);
            result.push(c.sourceVariable);
        }
    }
    return result;
}

export function XsltMapperPanel() {
    const { filename, loadState, connections, warnings, closeMapper } = useXsltMapperStore();
    const inputTrees = useSchemaPanelStore((s) => s.tabs.input.trees);
    const containerRef = useRef<HTMLDivElement>(null);

    const sourceVariables = getSourceVariables(connections);
    const sourceTrees = sourceVariables.map((v) => buildVirtualTree(v, connections));

    const warningCount = warnings.length + connections.filter((c) => c.warning).length;

    return (
        <div className="mapper-panel">
            <div className="mapper-panel-header">
                <Content component="h4" className="mapper-panel-title">
                    Mapper — {filename}
                </Content>
                {warningCount > 0 && (
                    <Badge className="mapper-warnings-badge">{warningCount} warning{warningCount !== 1 ? 's' : ''}</Badge>
                )}
                <Button variant="plain" aria-label="Close mapper" onClick={closeMapper}>
                    <TimesIcon />
                </Button>
            </div>

            {warnings.length > 0 && (
                <Alert variant="warning" isInline title="Parse warnings" className="mapper-parse-warnings">
                    <ul>
                        {warnings.map((w, i) => (
                            <li key={i}><strong>{w.code}</strong> — {w.message}</li>
                        ))}
                    </ul>
                </Alert>
            )}

            {loadState === 'loading' && (
                <div className="mapper-loading">
                    <Skeleton height="20px" width="60%" />
                    <Skeleton height="20px" width="40%" style={{ marginTop: 8 }} />
                </div>
            )}

            {loadState === 'ready' && (
                <div className="mapper-body" ref={containerRef}>
                    {/* Source panel — virtual trees inferred from XSLT */}
                    <div className="mapper-source-panel">
                        <Content component="small" className="mapper-panel-label">Source</Content>
                        {sourceTrees.length === 0 && (
                            <Content component="p" className="mapper-empty">No source variables found in XSLT</Content>
                        )}
                        {sourceTrees.map((tree) => (
                            <SchemaTreeView
                                key={tree.name}
                                root={tree}
                                label={tree.name}
                                pathPrefix={tree.name}
                            />
                        ))}
                    </div>

                    {/* Center gutter — SVG canvas renders here */}
                    <div className="mapper-center-gutter" />

                    {/* Target panel — input schema from schema panel */}
                    <div className="mapper-target-panel">
                        <Content component="small" className="mapper-panel-label">Target (input schema)</Content>
                        {inputTrees.length === 0 && (
                            <Content component="p" className="mapper-empty">No input schema loaded — select a step with an Input Schema</Content>
                        )}
                        {inputTrees.map((tree, i) => (
                            <SchemaTreeView
                                key={tree.sourceFile + i}
                                root={tree}
                            />
                        ))}
                        {/* Inline XPath annotations for mapped target fields */}
                        {connections.filter((c) => c.targetNodePath && c.xpathExpression).length > 0 && (
                            <div className="mapper-xpath-list">
                                {connections.map((c) => c.targetNodePath && (
                                    <div key={c.id} className="mapper-xpath-item" data-connection-id={c.id}>
                                        <span className="mapper-xpath-target">{c.targetNodePath}</span>
                                        <span className="mapper-xpath-arrow">←</span>
                                        <code className="mapper-xpath-expr">{c.xpathExpression}</code>
                                        {c.warning && <span className="mapper-xpath-warning" title={c.warning}>⚠</span>}
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>

                    {/* SVG connection lines overlay */}
                    <XsltMapperCanvas connections={connections} containerRef={containerRef} />
                </div>
            )}
        </div>
    );
}
