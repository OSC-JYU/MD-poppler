const Hapi = require('@hapi/hapi');
const Inert = require('@hapi/inert');
const fs = require('fs-extra');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const { v4: uuidv4 } = require('uuid');
const { Poppler } = require('node-poppler');
const tar = require('tar');

const UPLOADS_DIR = 'uploads';
const DATA_DIR = 'data';
const POPPLER_BIN_DIR = '/usr/bin/';
// 'http' forces HTTP mode; otherwise disk mode is used when MD_PATH has a data/ directory
const STORAGE_MODE_ENV = (process.env.STORAGE_MODE || process.env.FILE_STORAGE_MODE || '').trim().toLowerCase();
const MD_PATH_ENV = process.env.MD_PATH || '';
const SERVICE_DESCRIPTOR_PATH = path.resolve(process.env.SERVICE_DESCRIPTOR_PATH || path.join(__dirname, 'service.json'));
const SERVICE_HELP_PATH = path.resolve(process.env.SERVICE_HELP_PATH || path.join(__dirname, 'help', 'index.md'));
const SERVICE_HELP_FALLBACK_PATH = path.resolve(process.env.SERVICE_HELP_FALLBACK_PATH || path.join(__dirname, 'index.md'));
const SERVICE_HELP_FALLBACK_PATH_2 = path.resolve(process.env.SERVICE_HELP_FALLBACK_PATH_2 || path.join(__dirname, 'README.md'));
const SERVICE_HELP_DIR = path.resolve(process.env.SERVICE_HELP_DIR || path.dirname(SERVICE_HELP_PATH));
const SERVICE_HELP_RESPONSE_FORMAT = String(process.env.SERVICE_HELP_RESPONSE_FORMAT || '').trim().toLowerCase();

const TASK_HANDLERS = {
    pdf2text: PDFToText,
    pdf2images: PDFToImages,
    pdfimages: ImagesFromPDF,
    pdfinfo: PDFInfo,
    thumbnail: PDFThumbnail,
};

function getPdfBaseLabel(message, fallbackPath) {
    const fromMessage = String(
        message?.file?.label
        || message?.file?.original_filename
        || ''
    ).trim();
    const fallbackName = path.basename(String(fallbackPath || '')).trim();
    const raw = fromMessage || fallbackName || 'page';
    const ext = path.extname(raw);
    return ext ? raw.slice(0, -ext.length) : raw;
}

// Only labels that look like split pages ("page_001", "report_page_3") carry a page number;
// any other trailing number ("Vuosikertomus 1998") is part of the name.
function inferPageNumberFromLabel(label) {
    const base = path.basename(String(label || ''), path.extname(String(label || '')));
    const match = base.match(/(?:^|[_\-\s])page[_\-\s]?(\d+)$/i);
    if (!match) {
        return null;
    }

    const parsed = Number.parseInt(match[1], 10);
    if (!Number.isFinite(parsed) || parsed <= 0) {
        return null;
    }

    return parsed;
}

function applyServiceDescriptorOverrides(descriptor) {
    const overrides = {
        id: process.env.SERVICE_ID,
        name: process.env.SERVICE_NAME,
        adapter: process.env.SERVICE_ADAPTER,
        local_url: process.env.SERVICE_LOCAL_URL,
    };

    for (const [key, value] of Object.entries(overrides)) {
        if (typeof value === 'string' && value.trim()) {
            descriptor[key] = value.trim();
        }
    }

    return descriptor;
}

async function loadServiceDescriptor() {
    try {
        const descriptor = await fs.readJson(SERVICE_DESCRIPTOR_PATH);
        if (!descriptor || typeof descriptor !== 'object' || Array.isArray(descriptor)) {
            throw new Error('Descriptor root must be a JSON object');
        }
        return applyServiceDescriptorOverrides(descriptor);
    } catch (error) {
        throw new Error(`Could not load service descriptor: ${error.message}`);
    }
}

