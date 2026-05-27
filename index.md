

# Poppler Service

The **Poppler** service allows you to extract textual data and image assets directly from PDF files. 
[Poppler](https://en.wikipedia.org/wiki/Poppler_(software)) is open source software. 

For a broader overview of how the platform interacts with document formats, please refer to the **PDF Handling** help section.

## Available Crunchers

### `Extract text from PDF`
Extracts structural text layers from PDF pages.

* **How it works:** This utility pulls the underlying "raw" text data directly embedded within the document.
* **Limitations:** If the PDF consists entirely of scanned document images, the resulting output will be completely empty. 
* > ⚠️ **Note:** This cruncher does *not* perform Optical Character Recognition (OCR). To convert scanned text images into editable text, use an OCR services (such as **Tesseract**, **PaddleOCR**) instead.


### `Extract images from PDF`
Extracts raw, embedded image files from within the PDF wrapper.

* **How it works:** Instead of rendering the whole page layout, this tool extracts the actual standalone graphic assets embedded inside the file structure in their native, original resolution. Also the hidden ones.
* > 💡 **Core Distinction:** A historical graphic that appears stamp-sized on the rendered PDF page layout might actually be a massive, uncompressed archive image. While `pdf2images` will capture it at page-scale resolution, `pdfimages` will pull out the original high-resolution file asset, which could potentially be hundreds of megabytes in size.


### `Render PDF as images`
Renders entire PDF pages into static images.

* **How it works:** Think of this as taking a high-fidelity snapshot or screenshot of every individual page. 
* **Output:** The resulting image captures exactly what is visible to the human eye, including layout, fonts, and embedded graphics, making it ideal for visual inspection or OCR or document understanding tasks. 



## Digging Deeper

Because the MD-Poppler service is built directly on top of the open-source **`poppler-utils`** library, you can easily replicate and expand these workflows locally on your own machine. 


### Command-Line Reference

* **`pdfattach`** – Embeds a new external file or attachment directly into an existing PDF.
* **`pdfdetach`** – Extracts embedded document attachments out of a PDF file.
* **`pdffonts`** – Lists and analyzes all fonts utilized within the document structure.
* **`pdfimages`** – Saves all embedded image assets at their native archiving resolution (the engine behind our `pdfimages` cruncher).
* **`pdfinfo`** – Dumps the document's metadata, including page counts, encryption status, and creation dates.
* **`pdfseparate`** – Extracts designated individual pages from a multi-page PDF document.
* **`pdftocairo`** – Converts PDF pages into high-fidelity vector (SVG, PDF, EPS) or bitmap (PNG, JPEG) formats using the Cairo graphics engine.
* **`pdftohtml`** – Converts PDF content into a structured HTML format while attempting to retain the original layout and formatting.
* **`pdftoppm`** – Converts PDF pages into portable pixmap (PPM), PNG, or JPEG bitmaps (the engine driving our `pdf2images` cruncher).
* **`pdftops`** – Converts a PDF document into a printable PostScript (PS) format.
* **`pdftotext`** – Extracts the raw structural text layer from the PDF (the engine driving our `pdf2text` cruncher).
* **`pdfunite`** – Merges multiple separate PDF files together into a single, unified document.