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
import {Button, InputGroup, InputGroupItem, TextInput} from '@patternfly/react-core';
import {EditAltIcon, FolderOpenIcon, ConnectedIcon} from '@patternfly/react-icons';
import {PropertyMeta} from '@karavan-core/model/CamelMetadata';
import {useXsltStore} from './XsltStore';
import {XsltEditorModal} from './XsltEditorModal';
import {XSLT_BINDING_PROPERTIES} from './XsltConfig';
import {useXsltMapperStore} from '../xslt-mapper/XsltMapperStore';
import vscode from '@/vscode';
import type {WebviewToHostMessage} from '../../../../../../src/messages';
import './XsltPropertyField.css';

export {XSLT_BINDING_PROPERTIES};

interface Props {
    property: PropertyMeta;
    value: any;
    propertyChanged: (fieldId: string, value: any) => void;
}

export function XsltPropertyField({property, value, propertyChanged}: Props) {
    const fileSelectedPayload = useXsltStore((s) => s.fileSelectedPayload);
    const [modalOpen, setModalOpen] = useState(false);

    useEffect(() => {
        if (fileSelectedPayload?.propertyId === property.name) {
            propertyChanged(property.name, fileSelectedPayload.storedPath);
            useXsltStore.getState().clearFileSelected();
        }
    }, [fileSelectedPayload]);

    const handleFilePick = () => {
        const msg: WebviewToHostMessage = {
            type: 'selectFile',
            requestId: crypto.randomUUID(),
            version: 1,
            payload: {propertyId: property.name, currentValue: value ?? '', filter: 'xslt'},
        };
        vscode.postMessage(msg);
    };

    const handleEdit = () => {
        if (value) {
            const msg: WebviewToHostMessage = {
                type: 'requestXsltContent',
                requestId: crypto.randomUUID(),
                version: 1,
                payload: {storedPath: value},
            };
            vscode.postMessage(msg);
        }
        setModalOpen(true);
    };

    const handleOpenMapper = () => {
        if (value) useXsltMapperStore.getState().openMapper(value);
    };

    return (
        <>
            <InputGroup className="xslt-property-field">
                <InputGroupItem isFill>
                    <TextInput
                        id={property.name}
                        value={value ?? ''}
                        onChange={(_e, v) => propertyChanged(property.name, v)}
                        placeholder="file:{{project.root.*}}/path/to/mapping.xsl"
                    />
                </InputGroupItem>
                <InputGroupItem>
                    <Button variant="control" aria-label="Pick XSLT file" onClick={handleFilePick}>
                        <FolderOpenIcon />
                    </Button>
                </InputGroupItem>
                <InputGroupItem>
                    <Button variant="control" aria-label="Open XSLT editor" isDisabled={!value} onClick={handleEdit}>
                        <EditAltIcon />
                    </Button>
                </InputGroupItem>
                <InputGroupItem>
                    <Button variant="control" aria-label="Open visual mapper" isDisabled={!value} onClick={handleOpenMapper}>
                        <ConnectedIcon />
                    </Button>
                </InputGroupItem>
            </InputGroup>
            {modalOpen && (
                <XsltEditorModal storedPath={value ?? ''} onClose={() => setModalOpen(false)} />
            )}
        </>
    );
}
