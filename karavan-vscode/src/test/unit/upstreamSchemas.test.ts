import { describe, it, expect } from 'vitest';
import { getUpstreamStepSchemas } from '../../../webview/karavan/features/project/designer/xslt-mapper/upstreamSchemas';

const k = (uuid: string, vr: string, out?: string, inp?: string) => ({
    uuid, dslName: 'ToDefinition', variableReceive: vr,
    parameters: { ...(out ? { outputSchema: out } : {}), ...(inp ? { inputSchema: inp } : {}) },
});
const names = (r: any[]) => r.map((x) => x.variableReceive);

describe('getUpstreamStepSchemas', () => {
    it('Start only precedes the first step; uses outputSchema, never inputSchema', () => {
        const from = { uuid: 'f', dslName: 'FromDefinition', variableReceive: 'Start', parameters: { outputSchema: 'S.xsd' },
            steps: [k('log', 'Log', undefined, 'L.xsd'), k('soap', 'Soap', 'O.xsd', 'I.xsd')] };
        const integ = { spec: { flows: [{ from }] } };
        expect(getUpstreamStepSchemas(integ, 'log')).toEqual([{ variableReceive: '$Start', storedPath: 'S.xsd' }]);
        const r = getUpstreamStepSchemas(integ, 'soap');
        expect(r).toEqual([{ variableReceive: '$Start', storedPath: 'S.xsd' }, { variableReceive: '$Log', storedPath: '' }]);
    });

    it('a step with only an inputSchema contributes no schema', () => {
        const from = { uuid: 'f', dslName: 'FromDefinition', variableReceive: 'Start', parameters: { inputSchema: 'legacy.xsd' }, steps: [k('a', 'A')] };
        expect(getUpstreamStepSchemas({ spec: { flows: [{ from }] } }, 'a')).toEqual([{ variableReceive: '$Start', storedPath: '' }]);
    });

    it('choice: sibling branches and later steps are excluded, passed branches are included', () => {
        const choice = { uuid: 'c', dslName: 'ChoiceDefinition',
            when: [{ uuid: 'w1', dslName: 'WhenDefinition', steps: [k('b1', 'B1', 'b1.xsd'), k('sel', 'Sel')] }],
            otherwise: { uuid: 'o', dslName: 'OtherwiseDefinition', steps: [k('b2', 'B2', 'b2.xsd')] } };
        const from = { uuid: 'f', dslName: 'FromDefinition', variableReceive: 'Start', parameters: {},
            steps: [k('a', 'A', 'a.xsd'), choice, k('after', 'After', 'af.xsd')] };
        const integ = { spec: { flows: [{ from }] } };
        expect(names(getUpstreamStepSchemas(integ, 'sel'))).toEqual(['$Start', '$A', '$B1']);
        expect(names(getUpstreamStepSchemas(integ, 'after'))).toEqual(['$Start', '$A', '$B1', '$Sel', '$B2']);
        expect(names(getUpstreamStepSchemas(integ, 'b2'))).toEqual(['$Start', '$A']);
    });

    it('try/catch: try-body steps precede the catch steps', () => {
        const tryStep = { uuid: 't', dslName: 'TryDefinition', steps: [k('call', 'Call', 'c.xsd')],
            doCatch: [{ uuid: 'dc', dslName: 'DoCatchDefinition', steps: [k('err', 'Err')] }] };
        const from = { uuid: 'f', dslName: 'FromDefinition', variableReceive: 'Start', parameters: {}, steps: [tryStep] };
        expect(names(getUpstreamStepSchemas({ spec: { flows: [{ from }] } }, 'err'))).toEqual(['$Start', '$Call']);
    });

    it('unknown selection yields no sources', () => {
        const from = { uuid: 'f', dslName: 'FromDefinition', variableReceive: 'Start', parameters: {}, steps: [] };
        expect(getUpstreamStepSchemas({ spec: { flows: [{ from }] } }, 'nope')).toEqual([]);
    });
});
