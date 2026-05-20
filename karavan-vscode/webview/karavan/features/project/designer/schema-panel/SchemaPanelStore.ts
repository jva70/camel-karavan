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
import { createWithEqualityFn } from 'zustand/traditional';
import vscode from '@/vscode';
import type {
    SchemaTab, XsdNode, Warning, PanelState, HostToWebviewMessage, WebviewToHostMessage,
} from '../../../../../../src/messages';

interface TabState {
    state: PanelState;
    trees: XsdNode[];
    /** Raw XSD source per tree entry — parallel to `trees`, undefined when not yet delivered. */
    rawSources: (string | undefined)[];
    warnings: Warning[];
    requestIds: Set<string>;
    lastStoredPath: string;
    lastVariableReceive: string | undefined;
}

function emptyTab(): TabState {
    return { state: 'idle', trees: [], rawSources: [], warnings: [], requestIds: new Set(), lastStoredPath: '', lastVariableReceive: undefined };
}

interface SchemaPanelState {
    activeTab: SchemaTab;
    tabs: Record<SchemaTab, TabState>;
    schemaViewMode: 'tree' | 'source';
    setActiveTab: (tab: SchemaTab) => void;
    setSchemaViewMode: (mode: 'tree' | 'source') => void;
    requestXsdTree: (tab: SchemaTab, storedPath: string, variableReceive?: string) => void;
    invalidateAll: () => void;
    handleHostMessage: (message: HostToWebviewMessage) => void;
    reset: () => void;
}

export const useSchemaPanelStore = createWithEqualityFn<SchemaPanelState>((set, get) => ({
    activeTab: 'input',
    tabs: { input: emptyTab(), output: emptyTab(), error: emptyTab() },
    schemaViewMode: 'tree',

    setActiveTab: (activeTab) => set({ activeTab }),

    setSchemaViewMode: (schemaViewMode) => set({ schemaViewMode }),

    requestXsdTree: (tab, storedPath, variableReceive) => {
        if (!storedPath && !variableReceive) {
            // Nothing to resolve — stay idle
            set((s) => ({ tabs: { ...s.tabs, [tab]: { ...s.tabs[tab], state: 'idle', trees: [], warnings: [] } } }));
            return;
        }
        // P1: split comma-separated paths here so each gets its own requestId.
        // Host handler processes one path per call; store tracks all N ids and
        // only transitions to 'ready' when the last reply arrives.
        const paths = storedPath ? storedPath.split(',').map((s) => s.trim()).filter(Boolean) : [''];
        const newIds = new Set<string>();
        const messages: WebviewToHostMessage[] = [];
        for (const sp of paths) {
            const requestId = crypto.randomUUID();
            newIds.add(requestId);
            messages.push({ type: 'requestXsdTree', requestId, version: 1, payload: { storedPath: sp, tab, variableReceive } });
        }
        set((s) => ({
            tabs: {
                ...s.tabs,
                [tab]: { ...s.tabs[tab], state: 'loading', trees: [], warnings: [], requestIds: newIds, lastStoredPath: storedPath, lastVariableReceive: variableReceive },
            },
        }));
        for (const msg of messages) vscode.postMessage(msg);
    },

    invalidateAll: () => {
        const { tabs, requestXsdTree } = get();
        (Object.keys(tabs) as SchemaTab[]).forEach((tab) => {
            const t = tabs[tab];
            if (t.lastStoredPath || t.lastVariableReceive) {
                requestXsdTree(tab, t.lastStoredPath, t.lastVariableReceive);
            }
        });
    },

    handleHostMessage: (message) => {
        // P5: drain requestId on error so the tab doesn't freeze in loading
        if (message.type === 'error') {
            set((s) => {
                const tabs = { ...s.tabs };
                for (const tab of Object.keys(tabs) as SchemaTab[]) {
                    const prev = tabs[tab];
                    if (!prev.requestIds.has(message.requestId)) continue;
                    const newIds = new Set(prev.requestIds);
                    newIds.delete(message.requestId);
                    tabs[tab] = { ...prev, state: newIds.size === 0 ? 'ready' : 'loading', requestIds: newIds };
                }
                return { tabs };
            });
            return;
        }
        if (message.type !== 'xsdTree') return;
        const { tab, tree, warnings, rawSource } = message.payload;
        set((s) => {
            const prev = s.tabs[tab];
            if (!prev.requestIds.has(message.requestId)) return s;
            const newIds = new Set(prev.requestIds);
            newIds.delete(message.requestId);
            const newTrees = [...prev.trees, tree];
            const newRawSources = [...prev.rawSources, rawSource];
            const newState: PanelState = newIds.size === 0 ? 'ready' : 'loading';
            return {
                tabs: {
                    ...s.tabs,
                    [tab]: { ...prev, state: newState, trees: newTrees, rawSources: newRawSources, warnings: [...prev.warnings, ...warnings], requestIds: newIds },
                },
            };
        });
    },

    reset: () => set({ tabs: { input: emptyTab(), output: emptyTab(), error: emptyTab() }, schemaViewMode: 'tree' }),
}));
