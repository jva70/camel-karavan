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
import type { XsltConnection, Warning, HostToWebviewMessage, WebviewToHostMessage } from '../../../../../../src/messages';

export type MapperLoadState = 'idle' | 'loading' | 'ready' | 'error';

interface XsltMapperState {
    isOpen: boolean;
    storedPath: string;
    filename: string;
    loadState: MapperLoadState;
    connections: XsltConnection[];
    warnings: Warning[];
    openMapper: (storedPath: string) => void;
    closeMapper: () => void;
    handleHostMessage: (message: HostToWebviewMessage) => void;
}

export const useXsltMapperStore = createWithEqualityFn<XsltMapperState>((set, get) => ({
    isOpen: false,
    storedPath: '',
    filename: '',
    loadState: 'idle',
    connections: [],
    warnings: [],

    openMapper: (storedPath) => {
        const filename = storedPath.split('/').pop() ?? storedPath;
        set({ isOpen: true, storedPath, filename, loadState: 'loading', connections: [], warnings: [] });
        const msg: WebviewToHostMessage = {
            type: 'requestXsltParse',
            requestId: crypto.randomUUID(),
            version: 1,
            payload: { storedPath },
        };
        vscode.postMessage(msg);
    },

    closeMapper: () => set({ isOpen: false, loadState: 'idle', connections: [], warnings: [] }),

    handleHostMessage: (message) => {
        if (message.type !== 'xsltParsed') return;
        const { storedPath } = get();
        if (message.payload.connections !== undefined) {
            set({
                loadState: 'ready',
                connections: message.payload.connections,
                warnings: message.payload.warnings,
            });
        }
        void storedPath;
    },
}));
