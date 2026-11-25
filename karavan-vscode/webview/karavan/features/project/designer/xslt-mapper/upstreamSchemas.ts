// Source variables for the XSLT mapper: output schemas of the steps preceding the selected step.

/**
 * Source variables of the XSLT mapper = the OUTPUT schemas of the steps that execute BEFORE the selected step.
 *
 * "Before" follows the route structure (TIBCO: activities that precede the selected one in the transition graph):
 *  - the route's `from` (the Start activity) and every earlier step of the enclosing step lists,
 *  - steps of a branching container (choice / try-catch) count only on the way to the selected step; once the container
 *    is passed, all its branches count (any of them may have run),
 *  - alternative branches of the selected step's own choice, and steps after the selected step, are NOT sources.
 * Only `outputSchema` / `variableSchema` are used: an input schema describes what a step consumes, not a variable.
 * A later assignment of the same variableReceive replaces the earlier one.
 *
 * Exception branches (EXCEPTION_HANDLING.md): inside a `doCatch` the activities of the `doTry` body may have failed, so their
 * output variables are NOT available; instead `$_error` (EngineTypes.xsd / ErrorReport) and `$_error_<activityName>` for each
 * activity of the try body are. Inside a top-level `onException` handler only `$_error` is available.
 */
export interface UpstreamSchema {
    variableReceive: string;
    storedPath: string;
    /** Use only this global element of the schema file as the variable's root (e.g. ErrorReport of EngineTypes.xsd). */
    rootElement?: string;
}

const ENGINE_TYPES = 'Resources/TIBCO_Standard/EngineTypes.xsd';

export function getUpstreamStepSchemas(
    integration: any,
    selectedStepUuid: string
): UpstreamSchema[] {
    // The project-root placeholder used by the route's own schema paths, e.g. file:{{project.root.dareapiio}}
    const rootPrefix = JSON.stringify(integration?.spec?.flows ?? []).match(/file:\{\{project\.root\.[\w.-]+\}\}/)?.[0];
    const errorEntry = (): any => ({
        variableReceive: '_error',
        rootElement: 'ErrorReport',
        parameters: { outputSchema: rootPrefix ? `${rootPrefix}/${ENGINE_TYPES}` : '' },
    });

    /** Leaf activities (kamelet / endpoint steps) anywhere below `node`. */
    const collectActivities = (node: any, out: any[] = []): any[] => {
        if (!node || typeof node !== 'object') return out;
        if (typeof node.uri === 'string') out.push(node);
        for (const key of ['steps', 'when', 'otherwise', 'doCatch', 'doFinally']) {
            const v = node[key];
            for (const child of Array.isArray(v) ? v : v ? [v] : []) collectActivities(child, out);
        }
        return out;
    };

    const activityErrorEntries = (body: any): any[] => collectActivities({ steps: body }).flatMap((a) => {
        const name: string = a.parameters?.activityName ?? a.variableReceive ?? '';
        if (!name) return [];
        const paths = String(a.parameters?.errorSchemas ?? a.parameters?.errorSchema ?? '').split(',').map((x) => x.trim()).filter(Boolean);
        // several fault schemas cannot be shown as one tree: leave it to the tree inferred from the XSLT
        return [{ variableReceive: `_error_${name.replace(/\s+/g, '-')}`, parameters: { outputSchema: paths.length === 1 ? paths[0] : '' } }];
    });

    const visitList = (list: any, acc: any[]): boolean => {
        for (const child of Array.isArray(list) ? list : []) {
            if (visit(child, acc)) return true;
        }
        return false;
    };

    /** Branches start from the same predecessors; on a miss all of them become predecessors of what follows. */
    const visitBranches = (branches: any[], acc: any[]): boolean => {
        const base = acc.slice();
        const passed: any[] = [];
        for (const branch of branches) {
            if (!branch) continue;
            const local = base.slice();
            if (visit(branch, local)) {
                acc.length = 0;
                acc.push(...local);
                return true;
            }
            passed.push(...local.slice(base.length));
        }
        acc.push(...passed);
        return false;
    };

    /** true when the selected step lies inside `node`; `acc` then holds the steps executed before it. */
    function visit(node: any, acc: any[]): boolean {
        if (!node || typeof node !== 'object') return false;
        if (node.uuid === selectedStepUuid) return true;
        switch (node.dslName) {
            case 'ChoiceDefinition':
                return visitBranches([...(node.when ?? []), node.otherwise], acc);
            case 'TryDefinition': {
                const beforeTry = acc.length;
                if (visitList(node.steps, acc)) return true;
                // A catch branch starts from what was available before the try body: the try activities may have failed,
                // so it sees $_error / $_error_<activity> instead of their output variables.
                const tryBody = acc.splice(beforeTry);
                const base = [...acc, errorEntry(), ...activityErrorEntries(node.steps)];
                const passed: any[] = [];
                for (const branch of node.doCatch ?? []) {
                    const local = base.slice();
                    if (visit(branch, local)) {
                        acc.length = 0;
                        acc.push(...local);
                        return true;
                    }
                    passed.push(...local.slice(base.length));
                }
                // Past the whole try/catch: the try body and any catch branch may have run
                acc.push(...tryBody, ...passed);
                return node.doFinally ? visit(node.doFinally, acc) : false;
            }
            default:
                if (Array.isArray(node.steps)) {
                    if (node.variableReceive) acc.push(node);   // e.g. `from` = Start: produces its variable before the steps run
                    return visitList(node.steps, acc);
                }
                acc.push(node);
                return false;
        }
    }

    const toSchemas = (acc: any[]): UpstreamSchema[] => {
        const latest = new Map<string, UpstreamSchema>();
        for (const step of acc) {
            const vr: string = step.variableReceive ?? '';
            if (!vr) continue;
            const params = step.parameters ?? {};
            latest.delete(vr);   // keep execution order of the latest assignment
            const entry: UpstreamSchema = { variableReceive: `$${vr}`, storedPath: params.outputSchema ?? params.variableSchema ?? '' };
            if (step.rootElement) entry.rootElement = step.rootElement;
            latest.set(vr, entry);
        }
        return Array.from(latest.values());
    };

    for (const flow of integration.spec?.flows ?? []) {
        // Top-level onException handler: only the error variable exists (no route variables)
        if (flow?.dslName === 'OnExceptionDefinition') {
            const acc: any[] = [errorEntry()];
            if (visitList(flow.steps, acc)) return toSchemas(acc);
            continue;
        }
        const from = flow?.from;
        if (!from) continue;
        const acc: any[] = [];
        if (!visit(from, acc)) continue;
        return toSchemas(acc);
    }
    return [];
}