async function loadHelpMarkdown() {
    const candidates = [SERVICE_HELP_PATH, SERVICE_HELP_FALLBACK_PATH, SERVICE_HELP_FALLBACK_PATH_2];
    for (const candidate of candidates) {
        if (await fs.pathExists(candidate)) {
            return fs.readFile(candidate, 'utf8');
        }
    }
    throw new Error('Help markdown file not found');
}

function streamToBuffer(stream) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        stream.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
        stream.on('error', reject);
        stream.on('end', () => resolve(Buffer.concat(chunks)));
    });
}

function wantsHelpArchive(request) {
    const queryFormat = String(request?.query?.format || '').trim().toLowerCase();
    if (['tar', 'tgz', 'archive', 'bundle'].includes(queryFormat)) {
        return true;
    }

    if (SERVICE_HELP_RESPONSE_FORMAT === 'tar' || SERVICE_HELP_RESPONSE_FORMAT === 'tgz' || SERVICE_HELP_RESPONSE_FORMAT === 'archive') {
        return true;
    }

    const accept = String(request?.headers?.accept || '').toLowerCase();
    if (accept.includes('application/x-tar') || accept.includes('application/gzip') || accept.includes('application/x-gzip')) {
        return true;
    }

    return false;
}

async function createHelpArchiveBuffer() {
    if (!(await fs.pathExists(SERVICE_HELP_DIR))) {
        throw new Error('Help directory not found');
    }

    const stream = tar.c({
        cwd: SERVICE_HELP_DIR,
        gzip: true,
        portable: true,
    }, ['.']);

    return streamToBuffer(stream);
}

function resolveHelpFilePath(assetPath) {
    const raw = String(assetPath || '').replace(/^\/+/, '');
    if (!raw) {
        throw new Error('Missing help asset path');
    }

    const helpDir = path.resolve(SERVICE_HELP_DIR);
    const resolved = path.resolve(path.join(helpDir, raw));
    if (resolved !== helpDir && !resolved.startsWith(helpDir + path.sep)) {
        throw new Error('Help asset path is outside allowed directory');
    }
    return resolved;
}

// MessyDesk root (the directory that contains data/) for disk mode, or null for HTTP mode:
// STORAGE_MODE=http, MD_PATH unset, or MD_PATH without data/.
function resolveMdRoot(mdPathEnv, storageModeEnv = STORAGE_MODE_ENV) {
    if (storageModeEnv === 'http') {
        return null;
    }
    const raw = typeof mdPathEnv === 'string' ? mdPathEnv.trim() : '';
    if (!raw) {
        return null;
    }
    let root = path.resolve(raw);
    if (path.basename(root) === 'data') {
        root = path.dirname(root);
    }
    const dataDir = path.join(root, 'data');
    if (fs.existsSync(dataDir) && fs.statSync(dataDir).isDirectory()) {
        return root;
    }
    console.warn(`MD_PATH=${raw} has no data/ directory, using HTTP mode`);
    return null;
}

function resolveMdPath(inputPath, mdRoot) {
    if (typeof inputPath !== 'string' || !inputPath.trim()) {
        throw new Error('Invalid file.path');
    }

    const normalizedInput = inputPath.replace(/\\/g, '/');
    const parts = normalizedInput.split('/').filter(Boolean);
    if (parts.includes('..')) {
        throw new Error('file.path is outside MD_PATH');
    }

    const root = path.resolve(mdRoot);
    const dataRoot = path.resolve(root, 'data');
    const resolved = path.isAbsolute(inputPath)
        ? path.resolve(inputPath)
        : path.resolve(root, inputPath);

    if (!isPathInside(root, resolved)) {
        throw new Error('file.path is outside MD_PATH');
    }

    if (!isPathInside(dataRoot, resolved)) {
        throw new Error('file.path must resolve under MD_PATH/data');
    }

    return resolved;
}

