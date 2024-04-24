
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






