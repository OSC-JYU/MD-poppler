const Koa			= require('koa');
const Router		= require('koa-router');
const { koaBody }	= require('koa-body');
const json			= require('koa-json')
const multer 		= require('@koa/multer');
//const winston 		= require('winston');
const path 			= require('path')
const fs 			= require('fs-extra')
const { v4: uuidv4 } = require('uuid');


const { Poppler }       = require("node-poppler");

var app				= new Koa();
var router			= new Router();

app.use(json({ pretty: true, param: 'pretty' }))
app.use(koaBody());

const upload = multer({
	dest: './uploads/',
	fileSize: 1048576
});



// ******* ROUTES ************

router.get('/', function (ctx) {
	ctx.body = 'md-poppler API'
})


router.post('/upload/:split?', upload.fields([
    { name: 'file', maxCount: 1 }
  ]), async function (ctx) {

      try {
        const contentFilepath = ctx.request.files['file'][0].path
        var dirname = uuidv4()
        await fs.mkdir(path.join('data', dirname))
        // move content to data dir
        const target = path.join('data', dirname, '_original.pdf')
        await fs.move(contentFilepath, target)
        var info = await PDFInfoRaw(target, {})  // get page count
        if(ctx.params.split) {
            const split_path = path.join(dirname, 'pages')
            await fs.mkdir(path.join('data', split_path))
            await PDFSeparate(target, {}, split_path)
        }
        ctx.body= {upload: dirname, info: info}
    } catch(e) {
        console.log(e)
        ctx.status = 500
        ctx.body = {error:e}
    }
})

router.post('/process', upload.fields([
    { name: 'request', maxCount: 1 },
    { name: 'content', maxCount: 1 }
  ]), async function (ctx) {

    let output = {response: {
        type: "stored",
        uri: []
    }}

    try {
        const requestFilepath = ctx.request.files['request'][0].path
        var contentFilepath = ''

        var requestJSON = await fs.readJSON(requestFilepath, 'utf-8')
        await fs.unlink(requestFilepath)
        if(typeof requestJSON === 'string')
            requestJSON = JSON.parse(requestJSON)
        const task = requestJSON.params.task
        delete requestJSON.params.task
        const dirname = path.join(requestJSON.preloaded)

        // check if file to be processed is preloaded
        if(requestJSON.preloaded) { 
            contentFilepath = path.join('data', requestJSON.preloaded, '_original.pdf')
        } else {
            contentFilepath = ctx.request.files['content'][0].path
        }

        if(task == 'delete') {
            await fs.remove(path.join('data', requestJSON.preloaded))
        } else if(task == 'pdf2text') {
            output.response.uri = await PDFToText(contentFilepath, requestJSON.params, dirname)
        } else if(task == 'pdf2images') {
            output.response.uri = await PDFToImages(contentFilepath, requestJSON.params, dirname)
        } else if(task == 'pdfimages') {
            output.response.uri = await ImagesFromPDF(contentFilepath, requestJSON.params, dirname)
        } else if(task == 'pdfseparate') {
            output.response.uri = await PDFSeparate(contentFilepath, requestJSON.params, dirname)
        } else if(task == 'pdfsplit') {
            output.response.uri = await PDFSplit(contentFilepath, requestJSON.params, dirname)
        } else if(task == 'pdfinfo') {
            output.response.uri = await PDFInfo(contentFilepath, requestJSON.params, dirname)
        }

        // if we did not output eny files, then delete directory
        // if(output.response.uri.length === 0) {
        //     await fs.promises.readdir(dirPath);
        // }

        // if we processed preloaded file, then do not remove it until "delete" task is done
        if(!requestJSON.preloaded) {
            await fs.unlink(contentFilepath)
        } 
        
    } catch (e) {
        console.log(e.message)
        try {
            await fs.unlink(contentFilepath)
            await fs.unlink(requestFilepath)
        } catch(e) {
            console.log('Removing of temp files failed')
        }

    }
	ctx.body = output
})


router.get('/files/:dir/:file', async function (ctx) {
    const dirPath = path.join('data', ctx.request.params.dir);
    const filePath = path.join(dirPath, ctx.request.params.file);
    let cleanupCalled = false;

    try {
        await fs.promises.access(filePath); // Check if file exists
    } catch (err) {
        ctx.status = 404;
        ctx.body = "File not found";
        return;
    }

    const src = fs.createReadStream(filePath);
    ctx.set('Content-Disposition', `attachment; filename=${ctx.request.params.file}`);
    ctx.type = 'application/octet-stream';
    ctx.body = src
    // Function to delete file and check directory
    const cleanup = async () => {
        if (cleanupCalled) return; // Prevent duplicate execution
        cleanupCalled = true;
        try {
            await fs.promises.unlink(filePath); // Delete file

            // Check if directory is empty
            // const files = await fs.promises.readdir(dirPath);
            // if (files.length === 0) {
            //     await fs.promises.rmdir(dirPath); // Delete directory if empty
            //     console.log(`Deleted empty directory: ${dirPath}`);
            // }
        } catch (err) {
            console.error(`Error during cleanup: ${err.message}`);
        }
    };

    // Delete file after stream finishes
    ctx.res.on('finish', cleanup);

    // Handle client disconnection (e.g., interrupted download)
    ctx.res.on('close', cleanup);

})


app.use(router.routes());

    var set_port = process.env.PORT || 8300
    var server = app.listen(set_port, function () {
    var host = server.address().address
    var port = server.address().port

    console.log('md-poppler running at http://%s:%s', host, port)
})


// ******* ROUTES ENDS ************


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


async function PDFToText(filepath, options, dirname) {
    if(!options) {
        options = {}
    }
    cleanPageOptions(options)

    const poppler = new Poppler('/usr/bin/');
    await poppler.pdfToText(filepath, `data/${dirname}/text.txt`, options);

    return `/files/${dirname}/text.txt`
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

    const poppler = new Poppler('/usr/bin/');
    await poppler.pdfImages(filepath, `data/${dirname}/image`, options)
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
        options.firstPageToConvert = parseInt(options.firstPageToConvert, 10)
    }
    if(options.lastPageToConvert ) {
        options.lastPageToConvert = parseInt(options.lastPageToConvert, 10)
    }
    if(options.firstPageToExtract ) {
        options.firstPageToExtract = parseInt(options.firstPageToExtract, 10)
    }
    if(options.lastPageToExtract ) {
        options.lastPageToExtract = parseInt(options.lastPageToExtract, 10)
    }
}