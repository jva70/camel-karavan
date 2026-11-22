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
 */
export function getUpstreamStepSchemas(
    integration: any,
    selectedStepUuid: string
): Array<{ variableReceive: string; storedPath: string }> {
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
            case 'TryDefinition':
                if (visitList(node.steps, acc)) return true;
                if (visitBranches(node.doCatch ?? [], acc)) return true;
                return node.doFinally ? visit(node.doFinally, acc) : false;
            default:
                if (Array.isArray(node.steps)) {
                    if (node.variableReceive) acc.push(node);   // e.g. `from` = Start: produces its variable before the steps run
                    return visitList(node.steps, acc);
                }
                acc.push(node);
                return false;
        }
    }

    for (const flow of integration.spec?.flows ?? []) {
        const from = flow?.from;
        if (!from) continue;
        const acc: any[] = [];
        if (!visit(from, acc)) continue;

        const latest = new Map<string, string>();
        for (const step of acc) {
            const vr: string = step.variableReceive ?? '';
            if (!vr) continue;
            const params = step.parameters ?? {};
            latest.delete(vr);   // keep execution order of the latest assignment
            latest.set(vr, params.outputSchema ?? params.variableSchema ?? '');
        }
        return Array.from(latest, ([vr, storedPath]) => ({ variableReceive: `$${vr}`, storedPath }));
    }
    return [];
}
