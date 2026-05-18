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
import {ToggleGroup, ToggleGroupItem} from '@patternfly/react-core';
import '@features/project/designer/property/DslProperties.css';
import {ErrorBoundaryWrapper} from "@shared/ui/ErrorBoundaryWrapper";
import {DslProperties} from "@features/project/designer/property/DslProperties";
import { ExpressionEditor } from './expression/ExpressionEditor';
import {SchemaPanelTabs} from '@features/project/designer/schema-panel/SchemaPanelTabs';

export function MainPropertiesPanel() {

    const [activeTabKey, setActiveTabKey] = React.useState<string | number>("properties");

    function getPropertiesPanelTabs() {
        return (
            <div className="main-tabs-wrapper" style={{padding: '4px 8px', borderBottom: '1px solid var(--pf-t--global--border--color--default)'}}>
                <ToggleGroup className="main-tabs" aria-label="PropertyTypes">
                    <ToggleGroupItem text="Properties" isSelected={activeTabKey === 'properties'}
                                     onChange={() => setActiveTabKey('properties')}/>
                    <ToggleGroupItem text="Schema" isSelected={activeTabKey === 'schema'}
                                     onChange={() => setActiveTabKey('schema')}/>
                </ToggleGroup>
            </div>
        )
    }


    return (
        <div className='main-properties'>
            {getPropertiesPanelTabs()}
            <ErrorBoundaryWrapper onError={error => console.error(error)}>
                {activeTabKey === 'properties' && <DslProperties expressionEditor={ExpressionEditor}/> }
                {activeTabKey === 'schema' && <SchemaPanelTabs/>}
            </ErrorBoundaryWrapper>
        </div>
    )

}
