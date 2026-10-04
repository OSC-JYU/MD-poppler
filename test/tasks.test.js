// The user tasks through /process in HTTP mode, with the real poppler tools. They need
// poppler-utils, so they run in the service image (make test) and are skipped elsewhere.

const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('child_process');
const fs = require('fs-extra');
const path = require('path');

process.env.STORAGE_MODE = 'http';
const { createServer, resolutionParam } = require('../index');
const service = require('../service.json');

let hasPoppler = true;
try {
    execFileSync('pdfinfo', ['-v'], { stdio: 'ignore' });
} catch {
    hasPoppler = false;
}
const tools = { skip: hasPoppler ? false : 'poppler-utils is not installed (run make test)' };
const sample = path.join(__dirname, 'sample.pdf');

function multipart(task, params = {}) {
    const boundary = '----popplertest';
    const message = JSON.stringify({ task: { id: task, params }, file: { '@rid': '#80:1', label: 'page_012.pdf' } });
    const payload = Buffer.concat([
        Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="message"; filename="message.json"\r\nContent-Type: application/json\r\n\r\n${message}\r\n`),
        Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="content"; filename="page.pdf"\r\nContent-Type: application/pdf\r\n\r\n`),
        fs.readFileSync(sample),
        Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    return { method: 'POST', url: '/process', headers: { 'content-type': `multipart/form-data; boundary=${boundary}` }, payload };
}

async function run(task, params) {
    const server = await createServer();
    try {
        const response = await server.inject(multipart(task, params));
        assert.equal(response.statusCode, 200, response.payload);
        const outputs = JSON.parse(response.payload).response.uri;
        const files = [];
        for (const output of outputs) {
            const fetched = await server.inject({ method: 'GET', url: output.uri || output });
            assert.equal(fetched.statusCode, 200);
            files.push({ output, body: fetched.rawPayload });
        }
        return files;
    } finally {
        await server.stop();
    }
}

test('the descriptor offers the user tasks without page ranges, and hides thumbnail', () => {
    const offered = Object.entries(service.tasks).filter(([, t]) => t.filter !== 'internal').map(([id]) => id);
    assert.deepEqual(offered.sort(), ['pdf2images', 'pdf2text', 'pdfimages', 'pdfinfo']);
    assert.equal(service.id, 'md-poppler');
    for (const task of Object.values(service.tasks)) {
        assert.ok(!JSON.stringify(task).includes('PageToConvert'));
    }
});

test('resolution is clamped to 72-600 dpi', () => {
    assert.equal(resolutionParam({}), 150);
    assert.equal(resolutionParam({ resolution: '300' }), 300);
    assert.equal(resolutionParam({ resolution: 5000 }), 600);
    assert.equal(resolutionParam({ resolution: 10 }), 72);
});

test('pdfinfo gives the document information as text', tools, async () => {
    const [{ output, body }] = await run('pdfinfo');
    assert.deepEqual([output.label, output.type, output.extension], ['page_012.pdfinfo.txt', 'text', 'txt']);
    assert.match(body.toString(), /Pages:\s+\d+/);
    assert.match(body.toString(), /PDF version:/);
});

test('pdf2text ignores unknown params instead of passing them to poppler', tools, async () => {
    const [{ output }] = await run('pdf2text', { task: 'pdf2text', firstPageToConvert: 3, bogus: true });
    assert.equal(output.label, 'page_012.txt');
});

test('pdf2images renders at the asked resolution', tools, async () => {
    const low = await run('pdf2images', { resolution: 72 });
    const high = await run('pdf2images', { resolution: 144 });
    assert.equal(low.length, 1);
    const width = (png) => png.readUInt32BE(16);
    assert.ok(Math.abs(width(high[0].body) - 2 * width(low[0].body)) <= 2);
});
