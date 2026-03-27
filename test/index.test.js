const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs-extra');
const path = require('path');

process.env.MD_PATH = process.env.MD_PATH || path.resolve(__dirname, '..');

const {
    createServer,
    cleanPageOptions,
    safeUnlink,
    parseMessageFile,
    parseMessagePayload,
    resolveMdPath,
    getDbNameFromAnyPath,
    isPathInside,
} = require('../index');

test('cleanPageOptions normalizes numeric resolution values', () => {
    const options = {
        resolutionXAxis: '300',
        resolutionYAxis: 'bad',
        resolutionXYAxis: '200',
    };

    cleanPageOptions(options);

    assert.equal(options.resolutionXAxis, 300);
    assert.equal(options.resolutionYAxis, 150);
    assert.equal(options.resolutionXYAxis, 200);
});

test('safeUnlink does not throw for missing files', async () => {
    const missingPath = path.join('uploads', 'missing-file-does-not-exist.tmp');
    await assert.doesNotReject(() => safeUnlink(missingPath));
});

test('parseMessageFile parses object JSON payload', async () => {
    const tempFile = path.join('uploads', `test-message-${Date.now()}.json`);
    const payload = { task: { id: 'pdf2text', params: {} } };

    await fs.ensureDir(path.dirname(tempFile));
    await fs.writeJSON(tempFile, payload);

    const parsed = await parseMessageFile(tempFile);
    assert.deepEqual(parsed, payload);

    await safeUnlink(tempFile);
});

test('isPathInside prevents traversal outside data directory', () => {
    const okPath = path.join('data', 'a', 'result.txt');
    const badPath = path.join('data', '..', 'etc', 'passwd');

    assert.equal(isPathInside('data', okPath), true);
    assert.equal(isPathInside('data', badPath), false);
});

test('POST /process returns 400 for empty JSON payload', async () => {
    const server = await createServer();

    const response = await server.inject({
        method: 'POST',
        url: '/process',
        headers: {
            'content-type': 'application/json',
        },
        payload: JSON.stringify({}),
    });

    assert.equal(response.statusCode, 400);
    const body = JSON.parse(response.payload);
    assert.match(body.error, /missing task\.id/i);

    await server.stop();
});

test('POST /process returns 400 when multipart fields are missing', async () => {
    const server = await createServer();
    const boundary = '----testboundary';
    const response = await server.inject({
        method: 'POST',
        url: '/process',
        headers: {
            'content-type': `multipart/form-data; boundary=${boundary}`,
        },
        payload: `--${boundary}--\r\n`,
    });

    assert.equal(response.statusCode, 400);
    const body = JSON.parse(response.payload);
    assert.match(body.error, /missing task\.id/i);

    await server.stop();
});

test('parseMessagePayload parses JSON string payloads', () => {
    const payload = parseMessagePayload('{"task":{"id":"pdf2text"}}');
    assert.equal(payload.task.id, 'pdf2text');
});

test('parseMessagePayload returns null for stream-like payloads', () => {
    const payload = parseMessagePayload({ pipe: () => {} });
    assert.equal(payload, null);
});

test('getDbNameFromAnyPath extracts db from data path', () => {
    const dbName = getDbNameFromAnyPath('data/projectA/files/a.pdf');
    assert.equal(dbName, 'projectA');
});

test('resolveMdPath rejects traversal outside root', () => {
    const mdRoot = path.resolve('.');
    assert.throws(() => resolveMdPath('../etc/passwd', mdRoot), /outside MD_PATH/i);
});
