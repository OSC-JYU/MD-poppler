# Poppler Service

The **Poppler** service allows you to extract textual data and image assets directly from PDF files. 
[Poppler](https://en.wikipedia.org/wiki/Poppler_(software)) is open source software. 

For a broader overview of how the platform interacts with document formats, please refer to the **PDF Handling** help section.
![extract](/help/files/images/extract.jpg)

## When to use which

PDFs are split into pages when you import them (by **PyPDF**), so Poppler always works on one page
at a time; run its crunchers on a single page or on the set of pages.

| To get | Use |
|---|---|
| The text of a digital PDF page | **Extract text from PDF** |
| The page as an image, for OCR or viewing | **Render PDF as images** |
| The pictures embedded in the page, at full quality | **Extract images from PDF** |
| Title, author, dates, page size, PDF version | **PDF info** |
| The text of a scanned page | **Render PDF as images**, then an OCR cruncher (**Tesseract**, **Finnish PaddleOCR**) |

## Crunchers

### Extract text from PDF
The text layer of the page as a `.txt` file.

* **How it works:** it reads the text that is stored in the PDF itself, as in PDFs made by a word
  processor or by OCR software.
* **Limitations:** a scanned page is only a picture, so the result is empty.
* > ⚠️ This is not OCR. For scanned pages, render them as images and use an OCR cruncher.

### Render PDF as images
The page as a PNG image, exactly as it looks.

* **Resolution (dpi):** 150 by default, which is enough to read on screen. Use 300 for OCR of
  small print; higher values make large files.
* Use it before OCR, line segmentation and other image crunchers.

### Extract images from PDF
The images embedded in the page, each as its own PNG file in its original resolution.

* > 💡 A picture that looks stamp-sized on the page can be a huge high-resolution scan inside the
  PDF. **Render PDF as images** gives it at page scale; **Extract images from PDF** gives the
  original, which can be very large.
* A page can have no embedded images (text-only digital PDFs) or many (also hidden ones).

### PDF info
The document's information as a text file: title, author, subject, creator and producer
software, creation and change dates, page size, PDF version, encryption and more. Split pages
keep the information of the PDF they came from.

## Digging Deeper

Because the MD-Poppler service is built directly on top of the open-source **`poppler-utils`** library, you can easily replicate and expand these workflows locally on your own machine. 


### Command-Line Reference

* **`pdfattach`** – Embeds a new external file or attachment directly into an existing PDF.
* **`pdfdetach`** – Extracts embedded document attachments out of a PDF file.
* **`pdffonts`** – Lists and analyzes all fonts utilized within the document structure.
* **`pdfimages`** – Saves all embedded image assets at their native archiving resolution (the engine behind **Extract images from PDF**).
* **`pdfinfo`** – Dumps the document's metadata, including page counts, encryption status, and creation dates (the engine behind **PDF info**).
* **`pdfseparate`** – Extracts designated individual pages from a multi-page PDF document.
* **`pdftocairo`** – Converts PDF pages into high-fidelity vector (SVG, PDF, EPS) or bitmap (PNG, JPEG) formats using the Cairo graphics engine.
* **`pdftohtml`** – Converts PDF content into a structured HTML format while attempting to retain the original layout and formatting.
* **`pdftoppm`** – Converts PDF pages into portable pixmap (PPM), PNG, or JPEG bitmaps (the engine behind **Render PDF as images**).
* **`pdftops`** – Converts a PDF document into a printable PostScript (PS) format.
* **`pdftotext`** – Extracts the raw structural text layer from the PDF (the engine behind **Extract text from PDF**).
* **`pdfunite`** – Merges multiple separate PDF files together into a single, unified document.
