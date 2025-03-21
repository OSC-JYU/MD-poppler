
# md-poppler

An experimental MessyDesk wrapper for node-poppler: 
https://github.com/Fdawgs/node-poppler



## API

endpoint is http://localhost:8300/process

Payload is options json and file to be prosecced. 

Endpoint returns JSON with "store" URL, where one can download the result.

	{
	  "response": {
	    "type": "stored",
	    "uri": "/files/020b358c-8815-4bcb-9d08-287aa13532e0/text.txt"
	  }
	}


A file can be preloaded and splitted while preloaded. This makes it possible to get first files out fast. Other wise large PDF processing would take minutes without any sign of progress.

preload endpoint is http://localhost:8300/upload/:split

	curl -X POST -H "Content-Type: multipart/form-data" \
	  -F "file=@test/sample.pdf" \
	  http://localhost:8300/upload/split


This will return somethin like this:

{
  "upload": "data/b1ebe0fa-ea67-461b-9242-970970b5813c/original.pdf"
}


Then, in the process call set "preloaded" to this value like this:

{
    "type": "image",
    "preloaded": "06c13245-a41c-48e9-9a36-4c7e0a21c1db/56e6464468c194939feef91ff61f5fa0",
    "params": {
        "task": "pdf2images",
        "resolutionXYAxis": 150,
        "firstPageToConvert": 1,
        "lastPageToConvert": 2
    }
}

### Example API call 

Run these from MD-poppler directory:


Text: extract text

	curl -X POST -H "Content-Type: multipart/form-data" \
	  -F "request=@test/pdf2text.json;type=application/json" \
	  -F "content=@test/sample.pdf" \
	  http://localhost:8300/process


Separate: extract range on pages and get one pdf PER PAGE

	curl -X POST -H "Content-Type: multipart/form-data" \
	  -F "request=@test/pdfseparate.json;type=application/json" \
	  -F "content=@test/sample.pdf" \
	  http://localhost:8300/process


Split: extract range on pages and get ONE pdf

	curl -X POST -H "Content-Type: multipart/form-data" \
	  -F "request=@test/pdfsplit.json;type=application/json" \
	  -F "content=@test/sample.pdf" \
	  http://localhost:8300/process




## MessyDesk



### calling service


	curl -X POST http://localhost:8200/api/queue/md-poppler/files/108:3 -d "@test/services/md-poppler/sample.json" --header "Content-Type: application/json"






