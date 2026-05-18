// Minimal VS Code API mock for Vitest unit tests running in Node.js context
import * as fsPromises from 'fs/promises';

export const workspace = {
    fs: {
        readFile: async (uri: { fsPath: string }): Promise<Uint8Array> => {
            const buf = await fsPromises.readFile(uri.fsPath);
            return new Uint8Array(buf);
        },
    },
};

export const Uri = {
    file: (fsPath: string) => ({ fsPath }),
};

export const window = {
    showErrorMessage: (_msg: string) => undefined,
    showOpenDialog: async () => undefined,
};
