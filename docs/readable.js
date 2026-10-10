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

  function wordsOf(data) {
    if (data.words && data.words.length) return data.words;
    var out = [];
    (data.blocks || []).forEach(function (b) { (b.paragraphs || []).forEach(function (p) { (p.lines || []).forEach(function (l) { (l.words || []).forEach(function (w) { out.push(w); }); }); }); });
    return out;
  }

  // Latin-1 only: Helvetica in a PDF cannot encode other characters
  function safe(text) { return text.replace(/[\u2018\u2019]/g, "'").replace(/[\u201c\u201d]/g, '"').replace(/[\u2013\u2014]/g, '-').replace(/[^\x20-\x7e\xa0-\xff]/g, ''); }

  function addTextLayer(page, words, toPdf, font, P) {
    page.pushOperators(P.pushGraphicsState(), P.setTextRenderingMode(P.TextRenderingMode.Invisible));
    var placed = 0;
    words.forEach(function (w) {
      var text = safe((w.text || '').trim());
      if (!text || w.confidence < 20) return;
      var a = toPdf(w.bbox.x0, w.bbox.y1), b = toPdf(w.bbox.x1, w.bbox.y0);
      var x = Math.min(a[0], b[0]), y = Math.min(a[1], b[1]);
      var width = Math.abs(b[0] - a[0]), height = Math.abs(b[1] - a[1]);
      if (width < 1 || height < 1) return;
      var unit = font.widthOfTextAtSize(text, 1);
      var size = unit > 0 ? Math.min(width / unit, height * 1.6) : height;
      try {
        page.drawText(text, { x: x, y: y + height * 0.18, size: Math.max(1, size), font: font });
        placed++;
      } catch (e) {}
    });
    page.pushOperators(P.popGraphicsState());
    return placed;
  }

  function run() {
    if (!files.length || running) return;
    running = true; cancelled = false;
    $('go').disabled = true; $('cancel').hidden = false;
    $('pages').innerHTML = '';
    var lang = $('lang').value, scale = Number($('quality').value), skipText = $('skip').checked;
    var worker, P, out, font, pdf, srcBytes, total = 0, made = 0, skipped = 0;
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
      check();
      if (!isPdf) return P.PDFDocument.create();
      return files[0].arrayBuffer().then(function (buf) {
        srcBytes = new Uint8Array(buf);
        return Promise.all([window.pdfjsLib.getDocument({ data: srcBytes.slice() }).promise, P.PDFDocument.load(srcBytes, { ignoreEncryption: true })]);
      }).then(function (r) { pdf = r[0]; return r[1]; });
    }).then(function (doc) {
      out = doc;
      return out.embedFont(P.StandardFonts.Helvetica);
    }).then(function (f) {
      font = f;
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
                return { canvas: c, has: chars > 40, toPdf: function (x, y) { return vp.convertToPdfPoint(x, y); }, page: out.getPage(i) };
              });
            });
          }) : imageToCanvas(files[i]).then(function (c) {
            var wPt = c.width * 72 / 150, hPt = c.height * 72 / 150;
            return new Promise(function (ok) { c.toBlob(ok, 'image/jpeg', 0.85); }).then(function (blob) { return blob.arrayBuffer(); }).then(function (jpg) { return out.embedJpg(jpg); }).then(function (img) {
              var page = out.addPage([wPt, hPt]);
              page.drawImage(img, { x: 0, y: 0, width: wPt, height: hPt });
              return { canvas: c, has: false, toPdf: function (x, y) { return [x * wPt / c.width, hPt - y * hPt / c.height]; }, page: page };
            });
          });
          return step.then(function (s) {
            box.insertAdjacentHTML('afterbegin', '<img alt="" src="' + s.canvas.toDataURL('image/jpeg', 0.4) + '">');
            if (s.has && skipText) { box.classList.add('skip'); skipped++; return; }
            return worker.recognize(s.canvas, {}, { text: true, blocks: true, hocr: false, tsv: false }).then(function (res) {
              check();
              addTextLayer(s.page, wordsOf(res.data), s.toPdf, font, P);
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