function getDbNameFromAnyPath(filePath) {
    if (typeof filePath !== 'string') {
        return process.env.DB_NAME || 'messydesk';
    }

    const normalized = filePath.replace(/\\/g, '/');
    const parts = normalized.split('/').filter(Boolean);
    for (let i = 0; i < parts.length - 1; i += 1) {
        if (parts[i] === 'data' && parts[i + 1]) {
            return parts[i + 1];
        }
    }

    return process.env.DB_NAME || 'messydesk';
}

function parseMessagePayload(payloadMessage) {
    if (!payloadMessage) {
        return null;
    }

    // Multipart "message" arrives as a stream and is parsed separately from memory.
    if (typeof payloadMessage?.pipe === 'function') {
        return null;
    }

    if (typeof payloadMessage === 'string') {
        return JSON.parse(payloadMessage);
    }

    if (Buffer.isBuffer(payloadMessage)) {
        return JSON.parse(payloadMessage.toString('utf8'));
    }

    if (typeof payloadMessage === 'object') {
        return payloadMessage;
    }

    return null;
}

async function parseMessageStream(payloadMessage) {
    if (!payloadMessage || typeof payloadMessage.pipe !== 'function') {
        return null;
    }

    const buffer = await streamToBuffer(payloadMessage);
    if (!buffer || buffer.length === 0) {
        return null;
    }

    return JSON.parse(buffer.toString('utf8'));
}

function toPosixPath(inputPath) {
    return inputPath.split(path.sep).join(path.posix.sep);
}

function inferOutputType(extension) {
    const ext = String(extension || '').toLowerCase();
    if (['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp', 'tiff'].includes(ext)) return 'image';
    if (ext === 'csv') return 'csv';
    if (ext === 'json') return 'json';
    if (ext === 'pdf') return 'pdf';
    return 'text';
}

async function normalizeDiskFiles(uriEntries, mdRoot, sourcePath, moveFiles) {
    if (!Array.isArray(uriEntries)) {
        return [];
    }

    const dbName = getDbNameFromAnyPath(sourcePath);
    const tmpRoot = path.join(mdRoot, 'data', dbName, 'tmp');
    await fs.ensureDir(tmpRoot);

    const files = [];
    for (const item of uriEntries) {
            const uri = typeof item === 'string' ? item : item?.uri;
            if (typeof uri !== 'string' || !uri) {
                continue;
            }

            const absPath = path.isAbsolute(uri) ? uri : path.resolve(mdRoot, uri);
            if (!await fs.pathExists(absPath)) {
                continue;
            }

            const label = item?.label || path.basename(absPath);
            const extension = (item?.extension || path.extname(label).replace('.', '') || path.extname(absPath).replace('.', '')).toLowerCase();
            const type = item?.type || inferOutputType(extension);

            let callbackName = path.basename(absPath);
            let targetPath = path.join(tmpRoot, callbackName);

            if (path.resolve(absPath) !== path.resolve(targetPath)) {
                if (await fs.pathExists(targetPath)) {
                    callbackName = `poppler_${uuidv4()}_${path.basename(absPath)}`;
                    targetPath = path.join(tmpRoot, callbackName);
                }
                if (moveFiles) {
                    await fs.move(absPath, targetPath);
                } else {
                    await fs.copy(absPath, targetPath);
                }
            }

            const normalizedFile = {
                path: callbackName,
                label,
                type,
                extension: extension || 'txt',
            };

            if (Number.isFinite(Number(item?.page_number))) {
                normalizedFile.page_number = Number(item.page_number);
            }

            files.push(normalizedFile);
    }

    return files;
}

async function removeJobFolder(target) {
    if (target?.responseType === 'tmp') {
        await fs.remove(target.outputDir);
    } else if (target?.responseType === 'stored' && await fs.pathExists(target.outputDir)
        && (await fs.readdir(target.outputDir)).length === 0) {
        // nothing to download (e.g. pdfimages on a page without images); the dir would stay for good
        await fs.rmdir(target.outputDir);
    }
}

