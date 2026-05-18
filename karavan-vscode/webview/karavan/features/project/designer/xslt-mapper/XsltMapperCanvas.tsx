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

export function XsltMapperCanvas({ connections, containerRef }: Props) {
    const [lines, setLines] = useState<LineCoord[]>([]);
    const svgRef = useRef<SVGSVGElement>(null);

    const computeLines = () => {
        const container = containerRef.current;
        if (!container) return;
        const containerRect = container.getBoundingClientRect();

        const result: LineCoord[] = [];
        for (const conn of connections) {
            // Source: data-node-path="{sourceVariable}|{sourceNodePath}"
            const sourceKey = conn.sourceVariable
                ? `${conn.sourceVariable}|${conn.sourceNodePath}`
                : null;
            // Target: data-node-path is just the XSD path (no prefix)
            const targetKey = conn.targetNodePath || null;

            if (!sourceKey || !targetKey) continue;

            const srcEl = container.querySelector(`[data-node-path="${CSS.escape(sourceKey)}"]`);
            const tgtEl = container.querySelector(`[data-node-path="${CSS.escape(targetKey)}"]`);

            // Also try matching just the leaf segment of targetNodePath against XSD tree
            let resolvedTgt = tgtEl;
            if (!resolvedTgt && conn.targetNodePath) {
                // Try matching the last segment of the path inside any target tree
                const leafName = conn.targetNodePath.split('.').pop() ?? '';
                const allTargetNodes = container.querySelectorAll('[data-node-path]');
                for (const el of Array.from(allTargetNodes)) {
                    const p = el.getAttribute('data-node-path') ?? '';
                    if (!p.includes('|') && (p === conn.targetNodePath || p.endsWith('.' + leafName) || p === leafName)) {
                        resolvedTgt = el;
                        break;
                    }
                }
            }

            if (!srcEl || !resolvedTgt) continue;

            const y1 = getMidY(srcEl, containerRect);
            const y2 = getMidY(resolvedTgt, containerRect);

            // x1: right edge of source panel (srcEl is in left panel)
            const srcRect = srcEl.closest('.mapper-source-panel')?.getBoundingClientRect();
            const tgtRect = resolvedTgt.closest('.mapper-target-panel')?.getBoundingClientRect();
            if (!srcRect || !tgtRect) continue;

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
    };

    useLayoutEffect(() => {
        computeLines();
    }, [connections]);

    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;
        const observer = new ResizeObserver(() => computeLines());
        observer.observe(container);
        return () => observer.disconnect();
    }, [connections, containerRef]);

    const width = containerRef.current?.offsetWidth ?? 0;
    const height = containerRef.current?.offsetHeight ?? 0;

    return (
        <svg
            ref={svgRef}
            className="mapper-canvas"
            style={{ position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'visible' }}
            width={width}
            height={height}
        >
            <defs>
                <marker id="arrow-blue" markerWidth="6" markerHeight="6" refX="6" refY="3" orient="auto">
                    <path d="M0,0 L0,6 L6,3 z" fill="var(--pf-t--global--color--link--default)" />
                </marker>
                <marker id="arrow-warn" markerWidth="6" markerHeight="6" refX="6" refY="3" orient="auto">
                    <path d="M0,0 L0,6 L6,3 z" fill="var(--pf-t--global--color--status--warning--default)" />
                </marker>
            </defs>
            {lines.map((l) => {
                const color = l.hasWarning
                    ? 'var(--pf-t--global--color--status--warning--default)'
                    : 'var(--pf-t--global--color--link--default)';
                const marker = l.hasWarning ? 'url(#arrow-warn)' : 'url(#arrow-blue)';
                const cx = (l.x1 + l.x2) / 2;
                return (
                    <path
                        key={l.id}
                        d={`M${l.x1},${l.y1} C${cx},${l.y1} ${cx},${l.y2} ${l.x2},${l.y2}`}
                        fill="none"
                        stroke={color}
                        strokeWidth={1.5}
                        strokeOpacity={0.8}
                        markerEnd={marker}
                    />
                );
            })}
        </svg>
    );
}
