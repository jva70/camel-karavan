import { describe, it, expect } from 'vitest';
import * as path from 'path';
import * as fsPromises from 'fs/promises';
import { buildXsdTree } from '../../xsdResolver';
import type { ReadFileFn } from '../../xsdResolver';

const FIXTURES = path.resolve(__dirname, '../fixtures/xsd');

const nodeReadFile: ReadFileFn = (absPath) =>
    fsPromises.readFile(absPath) as Promise<Buffer>;

// ─── Simple XSD ──────────────────────────────────────────────────────────────

describe('buildXsdTree — simple schema', () => {
    it('returns a root XsdNode with correct name and type', async () => {
        const { root, warnings } = await buildXsdTree(
            path.join(FIXTURES, 'simple/Order.xsd'),
            nodeReadFile
        );
        expect(warnings).toHaveLength(0);
        expect(root.name).toBe('Order');
        expect(root.type).toBe('element');
        expect(root.sourceFile).toContain('Order.xsd');
    });

    it('builds children for a nested sequence', async () => {
        const { root } = await buildXsdTree(
            path.join(FIXTURES, 'simple/Order.xsd'),
            nodeReadFile
        );
        const childNames = root.children.map((c) => c.name);
        expect(childNames).toContain('OrderId');
        expect(childNames).toContain('CustomerName');
        expect(childNames).toContain('TotalAmount');
        expect(childNames).toContain('Items');
    });

    it('assigns correct dot-separated paths', async () => {
        const { root } = await buildXsdTree(
            path.join(FIXTURES, 'simple/Order.xsd'),
            nodeReadFile
        );
        expect(root.path).toBe('Order');
        const orderId = root.children.find((c) => c.name === 'OrderId');
        expect(orderId?.path).toBe('Order.OrderId');
    });

    it('includes attribute node with @ prefix in path', async () => {
        const { root } = await buildXsdTree(
            path.join(FIXTURES, 'simple/Order.xsd'),
            nodeReadFile
        );
        const attrNode = root.children.find((c) => c.name === 'version');
        expect(attrNode?.type).toBe('attribute');
        expect(attrNode?.path).toBe('Order.@version');
    });

    it('builds nested children recursively', async () => {
        const { root } = await buildXsdTree(
            path.join(FIXTURES, 'simple/Order.xsd'),
            nodeReadFile
        );
        const items = root.children.find((c) => c.name === 'Items');
        expect(items).toBeDefined();
        const item = items?.children.find((c) => c.name === 'Item');
        expect(item).toBeDefined();
        const productCode = item?.children.find((c) => c.name === 'ProductCode');
        expect(productCode?.path).toBe('Order.Items.Item.ProductCode');
    });
});

// ─── Import Chain ─────────────────────────────────────────────────────────────

describe('buildXsdTree — xs:import chain', () => {
    it('includes elements from imported schema', async () => {
        const { root, warnings } = await buildXsdTree(
            path.join(FIXTURES, 'imported/Root.xsd'),
            nodeReadFile
        );
        expect(warnings).toHaveLength(0);
        expect(root.name).toBe('Customer');
        const childNames = root.children.map((c) => c.name);
        expect(childNames).toContain('CustomerId');
        expect(childNames).toContain('BillingAddress');
    });

    it('resolves type reference from imported schema (children of typed element)', async () => {
        const { root } = await buildXsdTree(
            path.join(FIXTURES, 'imported/Root.xsd'),
            nodeReadFile
        );
        const billing = root.children.find((c) => c.name === 'BillingAddress');
        expect(billing).toBeDefined();
        // AddressType has Street/City/PostalCode/Country children
        const childNames = billing?.children.map((c) => c.name) ?? [];
        expect(childNames).toContain('Street');
        expect(childNames).toContain('City');
    });
});

// ─── xs:include (groups) ──────────────────────────────────────────────────────

describe('buildXsdTree — xs:include + xs:group ref', () => {
    it('inlines group children at the use site', async () => {
        const { root, warnings } = await buildXsdTree(
            path.join(FIXTURES, 'groups/Schema.xsd'),
            nodeReadFile
        );
        expect(warnings.filter((w) => w.code !== 'XSD_UNSUPPORTED_REDEFINE')).toHaveLength(0);
        expect(root.name).toBe('Employee');
        const childNames = root.children.map((c) => c.name);
        // ContactDetails group should be inlined
        expect(childNames).toContain('Email');
        expect(childNames).toContain('Phone');
        // AuditFields group should be inlined
        expect(childNames).toContain('CreatedAt');
        expect(childNames).toContain('UpdatedAt');
    });

    it('sets correct paths for inlined group children', async () => {
        const { root } = await buildXsdTree(
            path.join(FIXTURES, 'groups/Schema.xsd'),
            nodeReadFile
        );
        const email = root.children.find((c) => c.name === 'Email');
        expect(email?.path).toBe('Employee.Email');
    });
});

// ─── Namespace prefix + element ref ───────────────────────────────────────────

