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

var filepath = 'test/sample.pdf'




// ******* ROUTES ************

router.get('/', function (ctx) {
	ctx.body = 'md-poppler API'
})

router.post('/process', upload.fields([
    { name: 'request', maxCount: 1 },
    { name: 'content', maxCount: 1 }
  ]), async function (ctx) {

    let output = {response: {
        type: "stored",
        uri: []
    }}
    console.log(ctx.request.files)
    const requestFilepath = ctx.request.files['request'][0].path
    const contentFilepath = ctx.request.files['content'][0].path

    try {
        var dirname = uuidv4()
        await fs.mkdir(path.join('data', dirname))
        var request = await fs.readFile(requestFilepath)
        var requestJSON = JSON.parse(request)
        console.log(requestJSON)
    
        if(requestJSON.params.task == 'pdf2text') {
            output.response.uri = await PDFToText(contentFilepath, requestJSON.params.options, dirname)
        } else if(requestJSON.params.task == 'pdf2images') {
            output.response.uri = await PDFToImages(contentFilepath, requestJSON.params.options, dirname)
        }

        await fs.unlink(contentFilepath)
        await fs.unlink(requestFilepath)
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
    var input_path = path.join('data', ctx.request.params.dir, ctx.request.params.file)
    const src = fs.createReadStream(input_path);
    ctx.set('Content-Disposition', `attachment; filename=${ctx.request.params.file}`);
    ctx.type = 'application/octet-stream';
    ctx.body = src
})


app.use(router.routes());

var set_port = process.env.PORT || 8300
var server = app.listen(set_port, function () {
   var host = server.address().address
   var port = server.address().port

   console.log('md-poppler running at http://%s:%s', host, port)
})


// ******* ROUTES ENDS ************




async function PDFToText(filepath, options, dirname) {
    if(!options) {
        options = {}
    }
    var filename = filepath.split('/').pop()
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
    //options.resolutionXYAxis = parseInt(params.resolution)

    var filename = filepath.split('/').pop()
    const poppler = new Poppler('/usr/bin/');

    console.log(filename)
    await poppler.pdfToPpm(filepath, `data/${dirname}/page`, options);
    var images = getImageList(`data/${dirname}`,`files/${dirname}`)
    return images


//     if(!params.resolution || !parseInt(params.resolution)) throw('Invalid render resolution (must be integer)')
//     const {filename, input_path, output_path} = await this.getPaths(params, 'rendered/' + params.resolution)
//     if(await this.exists(output_path)) throw(`Output directory exists (${output_path})`)

//     options.resolutionXYAxis = parseInt(params.resolution)
//     if(query.format && ['jpg', 'jpeg'].includes(query.format)) options.jpegFile = true


//     //const filepath = path.join(input_path, filename)
//     if(!await this.exists(filepath)) throw('PDF file not found: ' + filepath)
//     await fsp.mkdir(output_path, { recursive: true })
//     console.log(output_path)

//     const poppler = new Poppler('/usr/bin/');
//     await poppler.pdfToPpm(filepath, output_path + '/page', options);
//     var files = await this.getImageList(output_path, '')
//     var response = {files: files}
//     return response
 }


async function getImageList(input_path, fullpath, filter) {
    console.log(input_path)
    if(!filter) filter = ['.png','.jpg', '.jpeg', '.tiff']
    var files = await fs.readdir(input_path, { withFileTypes: true })
    return files
        .filter(dirent => dirent.isFile())
        .map(dirent => dirent.name)
        .filter(f => filter.includes(path.extname(f).toLowerCase()))
        .map(x => path.join(fullpath, x))
}