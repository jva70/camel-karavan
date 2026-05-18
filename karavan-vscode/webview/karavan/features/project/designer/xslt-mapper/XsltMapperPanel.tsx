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
import React, { useEffect, useRef } from 'react';
import {
    Alert,
    Badge,
    Button,
    Content,
    Skeleton,
    ToggleGroup,
    ToggleGroupItem,
} from '@patternfly/react-core';
import { RedoIcon } from '@patternfly/react-icons';
import Editor from '@monaco-editor/react';
import { shallow } from 'zustand/shallow';
import { Integration } from '@karavan-core/model/IntegrationDefinition';
import { useDesignerStore, useIntegrationStore } from '../DesignerStore';
import { useXsltMapperStore, SourceTreeEntry } from './XsltMapperStore';
import { XsltMapperCanvas } from './XsltMapperCanvas';
import { SchemaTreeView } from '../schema-panel/SchemaTreeView';
import { useSchemaPanelStore } from '../schema-panel/SchemaPanelStore';
import { useTheme } from '@app/theme/ThemeContext';
import type { XsltConnection, XsdNode } from '../../../../../../src/messages';
import './XsltMapperPanel.css';

/**
 * Recursively walk all steps in a route and collect every step that has variableReceive,
 * excluding the selected step itself.  BW5-style routes use global variable scope, so
 * all variables declared anywhere in the route can be used as XSLT sources.
 */
function getUpstreamStepSchemas(
    integration: Integration,
    selectedStepUuid: string
): Array<{ variableReceive: string; storedPath: string }> {
    const result: Array<{ variableReceive: string; storedPath: string }> = [];
    const seen = new Set<string>();

    function walk(step: any): void {
        if (!step || typeof step !== 'object') return;
        if (step.uuid === selectedStepUuid) return;

        const vr: string = step.variableReceive ?? '';
        if (vr && !seen.has(vr)) {
            seen.add(vr);
            const params = step.parameters ?? {};
            const storedPath: string =
                params.outputSchema ?? params.variableSchema ?? params.inputSchema ?? '';
            result.push({ variableReceive: `$${vr}`, storedPath });
        }

        for (const val of Object.values(step)) {
            if (Array.isArray(val)) {
                for (const item of val) {
                    if (item && typeof item === 'object') walk(item);
                }
            } else if (val && typeof val === 'object') {
                walk(val as any);
            }
        }
    }

    for (const flow of (integration as any).spec?.flows ?? []) {
        const from = flow?.from;
        if (!from) continue;
        walk(from);
    }
    return result;
}

/** Build a virtual XsdNode tree for a variable from connection source paths (fallback when no XSD). */
function buildVirtualTree(variableReceive: string, connections: XsltConnection[]): XsdNode {
    const varName = variableReceive.startsWith('$') ? variableReceive.slice(1) : variableReceive;
    const root: XsdNode = { name: varName, type: 'complexType', path: variableReceive, sourceFile: '', children: [] };

    for (const conn of connections.filter((c) => c.sourceVariable === variableReceive && c.sourceNodePath)) {
        const segments = conn.sourceNodePath.split('.');
        let parent = root;
        let cumulativePath = variableReceive;
        for (const seg of segments) {
            cumulativePath = `${cumulativePath}.${seg}`;
            let child = parent.children.find((c) => c.name === seg);
            if (!child) {
                child = { name: seg, type: 'element', path: cumulativePath, sourceFile: '', children: [] };
                parent.children.push(child);
            }
            parent = child;
        }
    }
    return root;
}

