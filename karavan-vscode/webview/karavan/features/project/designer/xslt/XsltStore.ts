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
import {createWithEqualityFn} from 'zustand/traditional';
import type {HostToWebviewMessage} from '../../../../../../src/messages';
import {useSchemaPanelStore} from '../schema-panel/SchemaPanelStore';

interface FileSelectedPayload {
    propertyId: string;
    resolvedPath: string;
    storedPath: string;
    requestId: string;
}

interface XsltState {
    yamlFullPath: string;
    xsltContent: string;
    resolvedPath: string;
    fileSelectedPayload: FileSelectedPayload | null;
    setYamlFullPath: (yamlFullPath: string) => void;
    clearFileSelected: () => void;
    handleHostMessage: (message: HostToWebviewMessage) => void;
}

export const useXsltStore = createWithEqualityFn<XsltState>((set) => ({
    yamlFullPath: '',
    xsltContent: '',
    resolvedPath: '',
    fileSelectedPayload: null,
    setYamlFullPath: (yamlFullPath) => set({yamlFullPath}),
    clearFileSelected: () => set({fileSelectedPayload: null}),
    handleHostMessage: (message) => {
        switch (message.type) {
            case 'xsltContent':
                set({xsltContent: message.payload.content, resolvedPath: message.payload.resolvedPath});
                break;
            case 'fileSelected':
                set({
                    fileSelectedPayload: {
                        propertyId: message.payload.propertyId,
                        resolvedPath: message.payload.resolvedPath,
                        storedPath: message.payload.storedPath,
                        requestId: message.requestId,
                    },
                });
                break;
            case 'xsdTree':
                useSchemaPanelStore.getState().handleHostMessage(message);
                break;
        }
    },
}));
