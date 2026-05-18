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
import React from 'react';
import { Badge, TreeView, TreeViewDataItem } from '@patternfly/react-core';
import type { XsdNode } from '../../../../../../src/messages';

function stripXsPrefix(t: string): string {
    if (t.startsWith('xs:') || t.startsWith('xsd:')) return t.slice(t.indexOf(':') + 1);
    const colon = t.indexOf(':');
    return colon >= 0 ? t.slice(colon + 1) : t;
}

function toTreeItem(node: XsdNode, pathPrefix?: string): TreeViewDataItem {
    const qualifiedPath = pathPrefix ? `${pathPrefix}|${node.path}` : node.path;
    return {
        id: node.path || node.name,
        name: (
            <span
                className="schema-node-label"
                data-node-path={qualifiedPath}
                title={node.nsUri ? `{${node.nsUri}}${node.name}` : undefined}
            >
                <span className="schema-node-name">{node.name}</span>
                {node.dataType && (
                    <span className="schema-node-type">: {stripXsPrefix(node.dataType)}</span>
                )}
                {node.type !== 'element' && node.type !== 'attribute' && (
                    <Badge isRead style={{ marginLeft: 4 }}>{node.type}</Badge>
                )}
                {node.warning && (
                    <Badge style={{ marginLeft: 4, backgroundColor: 'var(--pf-t--global--color--status--warning--default)' }}>!</Badge>
                )}
            </span>
        ),
        defaultExpanded: true,
        children: node.children.length > 0 ? node.children.map((c) => toTreeItem(c, pathPrefix)) : undefined,
    };
}

interface Props {
    root: XsdNode;
    label?: string;
    /** Prefix added to data-node-path attributes for mapper canvas lookup (e.g. "$variableName"). */
    pathPrefix?: string;
}

export function SchemaTreeView({ root, label, pathPrefix }: Props) {
    return (
        <div className="schema-tree-view">
            {label && <div className="schema-tree-label">{label}</div>}
            <TreeView
                data={[toTreeItem(root, pathPrefix)]}
                defaultAllExpanded
                aria-label={label ?? root.name}
            />
        </div>
    );
}
