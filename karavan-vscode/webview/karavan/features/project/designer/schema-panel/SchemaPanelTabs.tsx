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
import React, { useEffect } from 'react';
import {
    Alert,
    Content,
    Skeleton,
    Tab,
    Tabs,
    TabTitleText,
} from '@patternfly/react-core';
import { shallow } from 'zustand/shallow';
import { useDesignerStore } from '../DesignerStore';
import { EventBus, IntegrationUpdate } from '../utils/EventBus';
import { useSchemaPanelStore } from './SchemaPanelStore';
import { SchemaTreeView } from './SchemaTreeView';
import { useXsltMapperStore } from '../xslt-mapper/XsltMapperStore';
import { XsltMapperPanel } from '../xslt-mapper/XsltMapperPanel';
import type { SchemaTab } from '../../../../../../src/messages';
import './SchemaPanelTabs.css';

function getStoredPath(params: Record<string, string>, tab: SchemaTab): string {
    switch (tab) {
        case 'input':
            return params.inputSchema ?? '';
        case 'output':
            return params.outputSchema ?? params.variableSchema ?? '';
        case 'error':
            // comma-separated list or single path
            return params.errorSchemas ?? params.errorSchema ?? '';
    }
}

interface TabContentProps {
    tab: SchemaTab;
}

function SchemaTabContent({ tab }: TabContentProps) {
    const tabState = useSchemaPanelStore((s) => s.tabs[tab]);

    if (tabState.state === 'idle') {
        return (
            <div className="schema-panel-idle">
                <Content component="p">No schema assigned</Content>
                <Content component="small">
                    Set <code>parameters.{tab}Schema</code> in the Kamelet YAML or add an XSD file at{' '}
                    <code>xsd/&#123;variableReceive&#125;.xsd</code> adjacent to the route file.
                </Content>
            </div>
        );
    }

    if (tabState.state === 'loading') {
        return (
            <div className="schema-panel-loading">
                <Skeleton height="20px" width="60%" />
                <Skeleton height="20px" width="40%" style={{ marginTop: 8 }} />
                <Skeleton height="20px" width="50%" style={{ marginTop: 8 }} />
            </div>
        );
    }

    return (
        <div className="schema-panel-content">
            {tabState.warnings.length > 0 && (
                <Alert
                    variant="warning"
                    isInline
                    title="Schema resolution warnings"
                    className="schema-panel-warnings"
                >
                    <ul>
                        {tabState.warnings.map((w, i) => (
                            <li key={i}><strong>{w.code}</strong>{w.detail ? `: ${w.detail}` : ''} — {w.message}</li>
                        ))}
                    </ul>
                </Alert>
            )}
            {tabState.trees.length === 0 && tabState.state === 'ready' && (
                <div className="schema-panel-idle">
                    <Content component="p">No schema assigned</Content>
                </div>
            )}
            {tabState.trees.map((tree, i) => (
                <SchemaTreeView
                    key={tree.sourceFile + i}
                    root={tree}
                    label={tabState.trees.length > 1 ? tree.sourceFile.split('/').pop() : undefined}
                />
            ))}
        </div>
    );
}

export function SchemaPanelTabs() {
    const [selectedStep] = useDesignerStore((s) => [s.selectedStep], shallow);
    const mapperIsOpen = useXsltMapperStore((s) => s.isOpen);

    if (mapperIsOpen) return <XsltMapperPanel />;

    const [activeTab, setActiveTab, requestXsdTree, invalidateAll, reset] = useSchemaPanelStore(
        (s) => [s.activeTab, s.setActiveTab, s.requestXsdTree, s.invalidateAll, s.reset],
        shallow,
    );

    const params: Record<string, string> = (selectedStep as any)?.parameters ?? {};
    const variableReceive: string = (selectedStep as any)?.variableReceive ?? '';

    // When selectedStep changes, reset and request the active tab
    useEffect(() => {
        reset();
        if (selectedStep) {
            requestXsdTree(activeTab, getStoredPath(params, activeTab), variableReceive || undefined);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [(selectedStep as any)?.uuid]);

    // When active tab changes, request if not yet loaded
    const handleTabSelect = (_: React.MouseEvent, tab: string | number) => {
        const schemaTab = tab as SchemaTab;
        setActiveTab(schemaTab);
        const tabState = useSchemaPanelStore.getState().tabs[schemaTab];
        if (tabState.state === 'idle' && selectedStep) {
            requestXsdTree(schemaTab, getStoredPath(params, schemaTab), variableReceive || undefined);
        }
    };

    // Auto-refresh on YAML save
    useEffect(() => {
        const sub = EventBus.onIntegrationUpdate().subscribe((update: IntegrationUpdate) => {
            if (!update.propertyOnly) {
                invalidateAll();
            }
        });
        return () => sub.unsubscribe();
    }, [invalidateAll]);

    return (
        <div className="schema-panel-tabs">
            <Tabs
                activeKey={activeTab}
                onSelect={handleTabSelect}
                isFilled
                aria-label="Schema tabs"
            >
                <Tab eventKey="input" title={<TabTitleText>Input</TabTitleText>}>
                    <SchemaTabContent tab="input" />
                </Tab>
                <Tab eventKey="output" title={<TabTitleText>Output</TabTitleText>}>
                    <SchemaTabContent tab="output" />
                </Tab>
                <Tab eventKey="error" title={<TabTitleText>Error</TabTitleText>}>
                    <SchemaTabContent tab="error" />
                </Tab>
            </Tabs>
        </div>
    );
}