describe('buildXsdTree — namespace ref resolution', () => {
    it('resolves ref="types:Product" from imported schema', async () => {
        const { root, warnings } = await buildXsdTree(
            path.join(FIXTURES, 'namespaces/Root.xsd'),
            nodeReadFile
        );
        expect(warnings).toHaveLength(0);
        expect(root.name).toBe('OrderLine');
        const childNames = root.children.map((c) => c.name);
        expect(childNames).toContain('LineId');
        expect(childNames).toContain('Product');
        expect(childNames).toContain('Quantity');
    });
});

// ─── Depth limit ──────────────────────────────────────────────────────────────

describe('buildXsdTree — import depth limit', () => {
    it('stops at depth 20 and emits XSD_IMPORT_DEPTH_LIMIT warning', async () => {
        const { warnings } = await buildXsdTree(
            path.join(FIXTURES, 'deep/Level1.xsd'),
            nodeReadFile
        );
        const depthWarning = warnings.find((w) => w.code === 'XSD_IMPORT_DEPTH_LIMIT');
        expect(depthWarning).toBeDefined();
        expect(depthWarning?.severity).toBe('error');
    });

    it('does not throw — returns result even when depth limit hit', async () => {
        await expect(
            buildXsdTree(path.join(FIXTURES, 'deep/Level1.xsd'), nodeReadFile)
        ).resolves.toBeDefined();
    });
});

// ─── Missing file ─────────────────────────────────────────────────────────────

describe('buildXsdTree — missing file', () => {
    it('returns XSD_FILE_NOT_FOUND warning without throwing', async () => {
        const { warnings } = await buildXsdTree(
            path.join(FIXTURES, 'does-not-exist.xsd'),
            nodeReadFile
        );
        const notFound = warnings.find((w) => w.code === 'XSD_FILE_NOT_FOUND');
        expect(notFound).toBeDefined();
        expect(notFound?.detail).toContain('does-not-exist.xsd');
    });

    it('does not propagate the exception to the caller', async () => {
        await expect(
            buildXsdTree(path.join(FIXTURES, 'does-not-exist.xsd'), nodeReadFile)
        ).resolves.toBeDefined();
    });
});

// ─── Malformed XML ────────────────────────────────────────────────────────────

describe('buildXsdTree — malformed XML', () => {
    it('returns XSD_PARSE_ERROR warning without throwing', async () => {
        const { warnings } = await buildXsdTree(
            path.join(FIXTURES, 'MalformedSchema.xsd'),
            nodeReadFile
        );
        const parseError = warnings.find((w) => w.code === 'XSD_PARSE_ERROR');
        expect(parseError).toBeDefined();
    });

    it('does not propagate the exception to the caller', async () => {
        await expect(
            buildXsdTree(path.join(FIXTURES, 'MalformedSchema.xsd'), nodeReadFile)
        ).resolves.toBeDefined();
    });
});

// ─── rawSource ───────────────────────────────────────────────────────────────

describe('buildXsdTree — rawSource', () => {
    it('returns the UTF-8 content of the primary XSD file', async () => {
        const xsdPath = path.join(FIXTURES, 'simple/Order.xsd');
        const { rawSource } = await buildXsdTree(xsdPath, nodeReadFile);
        const expected = (await fsPromises.readFile(xsdPath, 'utf8')).replace(/^﻿/, '');
        expect(rawSource).toBe(expected);
    });

    it('rawSource contains the xs:schema declaration', async () => {
        const { rawSource } = await buildXsdTree(
            path.join(FIXTURES, 'simple/Order.xsd'),
            nodeReadFile
        );
        expect(rawSource).toContain('xs:schema');
    });

    it('rawSource reflects the primary file only, not imported files', async () => {
        const primaryPath = path.join(FIXTURES, 'imported/Root.xsd');
        const { rawSource } = await buildXsdTree(primaryPath, nodeReadFile);
        const primaryContent = (await fsPromises.readFile(primaryPath, 'utf8')).replace(/^﻿/, '');
        expect(rawSource).toBe(primaryContent);
    });

    it('returns undefined rawSource when the primary file cannot be read', async () => {
        const { rawSource } = await buildXsdTree(
            '/nonexistent/path/Missing.xsd',
            nodeReadFile
        );
        expect(rawSource).toBeUndefined();
    });
});

describe('buildXsdTree — import-only wrapper (P17)', () => {
    const wrapper = `${FIXTURES}/import-only/Wrapper.xsd`;

    it('returns a non-empty tree for a schema with no own elements that only imports', async () => {
        const { root } = await buildXsdTree(wrapper, nodeReadFile);
        expect(root).toBeDefined();
    });

    it('surfaces the Address element from the imported schema', async () => {
        const { root } = await buildXsdTree(wrapper, nodeReadFile);
        // When the import chain yields exactly one element, root IS that element.
        // When it yields multiple elements, root is a wrapper whose children are those elements.
        const topLevelNames = root.children && root.name === 'Wrapper'
            ? root.children.map((c) => c.name)
            : [root.name];
        expect(topLevelNames).toContain('Address');
    });

    it('emits no warnings for a valid import-only schema', async () => {
        const { warnings } = await buildXsdTree(wrapper, nodeReadFile);
        expect(warnings).toHaveLength(0);
    });
});
