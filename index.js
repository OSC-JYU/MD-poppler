const Hapi = require('@hapi/hapi');
const Inert = require('@hapi/inert');
const fs = require('fs-extra');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { Poppler } = require('node-poppler');

const init = async () => {
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
        path: '/upload/{split?}',
        options: {
            payload: {
                output: 'stream',
                parse: true,
                allow: 'multipart/form-data',
                multipart: true,
                maxBytes: 1048576000 // 1 Gt
            }
        },
        handler: async (request, reply) => {
            try {
                const data = request.payload;
                const file = data.file;
                const dirname = uuidv4();
                await fs.mkdir(path.join('data', dirname));
                const target = path.join('data', dirname, '_original.pdf');
                const writeStream = fs.createWriteStream(target);
                
                await new Promise((resolve, reject) => {
                    file.on('error', reject);
                    writeStream.on('finish', resolve);
                    file.pipe(writeStream);
                });
                
                var info = await PDFInfoRaw(target, {});

                if (request.params.split) {
                    const splitPath = path.join(dirname, 'pages');
                    await fs.mkdir(path.join('data', splitPath));
                    await PDFSeparate(target, {}, splitPath);
                }

                return reply.response({ upload: dirname, info }).code(200);
            } catch (e) {
                console.log(e);
                return reply.response({ error: e.message }).code(500);
            }
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
                maxBytes: 1048576
            }
        },
        handler: async (request, h) => {
            let output = { response: { type: 'stored', uri: [] } };
            let contentFilepath = '';
            try {
                const data = request.payload;
                const requestFile = data.request;
                const contentFile = data.content;
                
                const requestFilePath = path.join('uploads', uuidv4() + '.json');
                const writeStream = fs.createWriteStream(requestFilePath);
                
                await new Promise((resolve, reject) => {
                    requestFile.on('error', reject);
                    writeStream.on('finish', resolve);
                    requestFile.pipe(writeStream);
                });
                
                let requestJSON = await fs.readJSON(requestFilePath, 'utf-8');
                //console.log(requestJSON)
                await fs.unlink(requestFilePath);
                if (typeof requestJSON === 'string') {
                    requestJSON = JSON.parse(requestJSON);
                }
                const task = requestJSON.params.task;
                delete requestJSON.params.task;
                const dirname = path.join(requestJSON.preloaded || uuidv4());

                if (requestJSON.preloaded) {
                    contentFilepath = path.join('data', requestJSON.preloaded, '_original.pdf');
                } else {
                    const contentTarget = path.join('uploads', uuidv4() + '.pdf');
                    const contentStream = fs.createWriteStream(contentTarget);
                    await new Promise((resolve, reject) => {
                        contentFile.on('error', reject);
                        contentStream.on('finish', resolve);
                        contentFile.pipe(contentStream);
                    });
                    contentFilepath = contentTarget;
                }

                switch (task) {
                    case 'delete':
                        await fs.remove(path.join('data', requestJSON.preloaded));
                        break;
                    case 'pdf2text':
                        output.response.uri = await PDFToText(contentFilepath, requestJSON.params, dirname);
                        break;
                    case 'pdf2images':
                        output.response.uri = await PDFToImages(contentFilepath, requestJSON.params, dirname);
                        break;
                    case 'pdfimages':
                        output.response.uri = await ImagesFromPDF(contentFilepath, requestJSON.params, dirname);
                        break;
                    case 'pdfseparate':
                        output.response.uri = await PDFSeparate(contentFilepath, requestJSON.params, dirname);
                        break;
                    case 'pdfsplit':
                        output.response.uri = await PDFSplit(contentFilepath, requestJSON.params, dirname);
                        break;
                    case 'pdfinfo':
                        output.response.uri = await PDFInfo(contentFilepath, requestJSON.params, dirname);
                        break;
                }

                if (!requestJSON.preloaded) {
                    await fs.unlink(contentFilepath);
                }
            } catch (e) {
                console.error(e.message);
                try {
                    if (contentFilepath) await fs.unlink(contentFilepath);
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
            const dirPath = path.join('data', request.params.dir);
            const filePath = path.join(dirPath, request.params.file);
    
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
    

    await server.start();
    console.log(`Server running on ${server.info.uri}`);
};

init().catch(err => {
    console.error(err);
    process.exit(1);
});




async function PDFInfoRaw(filepath, options) {
    options = { printAsJson: true };
    const poppler = new Poppler('/usr/bin/');
    return await poppler.pdfInfo(filepath, options);
}

async function PDFSeparate(filepath, options, dirname) {
    if (!options) options = {};
    const poppler = new Poppler('/usr/bin/');
    await poppler.pdfSeparate(filepath, `data/${dirname}/page_%d.pdf`, options);
}

async function PDFSplit(filepath, options, dirname) {
    if(!options) {
        options = {}
    }
    cleanPageOptions(options)

    const poppler = new Poppler('/usr/bin/');
    await poppler.pdfSeparate(filepath, `data/${dirname}/page_%d.pdf`, options);
    input_dir = `data/${dirname}`
    var files = await fs.readdir(input_dir)
    files = files.map(x => path.join(input_dir, x))

    options = {}
    await poppler.pdfUnite(files, `data/${dirname}/pages.pdf`, options);

    return `/files/${dirname}/pages.pdf`
}


async function PDFSeparate(filepath, options, dirname) {
    if(!options) {
        options = {}
    }
    cleanPageOptions(options)

    const poppler = new Poppler('/usr/bin/');
    await poppler.pdfSeparate(filepath, `data/${dirname}/page_%d.pdf`, options);
    var files = getFileList(`data/${dirname}`,`/files/${dirname}`, ['.pdf'])

    return files
}

// api-poppler calls this normally so that first and last pages are the same (not zero)
async function PDFToText(filepath, options, dirname) {
    if(!options) {
        options = {}
    }
    cleanPageOptions(options)

    if(options.firstPageToConvert == null || options.lastPageToConvert == null) {
        throw new Error('firstPageToConvert and lastPageToConvert are required')
    }

    var text_file = `text.txt`
    if(options.firstPageToConvert ===  options.lastPageToConvert){
        text_file = `page_${String(options.firstPageToConvert).padStart(3, '0')}.txt`;
    } else {
        text_file = `page_${options.firstPageToConvert}-${options.lastPageToConvert}.txt`
    } 

    // get all text from pdf


    const poppler = new Poppler('/usr/bin/');
    await poppler.pdfToText(filepath, `data/${dirname}/${text_file}`, options);

    if(options.firstPageToConvert === 0 && options.lastPageToConvert === 0) {
        return `/files/${dirname}/${text_file}`
    } else if(options.firstPageToConvert ===  options.lastPageToConvert){
        return [`/files/${dirname}/${text_file}`]
    }   
    
}


async function PDFToImages(filepath, options, dirname) {
    if(!options) {
        options = {}
    }
    options.pngFile = true
    if(!options.cropBox) options.cropBox = true
    cleanPageOptions(options)
    //options.resolutionXYAxis = parseInt(params.resolution)

    const poppler = new Poppler('/usr/bin/');
    await poppler.pdfToPpm(filepath, `data/${dirname}/page`, options);
    var images = getImageList(`data/${dirname}`,`/files/${dirname}`)
    return images

 }


 async function ImagesFromPDF(filepath, options, dirname) {
    if(!options) {
        options = {}
    }
    options.pngFile = true
    //options.allFiles = true
    cleanPageOptions(options)

    if(options.firstPageToConvert == null || options.lastPageToConvert == null) {
        throw new Error('firstPageToConvert and lastPageToConvert are required')
    }

    const poppler = new Poppler('/usr/bin/');
    await poppler.pdfImages(filepath, `data/${dirname}/page-${options.firstPageToConvert}_image`, options)
    var images = await getImageList(`data/${dirname}`,`/files/${dirname}`)
    return images
 }

 async function PDFInfo(filepath, options, dirname) {   
    options = {printAsJson: true}
    const poppler = new Poppler('/usr/bin/');
    var r = await poppler.pdfInfo(filepath,  options);
    await fs.writeFile(`data/${dirname}/info.json`, JSON.stringify(r))
    return `/files/${dirname}/info.json`
}

async function PDFInfoRaw(filepath, options) {   
    options = {printAsJson: true}
    const poppler = new Poppler('/usr/bin/');
    var r = await poppler.pdfInfo(filepath,  options);
    return r
}

async function getImageList(input_path, fullpath, filter) {
    if(!filter) filter = ['.png','.jpg', '.jpeg', '.tiff']
    var files = await fs.readdir(input_path, { withFileTypes: true })
    return files
        .filter(dirent => dirent.isFile())
        .map(dirent => dirent.name)
        .filter(f => filter.includes(path.extname(f).toLowerCase()))
        .map(x => path.join(fullpath, x))
}

async function getFileList(input_path, fullpath, filter) {
    if(!filter) filter = ['.png','.jpg', '.jpeg', '.tiff']
    var files = await fs.readdir(input_path, { withFileTypes: true })
    return files
        .filter(dirent => dirent.isFile())
        .map(dirent => dirent.name)
        .filter(f => filter.includes(path.extname(f).toLowerCase()))
        .map(x => path.join(fullpath, x))
}

function cleanPageOptions(options) {
    if(options.firstPageToConvert ) {
        options.firstPageToConvert = parseInt(options.firstPageToConvert, 10) || 0
    }
    if(options.lastPageToConvert ) {
        options.lastPageToConvert = parseInt(options.lastPageToConvert, 10) || 0
    }
    if(options.firstPageToExtract ) {
        options.firstPageToExtract = parseInt(options.firstPageToExtract, 10) || 0
    }
    if(options.lastPageToExtract ) {
        options.lastPageToExtract = parseInt(options.lastPageToExtract, 10) || 0
    }
    if(options.resolutionXAxis ) {
        options.resolutionXAxis = parseInt(options.resolutionXAxis, 10) || 150
    }
    if(options.resolutionYAxis ) {
        options.resolutionYAxis = parseInt(options.resolutionYAxis, 10)|| 150
    }
    if(options.resolutionXYAxis ) {
        options.resolutionXYAxis = parseInt(options.resolutionXYAxis, 10)|| 150
    }
}