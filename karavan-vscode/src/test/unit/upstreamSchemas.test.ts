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

    describe('exception branches', () => {
        const ROOT = 'file:{{project.root.proj}}';
        const ka = (uuid: string, vr: string, activityName: string, extra: Record<string, string> = {}) => ({
            uuid, dslName: 'ToDefinition', uri: 'kamelet:x', variableReceive: vr, parameters: { activityName, outputSchema: `${ROOT}/${vr}.xsd`, ...extra },
        });
        const make = () => {
            const tryStep = { uuid: 't', dslName: 'TryDefinition', steps: [ka('call', 'Call', 'Call Soap')],
                doCatch: [{ uuid: 'dc', dslName: 'DoCatchDefinition', steps: [k('log', 'ErrLog'), k('err', 'Err')] }] };
            const from = { uuid: 'f', dslName: 'FromDefinition', variableReceive: 'Start', parameters: { outputSchema: `${ROOT}/Start.xsd` },
                steps: [k('first', 'First', 'f.xsd'), tryStep, k('after', 'After', 'a.xsd')] };
            return { spec: { flows: [{ from }] } };
        };

        it('in a doCatch the try activities give $_error_<activity>, not their output', () => {
            const r = getUpstreamStepSchemas(make(), 'log');
            expect(names(r)).toEqual(['$Start', '$First', '$_error', '$_error_Call-Soap']);
            expect(r.find((x) => x.variableReceive === '$_error')).toEqual(
                { variableReceive: '$_error', storedPath: `${ROOT}/Resources/TIBCO_Standard/EngineTypes.xsd`, rootElement: 'ErrorReport' });
        });

        it('earlier steps of the catch branch are sources, after the try/catch everything counts again', () => {
            expect(names(getUpstreamStepSchemas(make(), 'err'))).toEqual(['$Start', '$First', '$_error', '$_error_Call-Soap', '$ErrLog']);
            expect(names(getUpstreamStepSchemas(make(), 'after'))).toEqual(['$Start', '$First', '$Call', '$ErrLog', '$Err']);
        });

        it('a single errorSchemas path is used for $_error_<activity>; several are left to the XSLT-inferred tree', () => {
            const one = make();
            (one.spec.flows[0].from.steps[1] as any).steps[0].parameters.errorSchemas = `${ROOT}/Fault.xsd`;
            expect(getUpstreamStepSchemas(one, 'log').find((x) => x.variableReceive === '$_error_Call-Soap')?.storedPath).toBe(`${ROOT}/Fault.xsd`);
            (one.spec.flows[0].from.steps[1] as any).steps[0].parameters.errorSchemas = `${ROOT}/A.xsd, ${ROOT}/B.xsd`;
            expect(getUpstreamStepSchemas(one, 'log').find((x) => x.variableReceive === '$_error_Call-Soap')?.storedPath).toBe('');
        });

        it('top-level onException handler: only $_error plus earlier handler steps', () => {
            const oe = { uuid: 'oe', dslName: 'OnExceptionDefinition', steps: [k('h1', 'H1', 'h.xsd'), k('h2', 'H2')] };
            const integ = { spec: { flows: [oe, make().spec.flows[0]] } };
            expect(names(getUpstreamStepSchemas(integ, 'h2'))).toEqual(['$_error', '$H1']);
        });
    });

    it('unknown selection yields no sources', () => {
        const from = { uuid: 'f', dslName: 'FromDefinition', variableReceive: 'Start', parameters: {}, steps: [] };
        expect(getUpstreamStepSchemas({ spec: { flows: [{ from }] } }, 'nope')).toEqual([]);
    });
});
