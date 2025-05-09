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
                console.log(requestJSON)
                await fs.unlink(requestFilePath);
                if (typeof requestJSON === 'string') {
                    requestJSON = JSON.parse(requestJSON);
                }
                const task = requestJSON.params.task;
                delete requestJSON.params.task;
                const dirname = uuidv4();
                await fs.mkdir(path.join('data', dirname));
                console.log('dirname', dirname)

                const contentTarget = path.join('uploads', uuidv4() + '.pdf');
                const contentStream = fs.createWriteStream(contentTarget);
                await new Promise((resolve, reject) => {
                    contentFile.on('error', reject);
                    contentStream.on('finish', resolve);
                    contentFile.pipe(contentStream);
                });
                contentFilepath = contentTarget;
                

                switch (task) {

                    case 'pdf2text':
                        output.response.uri = await PDFToText(contentFilepath, requestJSON.params, dirname);
                        break;
                    case 'pdf2images':
                        console.log('pdf2images')
                        output.response.uri = await PDFToImages(contentFilepath, requestJSON.params, dirname);
                        break;
                    case 'pdfimages':
                        output.response.uri = await ImagesFromPDF(contentFilepath, requestJSON.params, dirname);
                        break;
                    case 'pdfinfo':
                        output.response.uri = await PDFInfo(contentFilepath, requestJSON.params, dirname);
                        break;
                }

                await fs.unlink(contentFilepath);
                
            } catch (e) {
                console.error(e);
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


// api-poppler calls this normally so that first and last pages are the same (not zero)
async function PDFToText(filepath, options, dirname) {
    if(!options) {
        options = {}
    }
    options.firstPageToConvert = 1
    options.lastPageToConvert = 1
    cleanPageOptions(options)

    var text_file = `text.txt`
    if(options.firstPageToConvert ===  options.lastPageToConvert){
        text_file = `page_${String(options.firstPageToConvert).padStart(3, '0')}.txt`;
    } else {
        text_file = `page_${options.firstPageToConvert}-${options.lastPageToConvert}.txt`
    } 

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
    options.firstPageToConvert = 1
    options.lastPageToConvert = 1
    cleanPageOptions(options)

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
    options.firstPageToConvert = 1
    options.lastPageToConvert = 1
    cleanPageOptions(options)

    const poppler = new Poppler('/usr/bin/');
    await poppler.pdfImages(filepath, `data/${dirname}/page-1_image`, options)
    var images = await getImageList(`data/${dirname}`,`/files/${dirname}`)
    return images
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