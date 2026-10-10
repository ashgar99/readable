<p align="center"><img src="docs/logo.svg" width="72" height="72" alt=""></p>
<h3 align="center">Readable</h3>
<p align="center">Turn scanned reading packs and photos of pages into searchable, highlightable PDFs, entirely in your browser.</p>

<p align="center">
  <a href="LICENSE"><img alt="MIT licence" src="https://img.shields.io/github/license/ashgar99/readable?color=brightgreen" /></a>
  <img alt="Runs in your browser" src="https://img.shields.io/badge/runs-in%20your%20browser-blue" />
  <img alt="No sign-up" src="https://img.shields.io/badge/sign--up-not%20required-blue" />
</p>

<p align="center"><a href="https://ashgar99.github.io/readable/"><b>Open Readable</b></a></p>


## Features ✨

- Adds an invisible text layer to scanned PDFs, so they look the same but can be searched, selected, copied and highlighted.
- Turns photos of pages (JPG or PNG) into one searchable PDF.
- Skips pages that already contain text, so mixed documents are handled quickly.
- Supports English, French, German, Spanish, Italian, Portuguese and Dutch.
- Runs entirely in your browser using [Tesseract.js](https://tesseract.projectnaptha.com/). Your files are never uploaded.


## Usage 🛠

1. Open [Readable](https://ashgar99.github.io/readable/).
2. Choose a scanned PDF, or one or more photos of pages.
3. Pick the language of the text, then click **Make searchable**.
4. The searchable PDF downloads when it is finished.

The first run downloads the text-recognition engine and language data (about 10 MB), which your browser then keeps for next time.


## Browser support 🌐

Works in current versions of Chrome, Edge, Brave, Firefox and Safari, on computers. Phones work for small files but can run out of memory on large scans.

## Limitations ⚠️

- Latin-script languages only for now. Chinese, Japanese, Korean, Arabic and other scripts need fonts that would make the tool much larger.
- Handwriting, very low-resolution scans and complex layouts may not be recognised well. Try the **High** quality setting for small print.
- Pages with existing text are left as they are when "Skip pages that already have text" is on.


## Troubleshooting 🔧

| Problem | Solution |
| --- | --- |
| `Could not load...` | Readable needs an internet connection the first time to download its engine. |
| Search finds nothing | Check the language setting matches the text, and try the High quality setting. |
| The browser tab crashes | Very large scans can use a lot of memory. Split the PDF into smaller parts and try again. |


## Privacy and security 🔒

Readable is a single page with no server. Files are opened and processed in your browser using open-source libraries ([pdf.js](https://mozilla.github.io/pdf.js/), [Tesseract.js](https://tesseract.projectnaptha.com/) and [pdf-lib](https://pdf-lib.js.org/)), loaded from public code libraries (cdnjs and jsDelivr). Your documents are never uploaded.


## Development 🧩

The whole app lives in [`docs/`](docs): `index.html` for the page and `readable.js` for the logic. There is no build step.


## Unikit 🎒

Readable is part of Unikit, a set of free tools for students: [Modzip](https://ashgar99.github.io/moodle-module-downloader/), [Subzip](https://ashgar99.github.io/subzip/), [Duecal](https://ashgar99.github.io/duecal/), [Termcal](https://ashgar99.github.io/termcal/), [Gradewise](https://ashgar99.github.io/gradewise/) and [Wordfair](https://ashgar99.github.io/wordfair/).

Readable is not affiliated with or endorsed by Moodle or any university.


## Licence 📑

[MIT](LICENSE)
