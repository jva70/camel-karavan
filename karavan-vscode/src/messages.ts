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

/**
 * XKaravan host↔WebView typed message protocol.
 *
 * Both the extension host (src/) and the WebView (webview/) import from this
 * file. It must remain free of any runtime imports (no vscode, no react) so it
 * can be loaded in both Node.js and browser contexts.
 */

export const PROTOCOL_VERSION = 1 as const;

// ---------------------------------------------------------------------------
// Shared data model types
// ---------------------------------------------------------------------------

export type SchemaTab = 'input' | 'output' | 'error';

export type PanelState = 'idle' | 'loading' | 'ready' | 'error';

export interface Warning {
    /** Machine-readable code — extend by appending; never rename existing. */
    code: string;
    /** Human-readable one-liner for panel display. */
    message: string;
    /** File path, YAML field name, or other diagnostic detail. */
    detail?: string;
    severity: 'error' | 'warning';
}

export interface XsdNode {
    /** Element / attribute / type local name. */
    name: string;
    type: 'element' | 'complexType' | 'simpleType' | 'attribute'
        | 'group' | 'attributeGroup' | 'any';
    /** XSD data type, e.g. "xs:string", "tns:OrderType" — absent for structural containers. */
    dataType?: string;
    /** Target namespace URI of the XSD file this node originates from. */
    nsUri?: string;
    children: XsdNode[];
    /** Dot-separated path from root, e.g. "Order.Header.Id". */
    path: string;
    /** Absolute path of the XSD file this node came from. */
    sourceFile: string;
    warning?: string;
}

export interface XsltConnection {
    /** UUID — stable across edits. */
    id: string;
    /** Matches XsdNode.path from a source tree. */
    sourceNodePath: string;
    /** variableReceive of the source Kamelet ($activityName). */
    sourceVariable: string;
    /** Matches XsdNode.path from the target tree. */
    targetNodePath: string;
    /** Raw XPath string from the XSLT select attribute. */
    xpathExpression: string;
    /** e.g. "source node not found in current schema". */
    warning?: string;
}

export interface SchemaParams {
    inputSchema?: string;
    outputSchema?: string;
    variableSchema?: string;
    errorSchema?: string;
    /** Comma-separated list. */
    errorSchemas?: string;
    inputBinding?: string;
    outputBinding?: string;
    wsdlURL?: string;
    serviceName?: string;
    portName?: string;
}

// ---------------------------------------------------------------------------
// Host → WebView messages
// ---------------------------------------------------------------------------

export type HostToWebviewMessage =
    | {
        type: 'xsltContent';
        requestId: string;
        version: 1;
        payload: { resolvedPath: string; content: string };
    }
    | {
        type: 'xsdTree';
        requestId: string;
        version: 1;
        payload: { tab: SchemaTab; tree: XsdNode; warnings: Warning[] };
    }
    | {
        type: 'wsdlSchema';
        requestId: string;
        version: 1;
        payload: { tree: XsdNode; warnings: Warning[] };
    }
    | {
        type: 'fileSelected';
        requestId: string;
        version: 1;
        payload: { propertyId: string; resolvedPath: string; storedPath: string };
    }
    | {
        type: 'error';
        requestId: string;
        version: 1;
        payload: { code: string; message: string; detail?: string };
    }
    | {
        type: 'xsdFileList';
        requestId: string;
        version: 1;
        payload: { files: Array<{ storedPath: string; label: string }> };
    }
    | {
        type: 'xsdRoots';
        requestId: string;
        version: 1;
        payload: { roots: string[] };
    }
    | {
        type: 'schemaSaved';
        requestId: string;
        version: 1;
        payload: { storedPath: string };
    }
    | {
        type: 'xsltParsed';
        requestId: string;
        version: 1;
        payload: { connections: XsltConnection[]; warnings: Warning[] };
    };

// ---------------------------------------------------------------------------
// WebView → Host messages
// ---------------------------------------------------------------------------

export type WebviewToHostMessage =
    | {
        type: 'requestXsdTree';
        requestId: string;
        version: 1;
        payload: { storedPath: string; tab: SchemaTab; variableReceive?: string };
    }
    | {
        type: 'requestXsltContent';
        requestId: string;
        version: 1;
        payload: { storedPath: string };
    }
    | {
        type: 'saveXsltContent';
        requestId: string;
        version: 1;
        payload: { resolvedPath: string; content: string };
    }
    | {
        type: 'selectFile';
        requestId: string;
        version: 1;
        payload: { propertyId: string; currentValue: string; filter: 'xslt' | 'xsd' };
    }
    | {
        type: 'requestWsdlSchema';
        requestId: string;
        version: 1;
        payload: { wsdlPath: string; serviceName: string; portName: string };
    }
    | {
        type: 'listXsdFiles';
        requestId: string;
        version: 1;
        payload: Record<string, never>;
    }
    | {
        type: 'requestXsdRoots';
        requestId: string;
        version: 1;
        payload: { storedPath: string };
    }
    | {
        type: 'saveXsdContent';
        requestId: string;
        version: 1;
        payload: { absolutePath: string; xsdContent: string };
    }
    | {
        type: 'saveSchemaParam';
        requestId: string;
        version: 1;
        payload: {
            stepId: string;
            paramName: 'inputSchema' | 'outputSchema' | 'variableSchema' | 'errorSchema';
            storedPath: string;
        };
    }
    | {
        type: 'requestXsltParse';
        requestId: string;
        version: 1;
        payload: { storedPath: string };
    };
