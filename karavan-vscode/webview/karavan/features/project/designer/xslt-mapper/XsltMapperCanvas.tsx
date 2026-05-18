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
import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { XsltConnection } from '../../../../../../src/messages';

interface LineCoord {
    x1: number; y1: number;
    x2: number; y2: number;
    hasWarning: boolean;
    id: string;
}

interface Props {
    connections: XsltConnection[];
    containerRef: React.RefObject<HTMLDivElement | null>;
}

function getMidY(el: Element, container: DOMRect): number {
    const rect = el.getBoundingClientRect();
    return rect.top - container.top + rect.height / 2;
}

/** Escape a string for use as a literal value inside a CSS [attr="..."] selector. */
function cssAttrValue(v: string): string {
    return v.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/** Find a node in the source panel. Tries exact path match first, then last-segment fallback. */
function findSourceEl(container: Element, sourceVariable: string, sourceNodePath: string): Element | null {
    const exactKey = `${sourceVariable}|${sourceNodePath}`;
    const exact = container.querySelector(`[data-node-path="${cssAttrValue(exactKey)}"]`);
    if (exact) return exact;

    // Fallback: match by last segment of sourceNodePath within the correct variable's subtree
    const lastSeg = sourceNodePath.split('.').pop() ?? '';
    if (!lastSeg) return null;
    const prefix = `${sourceVariable}|`;
    const allSrcNodes = container.querySelectorAll('.mapper-source-panel [data-node-path]');
    for (const el of Array.from(allSrcNodes)) {
        const p = el.getAttribute('data-node-path') ?? '';
        if (!p.startsWith(prefix)) continue;
        const nodePart = p.slice(prefix.length);
        const seg = nodePart.split('.').pop() ?? '';
        if (seg === lastSeg) return el;
    }
    return null;
}

/** Find a node in the target panel. Empty targetNodePath → target root; otherwise exact then leaf fallback. */
function findTargetEl(container: Element, targetNodePath: string): Element | null {
    if (!targetNodePath) {
        // Root copy/passthrough: point to the first visible target node
        return container.querySelector('.mapper-target-panel [data-node-path]') ?? null;
    }
    const exact = container.querySelector(`[data-node-path="${cssAttrValue(targetNodePath)}"]`);
    if (exact) return exact;

    // Fallback: leaf-segment match within target panel (no | prefix)
    const leafName = targetNodePath.split('.').pop() ?? '';
    const allTgtNodes = container.querySelectorAll('.mapper-target-panel [data-node-path]');
    for (const el of Array.from(allTgtNodes)) {
        const p = el.getAttribute('data-node-path') ?? '';
        if (p.includes('|')) continue;
        const seg = p.split('.').pop() ?? '';
        if (seg === leafName) return el;
    }
    return null;
}

const BLUE = 'var(--pf-t--global--color--brand--default)';
const WARN = 'var(--pf-t--global--color--status--warning--default)';

export function XsltMapperCanvas({ connections, containerRef }: Props) {
    const [lines, setLines] = useState<LineCoord[]>([]);

    const computeLines = React.useCallback(() => {
        const container = containerRef.current;
        if (!container) return;
        const containerRect = container.getBoundingClientRect();
        if (!containerRect.width) return;

        const result: LineCoord[] = [];
        for (const conn of connections) {
            if (!conn.sourceVariable) continue;

            const srcEl = findSourceEl(container, conn.sourceVariable, conn.sourceNodePath);
            const tgtEl = findTargetEl(container, conn.targetNodePath);
            if (!srcEl || !tgtEl) continue;

            const y1 = getMidY(srcEl, containerRect);
            const y2 = getMidY(tgtEl, containerRect);

            const srcPanel = srcEl.closest('.mapper-source-panel');
            const tgtPanel = tgtEl.closest('.mapper-target-panel');
            if (!srcPanel || !tgtPanel) continue;

            const srcRect = srcPanel.getBoundingClientRect();
            const tgtRect = tgtPanel.getBoundingClientRect();

            result.push({
                id: conn.id,
                x1: srcRect.right - containerRect.left,
                y1,
                x2: tgtRect.left - containerRect.left,
                y2,
                hasWarning: !!conn.warning,
            });
        }
        setLines(result);
    }, [connections, containerRef]);

    // Fire after one animation frame so PF TreeView finishes painting
    useLayoutEffect(() => {
        const raf = requestAnimationFrame(() => computeLines());
        return () => cancelAnimationFrame(raf);
    }, [computeLines]);

    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;
        const observer = new ResizeObserver(() => computeLines());
        observer.observe(container);
        return () => observer.disconnect();
    }, [computeLines, containerRef]);

    const width = containerRef.current?.offsetWidth ?? 0;
    const height = containerRef.current?.offsetHeight ?? 0;

    return (
        <svg
            className="mapper-canvas"
            style={{ position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'visible',
                     width, height }}
        >
            <defs>
                <marker id="xk-arrow-blue" markerWidth="6" markerHeight="6" refX="6" refY="3" orient="auto">
                    <path d="M0,0 L0,6 L6,3 z" style={{ fill: BLUE }} />
                </marker>
                <marker id="xk-arrow-warn" markerWidth="6" markerHeight="6" refX="6" refY="3" orient="auto">
                    <path d="M0,0 L0,6 L6,3 z" style={{ fill: WARN }} />
                </marker>
            </defs>
            {lines.map((l) => {
                const cx = (l.x1 + l.x2) / 2;
                return (
                    <path
                        key={l.id}
                        d={`M${l.x1},${l.y1} C${cx},${l.y1} ${cx},${l.y2} ${l.x2},${l.y2}`}
                        style={{
                            fill: 'none',
                            stroke: l.hasWarning ? WARN : BLUE,
                            strokeWidth: 1.5,
                            strokeOpacity: 0.85,
                        }}
                        markerEnd={l.hasWarning ? 'url(#xk-arrow-warn)' : 'url(#xk-arrow-blue)'}
                    />
                );
            })}
        </svg>
    );
}