function createOutputTarget(storageMode, sourcePath, mdRoot, taskId) {
    if (storageMode === 'disk' && taskId === 'thumbnail') {
        const outputDir = path.dirname(sourcePath);
        const responseBase = toPosixPath(path.relative(mdRoot, outputDir));
        return { outputDir, responseBase, responseType: 'direct' };
    }

    if (storageMode === 'disk') {
        const dbName = getDbNameFromAnyPath(sourcePath);
        const jobId = `poppler_${uuidv4()}`;
        const outputDir = path.join(mdRoot, 'data', dbName, 'tmp', jobId);
        const responseBase = path.posix.join('data', dbName, 'tmp', jobId);
        return { outputDir, responseBase, responseType: 'tmp' };
    }

    const dirname = uuidv4();
    const outputDir = path.join(DATA_DIR, dirname);
    const responseBase = path.posix.join('/files', dirname);
    return { outputDir, responseBase, responseType: 'stored' };
}

const createServer = async () => {
    const mdRoot = resolveMdRoot(MD_PATH_ENV);
    const storageMode = mdRoot ? 'disk' : 'http';
    console.log(`storage mode: ${mdRoot ? `disk (MD_PATH=${mdRoot})` : 'http'}`);
    const server = Hapi.server({
        port: process.env.PORT || 8300,
        host: '0.0.0.0',
        routes: {
             json: {
                space: 2 // Indents JSON output for readability
             }
        }
    });

    await server.register(Inert);

    server.route({
        method: 'GET',
        path: '/',
        handler: (request, h) => {
            return 'md-poppler API';
        }
    });

    server.route({
        method: 'GET',
        path: '/health',
        handler: () => ({ status: 'ok', service: process.env.SERVICE_ID || 'md-poppler_fs' }),
    });

    server.route({
        method: 'GET',
        path: '/config',
        handler: async (request, h) => {
            try {
                const descriptor = await loadServiceDescriptor();
                // the consumer adapter that matches the storage mode, unless SERVICE_ADAPTER says otherwise:
                // elg_fs in disk mode, the dedicated poppler adapter (uploads, thumbnails) in HTTP mode
                if (!process.env.SERVICE_ADAPTER?.trim()) {
                    descriptor.adapter = storageMode === 'disk' ? 'elg_fs' : 'poppler';
                }
                return h.response(descriptor).code(200);
            } catch (error) {
                return h.response({ error: error.message }).code(500);
            }
        },
    });

    server.route({
        method: 'GET',
        path: '/help',
        handler: async (request, h) => {
            try {
                if (wantsHelpArchive(request)) {
                    const archiveBuffer = await createHelpArchiveBuffer();
                    return h
                        .response(archiveBuffer)
                        .type('application/gzip')
                        .header('Content-Disposition', 'inline; filename="help-bundle.tar.gz"')
                        .code(200);
                }

                const markdown = await loadHelpMarkdown();
                return h.response(markdown).type('text/markdown; charset=utf-8').code(200);
            } catch (error) {
                return h.response({ error: error.message }).code(404);
            }
        },
    });

    server.route({
        method: 'GET',
        path: '/help/files/{assetPath*}',
        handler: async (request, h) => {
            try {
                const target = resolveHelpFilePath(request.params.assetPath);
                if (!(await fs.pathExists(target))) {
                    return h.response({ error: 'Help asset not found' }).code(404);
                }
                return h.file(target);
            } catch (error) {
                return h.response({ error: error.message }).code(400);
            }
        },
    });


    server.route({
        method: 'POST',
        path: '/process',
        options: {
            payload: {
                output: 'stream',
                parse: true,
                allow: ['multipart/form-data', 'application/json'],
                multipart: true,
                maxBytes: 500 * 1024 * 1024,
            }
        },
        handler: async (request, h) => {
            const output = { response: { type: 'stored', uri: [] } };
            let contentFilePath = '';
            let target = null;
            let requestMode = storageMode;
            try {
                const data = request.payload;
                const payloadMessage = data?.message || data;
                const messageFromPayload = parseMessagePayload(payloadMessage);
                let message = messageFromPayload;
                const contentFile = data?.content;

                if (!message && payloadMessage?.pipe) {
                    message = await parseMessageStream(payloadMessage);
                }

                if (!message) {
                    return h.response({ error: 'Invalid request payload: missing message object' }).code(400);
                }

                if (!message?.task?.id) {
                    return h.response({ error: 'Invalid message payload: missing task.id' }).code(400);
                }

                const taskId = message.task.id;
                const handler = TASK_HANDLERS[taskId];
                if (!handler) {
                    return h.response({ error: `Unsupported task: ${taskId}` }).code(400);
                }

                // a request that uploads the PDF is handled in HTTP mode even when disk mode is available
                requestMode = contentFile?.pipe ? 'http' : storageMode;
                if (requestMode === 'disk') {
                    const sourcePath = message?.file?.path;
                    if (!sourcePath) {
                        return h.response({ error: 'Disk mode requires message.file.path' }).code(400);
                    }

                    contentFilePath = resolveMdPath(sourcePath, mdRoot);
                    await fs.access(contentFilePath);
                } else {
                    if (!contentFile || !contentFile.pipe) {
                        return h.response({ error: "Expected multipart fields: message and content (disk mode is off, MD_PATH not found)" }).code(400);
                    }
                    contentFilePath = path.join(UPLOADS_DIR, `${uuidv4()}.pdf`);
                    await saveStreamToFile(contentFile, contentFilePath);
                }

                target = createOutputTarget(requestMode, contentFilePath, mdRoot, taskId);
                await fs.ensureDir(target.outputDir);

                const serviceOutput = await handler(contentFilePath, message.task.params, target.outputDir, target.responseBase, message);
                if (requestMode === 'disk') {
                    output.response.type = 'disk';
                    // Job folder outputs are moved to tmp/ and the folder removed; thumbnails are
                    // written next to the source, so those are copied and left in place.
                    output.response.files = await normalizeDiskFiles(serviceOutput, mdRoot, contentFilePath, target.responseType === 'tmp');
                } else {
                    output.response.type = target.responseType;
                    output.response.uri = serviceOutput;
                }
                output.response.storage_mode = requestMode;

                if (requestMode !== 'disk') {
                    await safeUnlink(contentFilePath);
                }
                await removeJobFolder(target);
            } catch (e) {
                console.error('Process failed:', e);
                try {
                    if (requestMode !== 'disk') {
                        await safeUnlink(contentFilePath);
                    }
                    await removeJobFolder(target);
                } catch (err) {
                    console.error('Error removing temp files:', err);
                }
                return h.response({ error: e.message }).code(500);
            }
            return h.response(output).code(200);
        }
    });


    // route for downloading output files
    server.route({
        method: 'GET',
        path: '/files/{dir}/{file}',
        handler: async (request, h) => {
            const filePath = path.normalize(path.join(DATA_DIR, request.params.dir, request.params.file));

            if (!isPathInside(DATA_DIR, filePath)) {
                return h.response('Invalid file path').code(400);
            }
    
            try {
                await fs.access(filePath);
    
                const response = h.file(filePath)
                    .header('Content-Disposition', `attachment; filename=${request.params.file}`);
    
                response.events.on('finish', async () => {
                    try {
                        await fs.unlink(filePath);
                        console.log(`Deleted file: ${filePath}`);
                        // the job dir goes with its last file
                        const jobDir = path.dirname(filePath);
                        if ((await fs.readdir(jobDir)).length === 0) await fs.rmdir(jobDir);
                    } catch (err) {
                        console.error(`Error deleting file: ${err.message}`);
                    }
                });
    
                return response;
            } catch (err) {
                return h.response('File not found').code(404);
            }
        }
    });
    

    return server;
};

