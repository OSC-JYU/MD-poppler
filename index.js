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


// async function uploadFile(uploadFilePath) {

// 	try {
//         const filename = uuidv4()
//         const filepath = path.join('data', filename) 
//         console.log(filepath)
	
// 		var exists = await checkFileExists(filepath)
// 		if(!exists) {
// 			await fs.rename(uploadFilePath, filepath);
// 			console.log('File moved successfully!')
// 		} else {
// 			await fs.unlink(uploadFilePath)
// 			throw('file exists!')
// 		}

// 		return filepath

// 	} catch (e) {
// 		console.log('File upload failed')
// 		console.log(e.message)
// 	}
// }


// async function checkFileExists(filePath) {
// 	try {
// 		console.log(filePath)
// 	  	await fs.access(filePath);
// 	  	return true;
// 	} catch (err) {
// 		return false;
// 	}
// }

