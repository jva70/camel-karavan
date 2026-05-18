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
import * as vscode from 'vscode';
import * as path from 'path';
import { WebviewPanel } from 'vscode';
import { WebviewToHostMessage, HostToWebviewMessage } from './messages';
import { resolveStoredPath, makeStoredValue } from './propertiesResolver';
import { buildXsdTree, ReadFileFn } from './xsdResolver';

export async function handleXmlmapperMessage(
    panel: WebviewPanel,
    message: WebviewToHostMessage,
    yamlFullPath: string
): Promise<void> {
    const workspaceRoot = path.dirname(yamlFullPath);
    const { requestId } = message;

    switch (message.type) {
        case 'requestXsltContent': {
            try {
                const resolved = await resolveStoredPath(message.payload.storedPath, workspaceRoot);
                const data = await vscode.workspace.fs.readFile(vscode.Uri.file(resolved));
                const content = Buffer.from(data).toString('utf8');
                const reply: HostToWebviewMessage = {
                    type: 'xsltContent', requestId, version: 1,
                    payload: { resolvedPath: resolved, content },
                };
                panel.webview.postMessage(reply);
            } catch (err: any) {
                const reply: HostToWebviewMessage = {
                    type: 'error', requestId, version: 1,
                    payload: { code: 'XSLT_FILE_NOT_FOUND', message: err.message, detail: message.payload.storedPath },
                };
                panel.webview.postMessage(reply);
            }
            break;
        }
        case 'saveXsltContent': {
            try {
                const data = Buffer.from(message.payload.content, 'utf8');
                await vscode.workspace.fs.writeFile(vscode.Uri.file(message.payload.resolvedPath), data);
            } catch (err: any) {
                const reply: HostToWebviewMessage = {
                    type: 'error', requestId, version: 1,
                    payload: { code: 'XSLT_SAVE_FAILED', message: err.message },
                };
                panel.webview.postMessage(reply);
            }
            break;
        }
        case 'requestXsdTree': {
            const { storedPath, tab, variableReceive } = message.payload;
            const readFile: ReadFileFn = async (p: string) =>
                Buffer.from(await vscode.workspace.fs.readFile(vscode.Uri.file(p)));

            // Error tab may carry comma-separated paths in storedPath
            const rawPaths = storedPath
                ? storedPath.split(',').map((s) => s.trim()).filter(Boolean)
                : [];

            // Fallback: xsd/{variableReceive}_{tab}.xsd adjacent to YAML when no paths declared
            // Convention: _input.xsd / _output.xsd suffix matches XSLT/schema naming standard
            if (rawPaths.length === 0 && variableReceive) {
                const base = variableReceive.replace(/-/g, '_');
                const suffix = tab === 'output' ? '_output' : tab === 'error' ? '_error' : '_input';
                rawPaths.push(path.join(workspaceRoot, 'xsd', base + suffix + '.xsd'));
            }

            if (rawPaths.length === 0) {
                // Nothing to resolve → caller shows idle state (no reply = no state change)
                break;
            }

            for (const sp of rawPaths) {
                const absPath = sp.startsWith('file:') || sp.startsWith('/')
                    ? await resolveStoredPath(sp.startsWith('/') ? 'file:' + sp : sp, workspaceRoot)
                    : sp;
                const result = await buildXsdTree(absPath, readFile);
                const reply: HostToWebviewMessage = {
                    type: 'xsdTree', requestId, version: 1,
                    payload: { tab, tree: result.root, warnings: result.warnings },
                };
                panel.webview.postMessage(reply);
            }
            break;
        }
        case 'selectFile': {
            const filters: { [name: string]: string[] } = message.payload.filter === 'xslt'
                ? { 'XSLT Files': ['xsl', 'xslt'] }
                : { 'XSD Files': ['xsd'] };
            const uris = await vscode.window.showOpenDialog({
                canSelectMany: false,
                filters,
                defaultUri: vscode.Uri.file(workspaceRoot),
            });
            if (uris && uris[0]) {
                const resolvedPath = uris[0].fsPath;
                const storedPath = await makeStoredValue(resolvedPath, workspaceRoot);
                const reply: HostToWebviewMessage = {
                    type: 'fileSelected', requestId, version: 1,
                    payload: { propertyId: message.payload.propertyId, resolvedPath, storedPath },
                };
                panel.webview.postMessage(reply);
            }
            break;
        }
    }
}
