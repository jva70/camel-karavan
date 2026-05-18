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
import React, {useEffect, useState} from 'react';
import Editor from '@monaco-editor/react';
import {Button} from '@patternfly/react-core';
import {useXsltStore} from './XsltStore';
import {useTheme} from '@app/theme/ThemeContext';
import vscode from '@/vscode';
import type {WebviewToHostMessage} from '../../../../../../src/messages';
import './XsltEditorModal.css';

const LAYOUT_KEY = 'karavan.xslt-modal-layout';

function loadLayout() {
    try {
        const saved = localStorage.getItem(LAYOUT_KEY);
        return saved ? JSON.parse(saved) : {width: 820, height: 520};
    } catch {
        return {width: 820, height: 520};
    }
}

interface Props {
    storedPath: string;
    onClose: () => void;
}

export function XsltEditorModal({storedPath, onClose}: Props) {
    const {isDark} = useTheme();
    const [xsltContent, resolvedPath] = useXsltStore((s) => [s.xsltContent, s.resolvedPath]);
    const [editedContent, setEditedContent] = useState<string | undefined>(undefined);
    const [layout, setLayout] = useState(loadLayout);

    useEffect(() => {
        setEditedContent(xsltContent || '');
    }, [xsltContent]);

    useEffect(() => {
        try {
            localStorage.setItem(LAYOUT_KEY, JSON.stringify(layout));
        } catch {/* ignore */}
    }, [layout]);

    const save = () => {
        if (resolvedPath && editedContent !== undefined) {
            const msg: WebviewToHostMessage = {
                type: 'saveXsltContent',
                requestId: crypto.randomUUID(),
                version: 1,
                payload: {resolvedPath, content: editedContent},
            };
            vscode.postMessage(msg);
        }
        onClose();
    };

    return (
        <div className="xslt-modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
            <div
                className="xslt-modal"
                style={{width: layout.width, height: layout.height}}
                onMouseUp={(e) => {
                    const el = e.currentTarget;
                    setLayout({width: el.offsetWidth, height: el.offsetHeight});
                }}
            >
                <div className="xslt-modal-header">
                    <span className="xslt-modal-title" title={storedPath}>
                        XSLT Editor — {storedPath.split('/').pop() ?? storedPath}
                    </span>
                    <Button variant="plain" aria-label="Close" onClick={onClose}>×</Button>
                </div>
                <div className="xslt-modal-body">
                    <Editor
                        height="100%"
                        language="xml"
                        value={editedContent}
                        theme={isDark ? 'vs-dark' : 'vs'}
                        onChange={(val) => setEditedContent(val ?? '')}
                        options={{minimap: {enabled: false}, wordWrap: 'on', scrollBeyondLastLine: false}}
                    />
                </div>
                <div className="xslt-modal-footer">
                    <Button variant="primary" onClick={save}>Save</Button>
                    <Button variant="link" onClick={onClose}>Cancel</Button>
                </div>
            </div>
        </div>
    );
}
