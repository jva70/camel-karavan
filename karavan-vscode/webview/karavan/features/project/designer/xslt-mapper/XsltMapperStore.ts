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
import type { XsltConnection, Warning, XsdNode, HostToWebviewMessage, WebviewToHostMessage } from '../../../../../../src/messages';

export type MapperLoadState = 'idle' | 'loading' | 'ready' | 'error';
export type MapperViewMode = 'visual' | 'text';

export interface SourceTreeEntry {
    variableReceive: string;
    /** Resolved XSD tree from host, or null if schema path was empty or resolution failed. */
    tree: XsdNode | null;
    warnings: Warning[];
}

interface XsltMapperState {
    pendingRequestId: string | null;
    loadState: MapperLoadState;
    viewMode: MapperViewMode;
    storedPath: string;
    filename: string;
    xsltContent: string;
    connections: XsltConnection[];
    warnings: Warning[];
    errorDetail: string;
    /** One entry per upstream step — populated from xsltParsed reply. */
    sourceTrees: SourceTreeEntry[];
    openMapper: (storedPath: string, sourceSchemas: Array<{ variableReceive: string; storedPath: string }>) => void;
    resetMapper: () => void;
    setViewMode: (mode: MapperViewMode) => void;
    handleHostMessage: (message: HostToWebviewMessage) => void;
}

export const useXsltMapperStore = createWithEqualityFn<XsltMapperState>((set, get) => ({
    pendingRequestId: null,
    loadState: 'idle',
    viewMode: 'visual',
    storedPath: '',
    filename: '',
    xsltContent: '',
    connections: [],
    warnings: [],
    errorDetail: '',
    sourceTrees: [],

    openMapper: (storedPath, sourceSchemas) => {
        const requestId = crypto.randomUUID();
        const filename = storedPath.split('/').pop() ?? storedPath;
        set({ loadState: 'loading', storedPath, filename, connections: [], warnings: [], errorDetail: '', sourceTrees: [], pendingRequestId: requestId });

        const msg: WebviewToHostMessage = {
            type: 'requestXsltParse',
            requestId,
            version: 1,
            payload: { storedPath, sourceSchemas },
        };
        vscode.postMessage(msg);

        // Also fetch XSLT text content for the Monaco text view
        const contentMsg: WebviewToHostMessage = {
            type: 'requestXsltContent',
            requestId: crypto.randomUUID(),
            version: 1,
            payload: { storedPath },
        };
        vscode.postMessage(contentMsg);
    },

    resetMapper: () => set({
        loadState: 'idle',
        storedPath: '',
        filename: '',
        xsltContent: '',
        connections: [],
        warnings: [],
        errorDetail: '',
        sourceTrees: [],
        pendingRequestId: null,
    }),

    setViewMode: (viewMode) => set({ viewMode }),

    handleHostMessage: (message) => {
        const { pendingRequestId } = get();

        if (message.type === 'xsltContent') {
            // Capture XSLT text content for the Monaco text view
            set({ xsltContent: message.payload.content });
            return;
        }

        if (message.type === 'xsltParsed') {
            if (pendingRequestId && message.requestId !== pendingRequestId) return;
            set({
                loadState: 'ready',
                connections: message.payload.connections,
                warnings: message.payload.warnings,
                sourceTrees: message.payload.sourceTrees ?? [],
                pendingRequestId: null,
            });
            return;
        }

        if (message.type === 'error' && pendingRequestId && message.requestId === pendingRequestId) {
            set({
                loadState: 'error',
                errorDetail: message.payload.message,
                warnings: [{ code: message.payload.code, message: message.payload.message, detail: message.payload.detail, severity: 'error' }],
                pendingRequestId: null,
            });
        }
    },
}));
