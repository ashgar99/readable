// Readable: make scanned PDFs and photos of pages searchable.
// Text recognition runs in the browser with Tesseract.js; nothing is uploaded.
(function () {
  var $ = function (id) { return document.getElementById(id); };
  var LIBS = {
    pdfjs: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js',
    pdfjsWorker: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js',
    pdflib: 'https://cdnjs.cloudflare.com/ajax/libs/pdf-lib/1.17.1/pdf-lib.min.js',
    tesseract: 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js',
    workerPath: 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/worker.min.js',
    corePath: 'https://cdn.jsdelivr.net/npm/tesseract.js-core@5.1.1',
    langPath: function (lang) { return 'https://cdn.jsdelivr.net/npm/@tesseract.js-data/' + lang + '@1.0.0/4.0.0_best_int'; }
  };
  var files = [];
  var running = false, cancelled = false;

  function load(src) {
    return new Promise(function (ok, fail) {
      if (document.querySelector('script[data-src="' + src + '"]')) return ok();
      var s = document.createElement('script');
      s.src = src; s.dataset.src = src;
      s.onload = ok; s.onerror = function () { fail(new Error('Could not load ' + src.split('/').pop() + '. Check your internet connection.')); };
      document.head.appendChild(s);
    });
  }
  function status(t) { $('status').textContent = t; }
  function progress(p) { $('bar').style.width = Math.max(0, Math.min(100, p)) + '%'; }

  function choose(list) {
    if (running) return;
    var pdf = [].filter.call(list, function (f) { return /pdf$/i.test(f.type) || /\.pdf$/i.test(f.name); });
    var imgs = [].filter.call(list, function (f) { return /^image\/(jpeg|png)$/.test(f.type); });
    files = pdf.length ? [pdf[0]] : imgs;
    $('pages').innerHTML = '';
    $('done').textContent = '0';
    progress(0);
    if (!files.length) { $('go').disabled = true; status('Please choose a PDF, JPG or PNG file.'); return; }
    $('drop-text').textContent = files.length === 1 ? files[0].name : files.length + ' images';
    $('go').disabled = false;
    status('Ready. Choose the language, then click Make searchable.');
  }

  function thumb(i, src) {
    var d = document.createElement('div');
    d.className = 'pg'; d.id = 'pg' + i;
    d.innerHTML = (src ? '<img alt="" src="' + src + '">' : '') + '<span>' + (i + 1) + '</span>';
    $('pages').appendChild(d);
    return d;
  }

  function imageToCanvas(file) {
    return new Promise(function (ok, fail) {
      var url = URL.createObjectURL(file), img = new Image();
      img.onload = function () {
        var c = document.createElement('canvas');
        var max = 3000, s = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
        c.width = Math.round(img.naturalWidth * s); c.height = Math.round(img.naturalHeight * s);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url); ok(c);
      };
      img.onerror = function () { fail(new Error('Could not open ' + file.name)); };
      img.src = url;
    });
  }

  // The invisible text layer uses the font Tesseract ships for this job (GlyphLessFont),
  // which maps character codes straight to Unicode, so it works for every script,
  // including Japanese, Chinese and Korean. Each recognised word is placed exactly over
  // the printed word, running down the page for vertical text.
  var CJK = /^(jpn|chi_sim|chi_tra|kor)/;
  var NO_SPACE = /[぀-ヿ㐀-鿿豈-﫿＀-￯　-〿]$/; // Japanese and Chinese words join without spaces
  var textFont = null;

  function wordsOf(data) {
    if (data.words && data.words.length) return data.words;
    var out = [];
    (data.blocks || []).forEach(function (b) { (b.paragraphs || []).forEach(function (p) { (p.lines || []).forEach(function (l) { (l.words || []).forEach(function (w) { out.push(w); }); }); }); });
    return out;
  }

  // Borrow Tesseract's font from a text-only page it produced
  function loadFont(out, pdfBytes, P) {
    var emb;
    return P.PDFDocument.load(pdfBytes).then(function (doc) { return out.embedPdf(doc, [0]); }).then(function (e) {
      emb = e;
      return emb[0].embed(); // write it into the document now, so its font can be reused
    }).then(function () {
      var form = out.context.lookup(emb[0].ref);
      var fonts = form.dict.lookup(P.PDFName.of('Resources'), P.PDFDict).lookup(P.PDFName.of('Font'), P.PDFDict);
      textFont = fonts.entries()[0][1];
    });
  }

  function hex(str) {
    var h = '';
    for (var i = 0; i < str.length; i++) h += ('0000' + str.charCodeAt(i).toString(16)).slice(-4);
    return h.toUpperCase();
  }

  // corners: where the image's top-left, top-right and bottom-left land on the page
  function addTextLayer(page, words, corners, cw, ch, vertical, P) {
    var a = corners[0], b = corners[1], c = corners[2];
    var ux = [(b[0] - a[0]) / cw, (b[1] - a[1]) / cw]; // one image pixel to the right
    var uy = [(a[0] - c[0]) / ch, (a[1] - c[1]) / ch]; // one image pixel upwards
    var at = function (x, y) { return [a[0] + ux[0] * x - uy[0] * y, a[1] + ux[1] * x - uy[1] * y]; };
    var name = page.node.newFontDictionary('ReadableText', textFont);
    var ops = [P.pushGraphicsState(), P.beginText(), P.setTextRenderingMode(P.TextRenderingMode.Invisible)];
    var placed = 0;
    words.forEach(function (w) {
      var text = (w.text || '').trim();
      if (!text || w.confidence < 20) return;
      var x0 = w.bbox.x0, y0 = w.bbox.y0, x1 = w.bbox.x1, y1 = w.bbox.y1, bw = x1 - x0, bh = y1 - y0;
      if (bw < 1 || bh < 1) return;
      var run = NO_SPACE.test(text) ? text : text + ' ';
      var o, m, size, along;
      if (vertical && bh > bw * 1.2) {
        // Runs down the column: text direction points down, glyph tops point right
        size = bw; along = bh; o = at(x0 + bw * 0.12, y0);
        m = [-uy[0], -uy[1], ux[0], ux[1]];
      } else {
        size = bh; along = bw; o = at(x0, y1 - bh * 0.15);
        m = [ux[0], ux[1], uy[0], uy[1]];
      }
      var squeeze = 100 * along / (text.length * 0.5 * size); // GlyphLessFont glyphs are half an em wide; the joining space sits just past the word
      ops.push(P.setFontAndSize(name, size), P.setTextMatrix(m[0], m[1], m[2], m[3], o[0], o[1]), P.setCharacterSqueeze(squeeze), P.showText(P.PDFHexString.of(hex(run))));
      placed++;
    });
    ops.push(P.endText(), P.popGraphicsState());
    if (placed) page.pushOperators.apply(page, ops);
    return placed;
  }

  function run() {
    if (!files.length || running) return;
    running = true; cancelled = false;
    $('go').disabled = true; $('cancel').hidden = false;
    $('pages').innerHTML = '';
    var lang = $('lang').value, scale = Number($('quality').value), skipText = $('skip').checked;
    var worker, P, out, pdf, srcBytes, total = 0, made = 0, skipped = 0;
    var isPdf = /pdf/i.test(files[0].type) || /\.pdf$/i.test(files[0].name);
    var check = function () { if (cancelled) throw new Error('cancelled'); };

    status('Loading the text-recognition engine...');
    progress(2);
    Promise.all([load(LIBS.pdflib), load(LIBS.tesseract), isPdf ? load(LIBS.pdfjs) : null]).then(function () {
      P = window.PDFLib;
      if (isPdf) window.pdfjsLib.GlobalWorkerOptions.workerSrc = LIBS.pdfjsWorker;
      status('Loading ' + $('lang').selectedOptions[0].textContent + ' language data...');
      return Tesseract.createWorker(lang, 1, { workerPath: LIBS.workerPath, corePath: LIBS.corePath, langPath: LIBS.langPath(lang) });
    }).then(function (w) {
      worker = w;
      // Keep Japanese, Chinese and Korean text together rather than spacing every character
      var params = {};
      if (CJK.test(lang)) params.preserve_interword_spaces = '1';
      if (/_vert$/.test(lang)) params.tessedit_pageseg_mode = '5'; // a block of vertical columns
      return Object.keys(params).length ? worker.setParameters(params) : null;
    }).then(function () {
      check();
      if (!isPdf) return P.PDFDocument.create();
      return files[0].arrayBuffer().then(function (buf) {
        srcBytes = new Uint8Array(buf);
        return Promise.all([window.pdfjsLib.getDocument({ data: srcBytes.slice() }).promise, P.PDFDocument.load(srcBytes, { ignoreEncryption: true })]);
      }).then(function (r) { pdf = r[0]; return r[1]; });
    }).then(function (doc) {
      out = doc;
      textFont = null;
      total = isPdf ? pdf.numPages : files.length;
      var chain = Promise.resolve();
      for (var i = 0; i < total; i++) (function (i) {
        chain = chain.then(function () {
          check();
          status('Reading page ' + (i + 1) + ' of ' + total + '...');
          var box = thumb(i);
          box.classList.add('busy');
          var step = isPdf ? pdf.getPage(i + 1).then(function (pg) {
            return pg.getTextContent().then(function (tc) {
              var chars = tc.items.reduce(function (n, it) { return n + (it.str || '').trim().length; }, 0);
              var vp = pg.getViewport({ scale: scale });
              var c = document.createElement('canvas');
              c.width = Math.ceil(vp.width); c.height = Math.ceil(vp.height);
              return pg.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise.then(function () {
                return { canvas: c, has: chars > 40, corners: [vp.convertToPdfPoint(0, 0), vp.convertToPdfPoint(c.width, 0), vp.convertToPdfPoint(0, c.height)], page: out.getPage(i) };
              });
            });
          }) : imageToCanvas(files[i]).then(function (c) {
            var wPt = c.width * 72 / 150, hPt = c.height * 72 / 150;
            return new Promise(function (ok) { c.toBlob(ok, 'image/jpeg', 0.85); }).then(function (blob) { return blob.arrayBuffer(); }).then(function (jpg) { return out.embedJpg(jpg); }).then(function (img) {
              var page = out.addPage([wPt, hPt]);
              page.drawImage(img, { x: 0, y: 0, width: wPt, height: hPt });
              return { canvas: c, has: false, corners: [[0, hPt], [wPt, hPt], [0, 0]], page: page };
            });
          });
          return step.then(function (s) {
            box.insertAdjacentHTML('afterbegin', '<img alt="" src="' + s.canvas.toDataURL('image/jpeg', 0.4) + '">');
            if (s.has && skipText) { box.classList.add('skip'); skipped++; return; }
            var res;
            return worker.recognize(s.canvas, { pdfTitle: 'Readable', pdfTextOnly: true }, { pdf: !textFont, blocks: true, text: false, hocr: false, tsv: false }).then(function (r) {
              check();
              res = r;
              return textFont ? null : loadFont(out, new Uint8Array(res.data.pdf), P);
            }).then(function () {
              addTextLayer(s.page, wordsOf(res.data), s.corners, s.canvas.width, s.canvas.height, /_vert$/.test(lang), P);
              box.classList.add('done'); made++;
              $('done').textContent = made;
            });
          }).then(function () {
            box.classList.remove('busy');
            progress(5 + ((i + 1) / total) * 90);
          });
        });
      })(i);
      return chain;
    }).then(function () {
      check();
      status('Saving your PDF...');
      return out.save();
    }).then(function (bytes) {
      var base = files.length === 1 ? files[0].name.replace(/\.[^.]+$/, '') : 'Scanned pages';
      var a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
      a.download = base + ' (searchable).pdf';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 20000);
      progress(100);
      status('Done. ' + made + ' page' + (made === 1 ? '' : 's') + ' made searchable' + (skipped ? ', ' + skipped + ' already had text' : '') + '. Your PDF has downloaded.');
    }).catch(function (e) {
      status(cancelled ? 'Cancelled. Nothing was saved.' : 'Something went wrong: ' + (e && e.message ? e.message : e));
      if (!cancelled) console.error(e);
    }).then(function () {
      running = false;
      $('go').disabled = !files.length; $('cancel').hidden = true;
      if (worker) worker.terminate();
    });
  }

  $('file').addEventListener('change', function () { choose(this.files); });
  var drop = $('drop');
  ['dragenter', 'dragover'].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.add('over'); }); });
  ['dragleave', 'drop'].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.remove('over'); }); });
  drop.addEventListener('drop', function (e) { choose(e.dataTransfer.files); });
  $('go').onclick = run;
  $('cancel').onclick = function () { cancelled = true; status('Cancelling...'); };
})();