const init = async () => {
    const server = await createServer();
    await server.start();
    console.log(`Server running on ${server.info.uri}`);
    return server;
};

if (require.main === module) {
    init().catch((err) => {
        console.error(err);
        process.exit(1);
    });
}


// api-poppler calls this normally so that first and last pages are the same (not zero)
async function PDFToText(filepath, options, outputDir, responseBase, message) {
    options = options || {};
    options.firstPageToConvert = 1;
    options.lastPageToConvert = 1;
    cleanPageOptions(options);

    const sourceBaseLabel = getPdfBaseLabel(message, filepath);
    const textFile = `${sourceBaseLabel}.txt`;
    const knownPageNumber = Number(message?.file?.page_number);
    const pageNumber = Number.isFinite(knownPageNumber) && knownPageNumber > 0
        ? knownPageNumber
        : inferPageNumberFromLabel(sourceBaseLabel);

    const poppler = new Poppler(POPPLER_BIN_DIR);
    await poppler.pdfToText(filepath, path.join(outputDir, textFile), options);

    const output = {
        uri: path.posix.join(responseBase, textFile),
        label: textFile,
        extension: 'txt',
        type: 'text',
    };
    if (pageNumber !== null) {
        output.page_number = pageNumber;
    }

    return [output];
}


async function PDFToImages(filepath, options, outputDir, responseBase, message) {
    options = options || {};
    options.pngFile = true;
    if (!options.cropBox) options.cropBox = true;
    options.firstPageToConvert = 1;
    options.lastPageToConvert = 1;
    cleanPageOptions(options);

    const poppler = new Poppler(POPPLER_BIN_DIR);
     await poppler.pdfToPpm(filepath, path.join(outputDir, 'page'), options);
     // pdftoppm names the output page-1.png; label it after the source file instead
     return labelImages(await getImageList(outputDir, responseBase), 'page', getPdfBaseLabel(message, filepath));

 }


 async function ImagesFromPDF(filepath, options, outputDir, responseBase, message) {
    options = options || {};
    options.pngFile = true;
    options.firstPageToConvert = 1;
    options.lastPageToConvert = 1;
    cleanPageOptions(options);

    const poppler = new Poppler(POPPLER_BIN_DIR);
    await poppler.pdfImages(filepath, path.join(outputDir, 'page-1_image'), options);
    return labelImages(await getImageList(outputDir, responseBase), 'page-1', getPdfBaseLabel(message, filepath));
 }

