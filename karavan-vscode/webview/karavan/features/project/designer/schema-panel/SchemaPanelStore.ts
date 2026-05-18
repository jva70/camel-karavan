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
    warnings: Warning[];
    requestIds: Set<string>;
    lastStoredPath: string;
    lastVariableReceive: string | undefined;
}

function emptyTab(): TabState {
    return { state: 'idle', trees: [], warnings: [], requestIds: new Set(), lastStoredPath: '', lastVariableReceive: undefined };
}

interface SchemaPanelState {
    activeTab: SchemaTab;
    tabs: Record<SchemaTab, TabState>;
    setActiveTab: (tab: SchemaTab) => void;
    requestXsdTree: (tab: SchemaTab, storedPath: string, variableReceive?: string) => void;
    invalidateAll: () => void;
    handleHostMessage: (message: HostToWebviewMessage) => void;
    reset: () => void;
}

export const useSchemaPanelStore = createWithEqualityFn<SchemaPanelState>((set, get) => ({
    activeTab: 'input',
    tabs: { input: emptyTab(), output: emptyTab(), error: emptyTab() },

    setActiveTab: (activeTab) => set({ activeTab }),

    requestXsdTree: (tab, storedPath, variableReceive) => {
        if (!storedPath && !variableReceive) {
            // Nothing to resolve — stay idle
            set((s) => ({ tabs: { ...s.tabs, [tab]: { ...s.tabs[tab], state: 'idle', trees: [], warnings: [] } } }));
            return;
        }
        const requestId = crypto.randomUUID();
        set((s) => {
            const prev = s.tabs[tab];
            const newIds = new Set(prev.requestIds);
            newIds.add(requestId);
            return {
                tabs: {
                    ...s.tabs,
                    [tab]: { ...prev, state: 'loading', trees: [], warnings: [], requestIds: newIds, lastStoredPath: storedPath, lastVariableReceive: variableReceive },
                },
            };
        });
        const msg: WebviewToHostMessage = {
            type: 'requestXsdTree',
            requestId,
            version: 1,
            payload: { storedPath, tab, variableReceive },
        };
        vscode.postMessage(msg);
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
        if (message.type !== 'xsdTree') return;
        const { tab, tree, warnings } = message.payload;
        set((s) => {
            const prev = s.tabs[tab];
            if (!prev.requestIds.has(message.requestId)) return s;
            const newIds = new Set(prev.requestIds);
            newIds.delete(message.requestId);
            const newTrees = [...prev.trees, tree];
            const newState: PanelState = newIds.size === 0 ? 'ready' : 'loading';
            return {
                tabs: {
                    ...s.tabs,
                    [tab]: { ...prev, state: newState, trees: newTrees, warnings: [...prev.warnings, ...warnings], requestIds: newIds },
                },
            };
        });
    },

    reset: () => set({ tabs: { input: emptyTab(), output: emptyTab(), error: emptyTab() } }),
}));
