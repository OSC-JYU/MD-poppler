
# md-poppler

MessyDesk service wrapper around `node-poppler`:
https://github.com/Fdawgs/node-poppler

## What This Service Does

- Accepts a PDF and a JSON message via multipart upload.
- Runs one Poppler task (`pdf2text`, `pdf2images`, `pdfimages`, `pdfinfo`).
- Stores output under `data/<uuid>/...`.
- Returns downloadable URIs under `/files/{dir}/{file}`.

Important: in MessyDesk, this service receives single-page PDFs (already split upstream). The implementation enforces page 1 for page-based conversion tasks.

## API

Base URL (default): `http://localhost:8300`

### `POST /process`

Multipart form-data fields:

- `message`: JSON file with task definition
- `content`: input PDF file

`message` payload shape used by current service:

```json
{
	"task": {
		"id": "pdf2text",
		"params": {
			"resolutionXYAxis": 150
		}
	}
}
```

Supported task ids:

- `pdf2text`
- `pdf2images`
- `pdfimages`
- `pdfinfo`

Successful response format:

```json
{
	"response": {
		"type": "stored",
		"uri": [
			"/files/020b358c-8815-4bcb-9d08-287aa13532e0/page_001.txt"
		]
	}
}
```

Common error responses:

- `400`: invalid message content (for example missing `task.id`, unsupported task, missing multipart fields)
- `415`: request is not multipart/form-data
- `500`: processing failure

### `GET /files/{dir}/{file}`

Downloads one generated file. The file is deleted after successful download.

## Local Run

```bash
npm install
node index.js
```

The server listens on port `8300` by default.

## Example Calls

Run from project root (`MD-poppler`):

### 1. Extract text

```bash
cat > /tmp/md-poppler-message.json <<'JSON'
{
	"task": {
		"id": "pdf2text",
		"params": {}
	}
}
JSON

curl -X POST http://localhost:8300/process \
	-F "message=@/tmp/md-poppler-message.json;type=application/json" \
	-F "content=@test/sample.pdf;type=application/pdf"
```

### 2. Render page image(s)

```bash
cat > /tmp/md-poppler-message.json <<'JSON'
{
	"task": {
		"id": "pdf2images",
		"params": {
			"resolutionXYAxis": 300
		}
	}
}
JSON

curl -X POST http://localhost:8300/process \
	-F "message=@/tmp/md-poppler-message.json;type=application/json" \
	-F "content=@test/sample.pdf;type=application/pdf"
```

## Testing

```bash
npm test
```

Current suite uses Node's built-in test runner (`node --test`) and covers helper behavior plus request validation paths.

## Docker

Build image:

```bash
make build
```

Run container:

```bash
make start
```

Useful targets:

- `make stop`
- `make restart`
- `make logs`
- `make bash`
- `make test`