export function XsltMapperPanel() {
    const [selectedStep] = useDesignerStore((s) => [s.selectedStep], shallow);
    const integration = useIntegrationStore((s) => s.integration);
    const { loadState, viewMode, filename, xsltContent, connections, warnings, sourceTrees, openMapper, resetMapper, setViewMode } = useXsltMapperStore();
    const inputTrees = useSchemaPanelStore((s) => s.tabs.input.trees);
    const { isDark } = useTheme();
    const containerRef = useRef<HTMLDivElement>(null);

    const params: Record<string, string> = (selectedStep as any)?.parameters ?? {};
    const inputBinding: string = params.inputBinding ?? '';
    const stepUuid: string = (selectedStep as any)?.uuid ?? '';

    // Auto-load when selected step or inputBinding changes
    useEffect(() => {
        if (inputBinding && stepUuid) {
            const sourceSchemas = getUpstreamStepSchemas(integration, stepUuid);
            openMapper(inputBinding, sourceSchemas);
        } else {
            resetMapper();
        }
    }, [stepUuid, inputBinding]);

    const warningCount = warnings.length + connections.filter((c) => c.warning).length;

    // ── No step selected ─────────────────────────────────────────────────────
    if (!selectedStep) {
        return (
            <div className="mapper-panel">
                <div className="mapper-idle">
                    <Content component="p">No step selected</Content>
                    <Content component="small">Select a Kamelet step in the route designer to view its XSLT mapping.</Content>
                </div>
            </div>
        );
    }

    // ── No inputBinding ──────────────────────────────────────────────────────
    if (!inputBinding) {
        return (
            <div className="mapper-panel">
                <div className="mapper-idle">
                    <Content component="p">No <code>inputBinding</code> configured</Content>
                    <Content component="small">
                        Add <code>parameters.inputBinding</code> pointing to an XSLT file to enable the visual mapper.
                    </Content>
                    <Content component="small" style={{ color: 'var(--pf-t--global--text--color--subtle)' }}>
                        Step: <code>{(selectedStep as any)?.dslName ?? stepUuid}</code>
                    </Content>
                </div>
            </div>
        );
    }

    // ── Loading ──────────────────────────────────────────────────────────────
    if (loadState === 'loading') {
        return (
            <div className="mapper-panel">
                <div className="mapper-panel-header">
                    <Content component="h4" className="mapper-panel-title">Mapper — {filename}</Content>
                </div>
                <div className="mapper-loading">
                    <Skeleton height="20px" width="60%" />
                    <Skeleton height="20px" width="40%" style={{ marginTop: 8 }} />
                    <Skeleton height="20px" width="50%" style={{ marginTop: 8 }} />
                </div>
            </div>
        );
    }

    // ── Error ────────────────────────────────────────────────────────────────
    if (loadState === 'error') {
        const sourceSchemas = getUpstreamStepSchemas(integration, stepUuid);
        return (
            <div className="mapper-panel">
                <div className="mapper-panel-header">
                    <Content component="h4" className="mapper-panel-title">Mapper — {filename}</Content>
                    <Button variant="plain" aria-label="Retry" title="Retry" onClick={() => openMapper(inputBinding, sourceSchemas)}>
                        <RedoIcon />
                    </Button>
                </div>
                <Alert variant="danger" isInline title="Failed to load XSLT" className="mapper-parse-warnings">
                    <p>Could not read or parse: <code>{inputBinding}</code></p>
                    {warnings.map((w, i) => (
                        <p key={i}><strong>{w.code}</strong> — {w.message}{w.detail ? `: ${w.detail}` : ''}</p>
                    ))}
                </Alert>
            </div>
        );
    }

    // ── Idle (reset state) ───────────────────────────────────────────────────
    if (loadState === 'idle') {
        const sourceSchemas = getUpstreamStepSchemas(integration, stepUuid);
        return (
            <div className="mapper-panel">
                <div className="mapper-idle">
                    <Content component="p">XSLT mapper</Content>
                    <Content component="small"><code>{inputBinding}</code></Content>
                    <Button variant="link" onClick={() => openMapper(inputBinding, sourceSchemas)} style={{ padding: 0, marginTop: 8 }}>
                        Load mapping
                    </Button>
                </div>
            </div>
        );
    }

    // ── Ready ────────────────────────────────────────────────────────────────
    const sourceSchemas = getUpstreamStepSchemas(integration, stepUuid);

    return (
        <div className="mapper-panel">
            <div className="mapper-panel-header">
                <Content component="h4" className="mapper-panel-title">
                    Mapper — {filename}
                </Content>
                {warningCount > 0 && (
                    <Badge className="mapper-warnings-badge">{warningCount}</Badge>
                )}
                <ToggleGroup aria-label="Mapper view mode" className="mapper-view-toggle">
                    <ToggleGroupItem text="Visual" isSelected={viewMode === 'visual'} onChange={() => setViewMode('visual')} />
                    <ToggleGroupItem text="XSLT" isSelected={viewMode === 'text'} onChange={() => setViewMode('text')} />
                </ToggleGroup>
                <Button variant="plain" aria-label="Reload" title="Reload XSLT" onClick={() => openMapper(inputBinding, sourceSchemas)}>
                    <RedoIcon />
                </Button>
            </div>

            {warnings.length > 0 && viewMode === 'visual' && (
                <Alert variant="warning" isInline title="Parse warnings" className="mapper-parse-warnings">
                    <ul>
                        {warnings.map((w, i) => (
                            <li key={i}><strong>{w.code}</strong> — {w.message}</li>
                        ))}
                    </ul>
                </Alert>
            )}

            {/* ── Text / Monaco view ── */}
            {viewMode === 'text' && (
                <div className="mapper-text-view">
                    <Editor
                        height="100%"
                        language="xml"
                        value={xsltContent}
                        theme={isDark ? 'vs-dark' : 'vs'}
                        options={{ readOnly: true, minimap: { enabled: false }, wordWrap: 'on', scrollBeyondLastLine: false }}
                    />
                </div>
            )}

            {/* ── Visual / canvas view ── */}
            {viewMode === 'visual' && (
                <div className="mapper-body" ref={containerRef}>
                    {/* Source panel */}
                    <div className="mapper-source-panel">
                        <Content component="small" className="mapper-panel-label">Source variables</Content>
                        <SourcePanel sourceTrees={sourceTrees} connections={connections} />
                    </div>

                    <div className="mapper-center-gutter" />

                    {/* Target panel */}
                    <div className="mapper-target-panel">
                        <Content component="small" className="mapper-panel-label">Target (input schema)</Content>
                        {inputTrees.length === 0 && (
                            <Content component="p" className="mapper-empty">
                                No input schema loaded — switch to the Schema tab first to trigger schema resolution
                            </Content>
                        )}
                        {inputTrees.map((tree, i) => (
                            <SchemaTreeView key={tree.sourceFile + i} root={tree} />
                        ))}
                        {connections.some((c) => c.targetNodePath && c.xpathExpression) && (
                            <div className="mapper-xpath-list">
                                {connections.map((c) => c.targetNodePath && (
                                    <div key={c.id} className="mapper-xpath-item">
                                        <span className="mapper-xpath-target">{c.targetNodePath}</span>
                                        <span className="mapper-xpath-arrow">←</span>
                                        <code className="mapper-xpath-expr">{c.xpathExpression}</code>
                                        {c.warning && <span className="mapper-xpath-warning" title={c.warning}>⚠</span>}
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>

                    <XsltMapperCanvas connections={connections} containerRef={containerRef} />
                </div>
            )}
        </div>
    );
}

/** Renders source trees: uses resolved XSD tree when available, virtual tree inferred from connections otherwise. */
function SourcePanel({ sourceTrees, connections }: { sourceTrees: SourceTreeEntry[]; connections: XsltConnection[] }) {
    if (sourceTrees.length === 0) {
        return (
            <Content component="p" className="mapper-empty">
                No upstream steps found — is this the first step in the route?
            </Content>
        );
    }

    return (
        <>
            {sourceTrees.map((entry) => {
                const label = entry.variableReceive;
                if (entry.tree) {
                    // Real XSD tree from host
                    return (
                        <div key={label}>
                            {entry.warnings.length > 0 && (
                                <Alert variant="warning" isInline title={`Schema warnings for ${label}`} className="mapper-src-warning">
                                    {entry.warnings.map((w, i) => <p key={i}>{w.code}: {w.message}</p>)}
                                </Alert>
                            )}
                            <SchemaTreeView root={entry.tree} label={label} pathPrefix={label} />
                        </div>
                    );
                }
                // Fallback: virtual tree inferred from XSLT
                const virtual = buildVirtualTree(label, connections);
                return (
                    <div key={label}>
                        {entry.warnings.length > 0 && (
                            <Alert variant="warning" isInline title={`Schema for ${label}`} className="mapper-src-warning">
                                {entry.warnings.map((w, i) => <p key={i}>{w.code}: {w.message}</p>)}
                            </Alert>
                        )}
                        <SchemaTreeView root={virtual} label={`${label} (from XSLT)`} pathPrefix={label} />
                    </div>
                );
            })}
        </>
    );
}
