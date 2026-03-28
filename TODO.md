# TODO: onException Support in Karavan VSCode Plugin

## Requirement

Apache Camel YAML route files in real projects start with one or more top-level
`- onException:` blocks (up to 5 observed in practice) followed by `- route:` blocks.
Example: `/home/vanovcan/repos/O2/BW5/bw5_helpers/claude_examples_mmd/checkAndDeactivate.camel.yaml`

These blocks are **global exception handlers** applied automatically to all routes in the file.
They are NOT the same as `routeConfiguration` — that is a named configuration requiring routes
to opt in via `routeConfigurationId`.

Each `onException` block supports:
- `exception`: list of exception class names
- `onWhen`: conditional expression (simple/xpath) to match a specific exception type/state
- `redeliveryPolicy`: retry configuration (maximumRedeliveries, redeliveryDelay, etc.)
- `handled`: expression marking the exception as handled
- `continued`: expression to continue routing after handling
- `steps`: handler steps (choice, log, to, etc.)

## Goals

- [ ] **Parse**: Top-level `- onException:` blocks load correctly into the integration model
- [ ] **Save**: Round-trip saves as top-level `- onException:` entries (not `routeConfiguration`)
- [ ] **Display**: Each `onException` block visible as its own panel in the designer
- [ ] **Edit**: Click to select → properties panel shows all fields; steps are expandable/editable
- [ ] **Create**: "Add onException" button creates a new empty handler
- [ ] **Delete**: Can delete an `onException` panel

## Root Cause of Current Breakage

Three bugs in `karavan-core`:

1. **`CamelDefinitionYaml.ts` `flowsToCamelElements` line 335**
   Wraps each top-level `- onException:` into a `RouteConfigurationDefinition` — wrong semantics.
   Also passes a single object where an array is expected → `.map()` crash.

2. **`CamelDefinitionYamlStep.ts` `readRouteConfigurationDefinition` line 2114**
   Uses `x.onException` (Karavan's double-wrap format) instead of `x` (standard Camel YAML).

3. **`CamelDefinitionYaml.ts` `replacer` lines 185-196**
   Double-wraps array items as `{ onException: {...} }` inside the array when serializing,
   producing non-standard YAML.

## Implementation Checklist

### karavan-core

- [ ] `src/core/api/CamelDefinitionYaml.ts`
  - `flowsToCamelElements`: replace RouteConfigurationDefinition wrapping with direct
    `CamelDefinitionYamlStep.readOnExceptionDefinition(f.onException)` call

- [ ] `src/core/api/CamelDefinitionApiExt.ts`
  - `addStepToIntegration`: add `OnExceptionDefinition` flows handling (parallel to routes)
  - add `addOnExceptionToIntegration(integration, oe)` function
  - add `deleteOnExceptionFromIntegration(integration, oe)` function

### karavan-vscode webview

- [ ] `webview/karavan/features/project/designer/utils/CamelUi.tsx`
  - add `getOnExceptions(integration)` function

- [ ] `webview/karavan/features/project/designer/route/RouteDesigner.tsx`
  - `getGraph()`: render `OnExceptionDefinition` panels (before routes)
  - `getGraphButtons()`: add "Add onException" button

- [ ] `webview/karavan/features/project/designer/route/element/DslElement.tsx`
  - `isNotDraggable()`: add `OnExceptionDefinition`

- [ ] `webview/karavan/features/project/designer/route/element/DslElementHeader.tsx`
  - `isWide()`: add `OnExceptionDefinition`
  - `getHeaderClasses()`: add route-style header for `OnExceptionDefinition`

- [ ] `webview/karavan/features/project/designer/route/useRouteDesignerHook.tsx`
  - add `createOnException()` function
  - wire delete handler for top-level `OnExceptionDefinition`

## Notes

- `readOnExceptionDefinition` already exists in `CamelDefinitionYamlStep.ts` (lines 1779-1820)
  and handles all fields correctly — no changes needed there
- Serializer requires NO changes: an `OnExceptionDefinition` in `spec.flows` without `inArray`
  naturally produces `{ onException: {...} }` via the replacer's `else` branch
- `DslElement.getChildElements()` already filters `onWhen` from display for `OnExceptionDefinition`
- `CamelUi.getIconSrcForName()` already has an icon for `OnExceptionDefinition`
- Test files: `/home/vanovcan/repos/O2/BW5/bw5_helpers/claude_examples_mmd/*.camel.yaml`

## Build & Test

```bash
cd karavan-core && npm install --ignore-scripts
cd ../karavan-vscode && npm install && vsce package
# Install karavan-vscode/karavan-4.18.0.vsix via Extensions → Install from VSIX
```