async function PDFInfo(filepath, options, outputDir, responseBase) {
    const poppler = new Poppler(POPPLER_BIN_DIR);
    const result = await poppler.pdfInfo(filepath, options || {});

    const infoFile = path.join(outputDir, 'pdfinfo.txt');
    await fs.writeFile(infoFile, result);
    return [path.posix.join(responseBase, 'pdfinfo.txt')];
}

async function renderFirstPageJpeg(filepath, targetPath, resolutionXYAxis) {
    const poppler = new Poppler(POPPLER_BIN_DIR);
    const tempBase = path.join(path.dirname(targetPath), `_tmp_${uuidv4()}`);
    const options = {
        jpegFile: true,
        singleFile: true,
        firstPageToConvert: 1,
        lastPageToConvert: 1,
        resolutionXYAxis,
    };

    cleanPageOptions(options);
    await poppler.pdfToPpm(filepath, tempBase, options);

    const candidates = [
        `${tempBase}.jpg`,
        `${tempBase}.jpeg`,
        `${tempBase}-1.jpg`,
        `${tempBase}-1.jpeg`,
    ];

    let generatedPath = null;
    for (const candidate of candidates) {
        // eslint-disable-next-line no-await-in-loop
        if (await fs.pathExists(candidate)) {
            generatedPath = candidate;
            break;
        }
    }

    if (!generatedPath) {
        throw new Error('Thumbnail generation failed: jpeg output not found');
    }

    await fs.move(generatedPath, targetPath, { overwrite: true });
}

