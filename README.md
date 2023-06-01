
# md-poppler

An experimental MessyDesk wrapper for node-poppler: 
https://github.com/Fdawgs/node-poppler

## Example API call 



	curl -X POST -H "Content-Type: multipart/form-data" \
	  -F "request=@test/pdf2text.json;type=application/json" \
	  -F "content=@test/sample.pdf" \
	  http://localhost:8300/process



This will return JSON with "store" URL, where one can download the result.

	{
	  "response": {
	    "type": "stored",
	    "uri": "/files/020b358c-8815-4bcb-9d08-287aa13532e0/text.txt"
	  }
	}



## MessyDesk

### Registering service

Register with service.json (this might change)

	{
	    "url": "http://localhost:8300",
	    "id": "md-poppler",
	    "type": "pdf",
	    "api_type": "elg",
	    "api": "/process",
	    "name" :"Poppler",
	    
	    "supported_types": ["pdf"],
	    "supported_formats": ["pdf"],

	    "description": "Poppler is a PDF rendering library that also includes a collection of utility binaries, which allows for the manipulation and extraction of data from PDF documents such as converting PDF files to HTML, TXT, or PostScript",

	    "crunchers": {
		"pdf2text": {
		    "params": {"task": "pdf2text"},
		    "output": "store",
		    "name": "Extract text from PDF",
		    "description": "Creates a txt file from PDF."
		},
		"pdf2images": {
		    "params": {"task": "pdf2images"},
		    "output": "store",
		    "name": "Extract images from PDF",
		    "description": "Creates separate image files from images in PDF file."
		}
	    }
	}


### calling service


	curl -X POST http://localhost:8200/api/queue/md-poppler/files/108:3 -d "@test/services/md-poppler/sample.json" --header "Content-Type: application/json"






