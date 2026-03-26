const Hapi = require('@hapi/hapi');
const Inert = require('@hapi/inert');
const fs = require('fs-extra');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { Poppler } = require('node-poppler');

const UPLOADS_DIR = 'uploads';
const DATA_DIR = 'data';
const POPPLER_BIN_DIR = '/usr/bin/';

const TASK_HANDLERS = {
    pdf2text: PDFToText,
    pdf2images: PDFToImages,
    pdfimages: ImagesFromPDF,
    pdfinfo: PDFInfo,
};

const createServer = async () => {
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
                allow: 'multipart/form-data',
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
                const requestFile = data?.message;
                const contentFile = data?.content;

                if (!requestFile || !contentFile) {
                    return h.response({ error: 'Expected multipart fields: message and content' }).code(400);
                }

                requestFilePath = path.join(UPLOADS_DIR, `${uuidv4()}.json`);
                await saveStreamToFile(requestFile, requestFilePath);
                const message = await parseMessageFile(requestFilePath);

                if (!message?.task?.id) {
                    return h.response({ error: 'Invalid message payload: missing task.id' }).code(400);
                }

                const taskId = message.task.id;
                const handler = TASK_HANDLERS[taskId];
                if (!handler) {
                    return h.response({ error: `Unsupported task: ${taskId}` }).code(400);
                }

                const dirname = uuidv4();
                await fs.ensureDir(path.join(DATA_DIR, dirname));

                contentFilePath = path.join(UPLOADS_DIR, `${uuidv4()}.pdf`);
                await saveStreamToFile(contentFile, contentFilePath);

                output.response.uri = await handler(contentFilePath, message.task.params, dirname);
                await safeUnlink(contentFilePath);
                await safeUnlink(requestFilePath);
            } catch (e) {
                console.error('Process failed:', e);
                try {
                    await safeUnlink(contentFilePath);
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
async function PDFToText(filepath, options, dirname) {
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
    await poppler.pdfToText(filepath, `${DATA_DIR}/${dirname}/${textFile}`, options);

    return [`/files/${dirname}/${textFile}`];
}


async function PDFToImages(filepath, options, dirname) {
    options = options || {};
    options.pngFile = true;
    if (!options.cropBox) options.cropBox = true;
    options.firstPageToConvert = 1;
    options.lastPageToConvert = 1;
    cleanPageOptions(options);

    const poppler = new Poppler(POPPLER_BIN_DIR);
    await poppler.pdfToPpm(filepath, `${DATA_DIR}/${dirname}/page`, options);
    return getImageList(`${DATA_DIR}/${dirname}`, `/files/${dirname}`);

 }


 async function ImagesFromPDF(filepath, options, dirname) {
    options = options || {};
    options.pngFile = true;
    options.firstPageToConvert = 1;
    options.lastPageToConvert = 1;
    cleanPageOptions(options);

    const poppler = new Poppler(POPPLER_BIN_DIR);
    await poppler.pdfImages(filepath, `${DATA_DIR}/${dirname}/page-1_image`, options);
    return getImageList(`${DATA_DIR}/${dirname}`, `/files/${dirname}`);
 }

async function PDFInfo(filepath, options, dirname) {
    const poppler = new Poppler(POPPLER_BIN_DIR);
    const result = await poppler.pdfInfo(filepath, options || {});

    const infoFile = path.join(DATA_DIR, dirname, 'pdfinfo.txt');
    await fs.writeFile(infoFile, result);
    return [`/files/${dirname}/pdfinfo.txt`];
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
    cleanPageOptions,
    safeUnlink,
    parseMessageFile,
    isPathInside,
};