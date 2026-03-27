const Hapi = require('@hapi/hapi');
const Inert = require('@hapi/inert');
const fs = require('fs-extra');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const { v4: uuidv4 } = require('uuid');
const { Poppler } = require('node-poppler');

const UPLOADS_DIR = 'uploads';
const DATA_DIR = 'data';
const POPPLER_BIN_DIR = '/usr/bin/';
const STORAGE_MODE = (process.env.STORAGE_MODE || process.env.FILE_STORAGE_MODE || 'disk').toLowerCase();
const CONTAINER_MODE = ['1', 'true', 'yes', 'on'].includes((process.env.CONTAINER || '').trim().toLowerCase());
const MD_PATH_ENV = process.env.MD_PATH || '';

const TASK_HANDLERS = {
    pdf2text: PDFToText,
    pdf2images: PDFToImages,
    pdfimages: ImagesFromPDF,
    pdfinfo: PDFInfo,
    thumbnail: PDFThumbnail,
};

function resolveMdRoot(mdPathEnv, containerMode) {
    if (STORAGE_MODE === 'disk' && (typeof mdPathEnv !== 'string' || !mdPathEnv.trim())) {
        throw new Error('MD_PATH must be set when STORAGE_MODE=disk');
    }

    const candidates = [];

    if (typeof mdPathEnv === 'string' && mdPathEnv.trim()) {
        const raw = path.resolve(mdPathEnv.trim());
        if (path.basename(raw) === 'data') {
            candidates.push(path.dirname(raw));
        }
        candidates.push(raw);
    }

    if (containerMode) {
        candidates.push('/app');
    }

    candidates.push(path.resolve('.'));

    const seen = new Set();
    const existingDirs = [];
    for (const candidate of candidates) {
        if (seen.has(candidate)) {
            continue;
        }
        seen.add(candidate);

        if (fs.existsSync(path.join(candidate, 'data'))) {
            return candidate;
        }

        if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) {
            existingDirs.push(candidate);
        }
    }

    if (existingDirs.length > 0) {
        return existingDirs[0];
    }

    throw new Error(
        'Could not resolve MessyDesk data root. Set MD_PATH to MessyDesk root (contains data/).'
    );
}

function resolveMdPath(inputPath, mdRoot) {
    if (typeof inputPath !== 'string' || !inputPath.trim()) {
        throw new Error('Invalid file.path');
    }

    const root = path.resolve(mdRoot);
    const resolved = path.isAbsolute(inputPath)
        ? path.resolve(inputPath)
        : path.resolve(root, inputPath);

    if (!isPathInside(root, resolved)) {
        throw new Error('file.path is outside MD_PATH');
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

    // Multipart "message" arrives as a stream and must be parsed from file.
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

async function normalizeDiskFiles(uriEntries, mdRoot, sourcePath) {
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
                await fs.copy(absPath, targetPath);
            }

            files.push({
                path: callbackName,
                label,
                type,
                extension: extension || 'txt',
            });
    }

    return files;
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
    const mdRoot = resolveMdRoot(MD_PATH_ENV, CONTAINER_MODE);
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
            let requestFilePath = '';
            let contentFilePath = '';
            try {
                const data = request.payload;
                const payloadMessage = data?.message || data;
                const messageFromPayload = parseMessagePayload(payloadMessage);
                let message = messageFromPayload;
                const contentFile = data?.content;

                if (!message && payloadMessage?.pipe) {
                    requestFilePath = path.join(UPLOADS_DIR, `${uuidv4()}.json`);
                    await saveStreamToFile(payloadMessage, requestFilePath);
                    message = await parseMessageFile(requestFilePath);
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

                if (STORAGE_MODE === 'disk') {
                    const sourcePath = message?.file?.path;
                    if (!sourcePath) {
                        return h.response({ error: 'Disk mode requires message.file.path' }).code(400);
                    }

                    contentFilePath = resolveMdPath(sourcePath, mdRoot);
                    await fs.access(contentFilePath);
                } else {
                    if (!contentFile || !contentFile.pipe) {
                        return h.response({ error: 'Expected multipart fields: message and content' }).code(400);
                    }
                    contentFilePath = path.join(UPLOADS_DIR, `${uuidv4()}.pdf`);
                    await saveStreamToFile(contentFile, contentFilePath);
                }

                const target = createOutputTarget(STORAGE_MODE, contentFilePath, mdRoot, taskId);
                await fs.ensureDir(target.outputDir);

                const serviceOutput = await handler(contentFilePath, message.task.params, target.outputDir, target.responseBase);
                if (STORAGE_MODE === 'disk') {
                    output.response.type = 'disk';
                    output.response.files = await normalizeDiskFiles(serviceOutput, mdRoot, contentFilePath);
                } else {
                    output.response.type = target.responseType;
                    output.response.uri = serviceOutput;
                }
                output.response.storage_mode = STORAGE_MODE;

                if (STORAGE_MODE !== 'disk') {
                    await safeUnlink(contentFilePath);
                }
                await safeUnlink(requestFilePath);
            } catch (e) {
                console.error('Process failed:', e);
                try {
                    if (STORAGE_MODE !== 'disk') {
                        await safeUnlink(contentFilePath);
                    }
                    await safeUnlink(requestFilePath);
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
async function PDFToText(filepath, options, outputDir, responseBase) {
    options = options || {};
    options.firstPageToConvert = 1;
    options.lastPageToConvert = 1;
    cleanPageOptions(options);

    let textFile = 'text.txt';
    if (options.firstPageToConvert === options.lastPageToConvert) {
        textFile = `page_${String(options.firstPageToConvert).padStart(3, '0')}.txt`;
    } else {
        textFile = `page_${options.firstPageToConvert}-${options.lastPageToConvert}.txt`;
    }

    const poppler = new Poppler(POPPLER_BIN_DIR);
    await poppler.pdfToText(filepath, path.join(outputDir, textFile), options);

    return [path.posix.join(responseBase, textFile)];
}


async function PDFToImages(filepath, options, outputDir, responseBase) {
    options = options || {};
    options.pngFile = true;
    if (!options.cropBox) options.cropBox = true;
    options.firstPageToConvert = 1;
    options.lastPageToConvert = 1;
    cleanPageOptions(options);

    const poppler = new Poppler(POPPLER_BIN_DIR);
     await poppler.pdfToPpm(filepath, path.join(outputDir, 'page'), options);
     return getImageList(outputDir, responseBase);

 }


 async function ImagesFromPDF(filepath, options, outputDir, responseBase) {
    options = options || {};
    options.pngFile = true;
    options.firstPageToConvert = 1;
    options.lastPageToConvert = 1;
    cleanPageOptions(options);

    const poppler = new Poppler(POPPLER_BIN_DIR);
    await poppler.pdfImages(filepath, path.join(outputDir, 'page-1_image'), options);
    return getImageList(outputDir, responseBase);
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
};