async function PDFThumbnail(filepath, options, outputDir, responseBase) {
    options = options || {};
    const previewResolution = parseInt(options.previewResolution || options.preview_resolution || 150, 10) || 150;
    const thumbnailResolution = parseInt(options.thumbnailResolution || options.thumbnail_resolution || 80, 10) || 80;

    const previewFile = path.join(outputDir, 'preview.jpg');
    const thumbnailFile = path.join(outputDir, 'thumbnail.jpg');

    await renderFirstPageJpeg(filepath, previewFile, previewResolution);
    await renderFirstPageJpeg(filepath, thumbnailFile, thumbnailResolution);

    return [
        {
            uri: path.posix.join(responseBase, 'preview.jpg'),
            label: 'preview',
            thumb_name: 'preview.jpg',
        },
        {
            uri: path.posix.join(responseBase, 'thumbnail.jpg'),
            label: 'thumbnail',
            thumb_name: 'thumbnail.jpg',
        },
    ];
}



async function getImageList(input_path, fullpath, filter) {
    if (!filter) filter = ['.png', '.jpg', '.jpeg', '.tiff'];
    const files = await fs.readdir(input_path, { withFileTypes: true });
    return files
        .filter((dirent) => dirent.isFile())
        .map((dirent) => dirent.name)
        .filter((file) => filter.includes(path.extname(file).toLowerCase()))
        .map((name) => path.posix.join(fullpath, name));
}

// Turn uris into output entries whose label starts with the source name instead of the poppler
// file prefix: page-1.png -> <source>.png, page-1_image-000.png -> <source>_image-000.png.
function labelImages(uris, prefix, baseLabel) {
    return uris.map((uri) => {
        const name = path.posix.basename(uri);
        const ext = path.extname(name);
        let rest = name.startsWith(prefix) ? name.slice(prefix.length) : `_${name}`;
        if (uris.length === 1 && /^-\d+$/.test(path.basename(rest, ext))) {
            rest = ext;
        }
        return {
            uri,
            label: `${baseLabel}${rest}`,
            type: 'image',
            extension: ext.replace('.', '').toLowerCase(),
        };
    });
}

function cleanPageOptions(options) {

    if (options.resolutionXAxis) {
        options.resolutionXAxis = parseInt(options.resolutionXAxis, 10) || 150;
    }
    if (options.resolutionYAxis) {
        options.resolutionYAxis = parseInt(options.resolutionYAxis, 10) || 150;
    }
    if (options.resolutionXYAxis) {
        options.resolutionXYAxis = parseInt(options.resolutionXYAxis, 10) || 150;
    }
}

async function saveStreamToFile(inputStream, outputPath) {
    await fs.ensureDir(path.dirname(outputPath));
    const outputStream = fs.createWriteStream(outputPath);

    return new Promise((resolve, reject) => {
        inputStream.on('error', reject);
        outputStream.on('error', reject);
        outputStream.on('finish', resolve);
        inputStream.pipe(outputStream);
    });
}

async function parseMessageFile(filePath) {
    const parsed = await fs.readJSON(filePath, 'utf-8');
    if (typeof parsed === 'string') {
        return JSON.parse(parsed);
    }
    return parsed;
}

async function safeUnlink(filePath) {
    if (!filePath) return;
    try {
        await fs.unlink(filePath);
    } catch (err) {
        if (err.code !== 'ENOENT') {
            throw err;
        }
    }
}

function isPathInside(baseDir, targetPath) {
    const base = path.resolve(baseDir);
    const target = path.resolve(targetPath);
    return target === base || target.startsWith(`${base}${path.sep}`);
}

module.exports = {
    createServer,
    init,
    resolveMdRoot,
    resolveMdPath,
    getDbNameFromAnyPath,
    parseMessagePayload,
    cleanPageOptions,
    safeUnlink,
    parseMessageFile,
    isPathInside,
    getPdfBaseLabel,
    inferPageNumberFromLabel,
};