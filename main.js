/* =========================================================================
   PDF sin Registro — motor de la herramienta.
   100% cliente: ningun archivo sale del navegador. Sin peticiones de red
   salvo las propias librerias del sitio (mismo origen).
   ========================================================================= */
(function () {
  "use strict";

  var B = window.__BRAND__ || {};
  var LIMITS = B.limites || { tamanoMB: 100, paginas: 500 };

  /* ---------- helpers ---------- */
  function $(s, c) { return (c || document).querySelector(s); }
  function $$(s, c) { return Array.prototype.slice.call((c || document).querySelectorAll(s)); }
  function safe(fn, name) { try { return fn(); } catch (e) { console.warn("[" + name + "] fallo:", e); } }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function fmtBytes(n) {
    if (!n && n !== 0) return "-";
    if (n < 1024) return n + " B";
    if (n < 1048576) return (n / 1024).toFixed(0) + " KB";
    return (n / 1048576).toFixed(2).replace(".", ",") + " MB";
  }
  function saveBlob(blob, name) {
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 4000);
  }
  function loadScript(src) {
    return new Promise(function (ok, err) {
      if (document.querySelector('script[data-lib="' + src + '"]')) return ok();
      var s = document.createElement("script");
      s.src = src; s.dataset.lib = src;
      s.onload = function () { ok(); };
      s.onerror = function () { err(new Error("No se pudo cargar " + src)); };
      document.body.appendChild(s);
    });
  }

  /* ---------- estado ---------- */
  var S = {
    docs: [],     // {id, name, size, kind, bytes:Uint8Array, pdf:pdfjsDoc, textish:bool}
    // paginas de PDF: {uid, kind:"pdf", docId, idx, base, rot, wU, hU, ov:[]}
    // paginas de imagen: {uid, kind:"img", docId, mime, data, bitmap, iw, ih,
    //                     base:0, rot, wU, hU, ov:[]}  (wU/hU derivados de S.imgFit)
    pages: [],
    mode: "organizar",
    imgFit: "a4",   // "a4" | "original": tamano de pagina de las imagenes
    avisoCarga: "",
    busy: false,
    seqD: 0, seqP: 0
  };

  var A4 = { w: 595.28, h: 841.89 };   // puntos
  var MARGEN_A4 = 24;                  // ~8,5 mm

  // Recursos que pdf.js descarga SOLO si el documento concreto los necesita:
  // descomprimir JBIG2 (casi todo escaneado en blanco y negro) y JPEG2000,
  // las tipografias estandar no incrustadas y los mapas de caracteres CJK.
  // Sin ellos un escaneado normal se rasteriza en blanco, que es justo el
  // caso principal de esta herramienta.
  //
  // OJO: quien pide estos archivos es el WORKER, y una ruta relativa se
  // resuelve contra la URL del worker, no contra la de la pagina. Con
  // "lib/vendor/pdfjs/..." el worker acaba pidiendo
  // "lib/vendor/pdfjs/lib/vendor/pdfjs/..." y todo da 404 en silencio. Por
  // eso se convierten a URL absoluta contra la base del documento, que ademas
  // sigue funcionando si la web cuelga de un subdirectorio.
  function urlRecurso(rel) {
    try { return new URL(rel, document.baseURI).href; } catch (e) { return rel; }
  }
  var PDFJS_RES = {
    wasmUrl: urlRecurso("lib/vendor/pdfjs/wasm/"),
    standardFontDataUrl: urlRecurso("lib/vendor/pdfjs/standard_fonts/"),
    cMapUrl: urlRecurso("lib/vendor/pdfjs/cmaps/"),
    cMapPacked: true,
    iccUrl: urlRecurso("lib/vendor/pdfjs/iccs/")
  };
  function docOpts(bytes) {
    var o = { data: bytes };
    for (var k in PDFJS_RES) if (PDFJS_RES.hasOwnProperty(k)) o[k] = PDFJS_RES[k];
    return o;
  }

  var card, grid, dz, fileInput, bar, barLabel, resultBox, noticeBox;
  var pdfjsLib = null, pdfLibLoaded = false;

  /* ---------- carga perezosa de motores ---------- */
  function getPdfjs() {
    if (pdfjsLib) return Promise.resolve(pdfjsLib);
    return import("./lib/vendor/pdfjs/compat.mjs").then(function () {
      return import("./lib/vendor/pdfjs/pdf.min.mjs");
    }).then(function (mod) {
      // El worker es otro contexto JS: arranca por worker-boot.mjs, que
      // instala el mismo shim antes de cargar el worker vendorizado.
      mod.GlobalWorkerOptions.workerSrc = "lib/vendor/pdfjs/worker-boot.mjs";
      pdfjsLib = mod;
      return mod;
    });
  }
  function getPdfLib() {
    if (pdfLibLoaded) return Promise.resolve(window.PDFLib);
    return loadScript("lib/vendor/pdf-lib.min.js").then(function () {
      pdfLibLoaded = true;
      return window.PDFLib;
    });
  }

  /* ---------- UI: estados, avisos, progreso ---------- */
  function setState(st) {
    if (card) card.dataset.state = st;
    var pw = $("#progressWrap");
    if (pw) pw.hidden = (st !== "working");
  }
  function setProgress(frac, label) {
    if (!bar) return;
    bar.style.width = Math.max(0, Math.min(1, frac || 0)) * 100 + "%";
    if (barLabel && label != null) barLabel.textContent = label;
  }
  function notice(kind, html) {
    if (!noticeBox) return;
    if (!html) { noticeBox.innerHTML = ""; return; }
    noticeBox.innerHTML = '<div class="notice notice--' + kind + '">' + html + "</div>";
  }

  var ICON_ROT = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-3-6.7"/><path d="M21 3v6h-6"/></svg>';
  var ICON_PEN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>';
  var ICON_DEL = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/></svg>';
  var ICON_L = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>';
  var ICON_R = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18l6-6-6-6"/></svg>';

  /* ---------- geometria ---------- */
  function totalRot(p) { return ((p.base + p.rot) % 360 + 360) % 360; }
  function dispSize(p) {
    var t = totalRot(p);
    return (t === 90 || t === 270) ? { w: p.hU, h: p.wU } : { w: p.wU, h: p.hU };
  }
  // (vx,vy) = esquina superior izquierda en coordenadas de pantalla (escala 1)
  // dh = alto de la caja. Devuelve ancla y giro en espacio PDF.
  function toPdf(p, vx, vy, dh, mb) {
    var t = totalRot(p), w0 = p.wU, h0 = p.hU, x, y, rot;
    if (t === 90) { x = vy + dh; y = vx; rot = 90; }
    else if (t === 180) { x = w0 - vx; y = vy + dh; rot = 180; }
    else if (t === 270) { x = w0 - (vy + dh); y = h0 - vx; rot = 270; }
    else { x = vx; y = h0 - (vy + dh); rot = 0; }
    return { x: x + (mb ? mb.x : 0), y: y + (mb ? mb.y : 0), rot: rot };
  }
  function hexRgb(hex) {
    var m = /^#?([0-9a-f]{6})$/i.exec(hex || "#111111");
    var n = parseInt(m ? m[1] : "111111", 16);
    return { r: ((n >> 16) & 255) / 255, g: ((n >> 8) & 255) / 255, b: (n & 255) / 255 };
  }
  // Helvetica estandar solo codifica WinAnsi: fuera lo que no entra.
  function winAnsi(s) { return String(s).replace(/[^\n\x20-\x7E\xA1-\xFF€‘’“”–—]/g, ""); }

  /* ---------- paginas hechas de una imagen ---------- */
  // El tamano de pagina de una imagen no es un dato del archivo: lo elige el
  // usuario (ajustar a A4, o el tamano real de la imagen a 96 ppp).
  function tamanoPaginaImagen(p) {
    if (S.imgFit === "original") return { w: p.iw * 0.75, h: p.ih * 0.75 };
    return (p.iw > p.ih) ? { w: A4.h, h: A4.w } : { w: A4.w, h: A4.h };
  }
  // Rectangulo que ocupa la imagen dentro de la pagina, en coordenadas de
  // pagina con origen arriba-izquierda.
  function rectImagen(p) {
    var m = (S.imgFit === "original") ? 0 : MARGEN_A4;
    var k = Math.min((p.wU - m * 2) / p.iw, (p.hU - m * 2) / p.ih);
    var w = p.iw * k, h = p.ih * k;
    return { x: (p.wU - w) / 2, y: (p.hU - h) / 2, w: w, h: h };
  }
  function refrescarPaginasImagen() {
    S.pages.forEach(function (p) {
      if (p.kind !== "img") return;
      var t = tamanoPaginaImagen(p);
      p.wU = t.w; p.hU = t.h;
      var ds = dispSize(p);   // las superposiciones no pueden quedar fuera
      p.ov.forEach(function (o) {
        o.x = Math.max(0, Math.min(ds.w - 6, o.x));
        o.y = Math.max(0, Math.min(ds.h - 6, o.y));
      });
    });
  }

  /* ---------- entrada de archivos ---------- */
  function esPdf(f) {
    return /\.pdf$/i.test(f.name || "") || f.type === "application/pdf";
  }
  function esImagen(f) {
    return /^image\//.test(f.type || "") || /\.(jpe?g|png|webp|gif|bmp|avif)$/i.test(f.name || "");
  }
  function pickFiles(list) {
    var files = Array.prototype.slice.call(list || []);
    files = files.filter(function (f) { return f && (esPdf(f) || esImagen(f)); });
    if (!files.length) { notice("warn", "Solo se admiten archivos PDF e imágenes (JPG, PNG, WebP)."); return; }
    addFiles(files);
  }

  // Decodifica una imagen. createImageBitmap es lo normal en 2026; el <img>
  // de reserva mantiene viva la herramienta en navegadores que no lo tengan.
  function decodificarImagen(f) {
    if (window.createImageBitmap) return createImageBitmap(f);
    return new Promise(function (ok, err) {
      var img = new Image(), u = URL.createObjectURL(f);
      img.onload = function () { ok(img); };
      img.onerror = function () { URL.revokeObjectURL(u); err(new Error("imagen ilegible")); };
      img.src = u;
    });
  }

  function cargarImagen(f, skipped) {
    return decodificarImagen(f).then(function (bmp) {
      var iw = bmp.naturalWidth || bmp.width, ih = bmp.naturalHeight || bmp.height;
      if (!iw || !ih) throw new Error("imagen vacía");
      var id = "d" + (++S.seqD);
      S.docs.push({ id: id, name: f.name, size: f.size, kind: "img", textish: false });

      var prep;
      if (f.type === "image/png" || f.type === "image/jpeg") {
        // PDF admite PNG y JPEG tal cual: se incrustan sin recomprimir
        prep = f.arrayBuffer().then(function (ab) {
          return { mime: f.type, data: new Uint8Array(ab) };
        });
      } else {
        // WebP, GIF, BMP, AVIF: el formato PDF no los admite, se pasan a JPEG
        var c = document.createElement("canvas");
        c.width = iw; c.height = ih;
        var ctx = c.getContext("2d");
        ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, iw, ih);
        ctx.drawImage(bmp, 0, 0);
        prep = Promise.resolve({ mime: "image/jpeg", data: c.toDataURL("image/jpeg", 0.92) });
      }

      return prep.then(function (r) {
        var pg = {
          uid: "p" + (++S.seqP), kind: "img", docId: id,
          mime: r.mime, data: r.data, bitmap: bmp, iw: iw, ih: ih,
          base: 0, rot: 0, wU: 0, hU: 0, ov: []
        };
        var t = tamanoPaginaImagen(pg);
        pg.wU = t.w; pg.hU = t.h;
        S.pages.push(pg);
      });
    })["catch"](function () {
      skipped.push(esc(f.name) + " (no se pudo leer la imagen)");
    });
  }

  function addFiles(files) {
    if (S.busy) return;
    S.busy = true;
    notice("");
    setState("working");
    setProgress(0.02, "Abriendo los archivos en tu navegador…");

    // El motor de PDF solo se descarga si hace falta: convertir imágenes a PDF
    // no lo necesita y así esa ruta es instantánea.
    var hayPdf = files.some(esPdf);
    (hayPdf ? getPdfjs() : Promise.resolve(null)).then(function (lib) {
      var i = 0, skipped = [];
      function next() {
        if (i >= files.length) return Promise.resolve();
        var f = files[i++];
        setProgress(0.1 + 0.85 * (i / files.length), "Leyendo " + f.name + "…");
        if (f.size > LIMITS.tamanoMB * 1048576) {
          skipped.push(esc(f.name) + " (mas de " + LIMITS.tamanoMB + " MB)");
          return next();
        }
        if (!esPdf(f)) return cargarImagen(f, skipped).then(next);
        return f.arrayBuffer().then(function (ab) {
          var bytes = new Uint8Array(ab);
          return lib.getDocument(docOpts(bytes.slice(0))).promise.then(function (doc) {
            var id = "d" + (++S.seqD);
            var rec = { id: id, name: f.name, size: f.size, kind: "pdf", bytes: bytes, pdf: doc, textish: false };
            S.docs.push(rec);
            var chain = Promise.resolve();
            var n = Math.min(doc.numPages, LIMITS.paginas);
            for (var k = 1; k <= n; k++) {
              (function (k) {
                chain = chain.then(function () {
                  return doc.getPage(k).then(function (pg) {
                    var v = pg.view; // [x0,y0,x1,y1] sin rotar
                    S.pages.push({
                      uid: "p" + (++S.seqP), kind: "pdf", docId: id, idx: k - 1,
                      base: ((pg.rotate || 0) % 360 + 360) % 360, rot: 0,
                      wU: Math.abs(v[2] - v[0]), hU: Math.abs(v[3] - v[1]), ov: []
                    });
                  });
                });
              })(k);
            }
            // Deteccion de PDF con capa de texto: se muestrean hasta 3 paginas
            // y se avisa si hay una media apreciable de caracteres por pagina,
            // porque comprimir rasteriza y ese texto se pierde.
            chain = chain.then(function () {
              var muestra = Math.min(3, doc.numPages), total = 0, c = Promise.resolve();
              for (var s2 = 1; s2 <= muestra; s2++) {
                (function (s2) {
                  c = c.then(function () {
                    return doc.getPage(s2).then(function (pg) { return pg.getTextContent(); })
                      .then(function (tc) {
                        total += (tc.items || []).reduce(function (a, it) { return a + (it.str || "").length; }, 0);
                      })["catch"](function () { });
                  });
                })(s2);
              }
              return c.then(function () { rec.textish = (total / muestra) > 40; });
            });
            return chain;
          })["catch"](function (err) {
            var msg = (err && /password/i.test(err.name + " " + err.message))
              ? " (protegido con contraseña)" : "";
            skipped.push(esc(f.name) + msg);
          });
        }).then(next);
      }
      return next().then(function () { return skipped; });
    }).then(function (skipped) {
      S.busy = false;
      S.avisoCarga = (skipped && skipped.length)
        ? "No se pudieron abrir: " + skipped.join(", ") + "." : "";
      if (!S.pages.length) {
        setState("idle");
        notice(S.avisoCarga ? "warn" : "", S.avisoCarga);
        return;
      }
      renderPages();
      updateWarnings();
      setState("ready");
    })["catch"](function (err) {
      S.busy = false;
      console.error(err);
      setState("error");
      $("#errMsg").textContent = "No hemos podido abrir el PDF en este navegador. Prueba con otro archivo o con Chrome/Firefox actualizados.";
    });
  }

  /* ---------- rejilla de paginas ---------- */
  var thumbObserver = null;
  function renderPages() {
    if (!grid) return;
    var html = S.pages.map(function (p, i) {
      var d = docOf(p.docId);
      var flags = p.ov.length ? '<span class="page-card__flag">editada</span>' : "";
      return '<div class="page-card" draggable="true" data-uid="' + p.uid + '">' +
        '<span class="page-card__src">' + esc(d ? d.name.replace(/\.pdf$/i, "") : "") + "</span>" + flags +
        '<div class="page-card__thumb" data-thumb="' + p.uid + '"></div>' +
        '<div class="page-card__bar">' +
          '<span class="n">' + (i + 1) + "</span>" +
          '<button type="button" data-act="left"  title="Mover antes" aria-label="Mover antes">' + ICON_L + "</button>" +
          '<button type="button" data-act="right" title="Mover después" aria-label="Mover después">' + ICON_R + "</button>" +
          '<button type="button" data-act="rot"   title="Girar 90º" aria-label="Girar 90 grados">' + ICON_ROT + "</button>" +
          '<button type="button" data-act="edit"  title="Añadir texto o firma" aria-label="Añadir texto o firma">' + ICON_PEN + "</button>" +
          '<button type="button" data-act="del"   title="Eliminar página" aria-label="Eliminar página">' + ICON_DEL + "</button>" +
        "</div></div>";
    }).join("");
    grid.innerHTML = html;

    var cnt = $("#pageCount");
    if (cnt) {
      cnt.textContent = S.pages.length + " página" + (S.pages.length === 1 ? "" : "s") +
        " · " + S.docs.length + " archivo" + (S.docs.length === 1 ? "" : "s");
    }

    if (thumbObserver) thumbObserver.disconnect();
    if ("IntersectionObserver" in window) {
      thumbObserver = new IntersectionObserver(function (entries) {
        entries.forEach(function (e) {
          if (e.isIntersecting) { thumbObserver.unobserve(e.target); drawThumb(e.target); }
        });
      }, { root: grid, rootMargin: "300px", threshold: 0.01 });
      $$("[data-thumb]", grid).forEach(function (el) { thumbObserver.observe(el); });
      setTimeout(function () { $$("[data-thumb]", grid).forEach(drawThumb); }, 2500); // red de seguridad
    } else {
      $$("[data-thumb]", grid).forEach(drawThumb);
    }
  }

  function docOf(id) { for (var i = 0; i < S.docs.length; i++) if (S.docs[i].id === id) return S.docs[i]; return null; }
  function pageOf(uid) { for (var i = 0; i < S.pages.length; i++) if (S.pages[i].uid === uid) return S.pages[i]; return null; }

  // Pinta una pagina (de PDF o de imagen) en un lienzo, ya rotada.
  // `scale` va de unidades de pagina a pixeles de lienzo.
  function pintarPagina(p, c, scale) {
    var ds = dispSize(p);
    c.width = Math.max(1, Math.round(ds.w * scale));
    c.height = Math.max(1, Math.round(ds.h * scale));

    if (p.kind === "img") {
      var ctx = c.getContext("2d"), t = totalRot(p);
      ctx.save();
      // llevar el origen al de la pagina sin rotar, dentro del lienzo rotado
      if (t === 90) { ctx.translate(c.width, 0); ctx.rotate(Math.PI / 2); }
      else if (t === 180) { ctx.translate(c.width, c.height); ctx.rotate(Math.PI); }
      else if (t === 270) { ctx.translate(0, c.height); ctx.rotate(-Math.PI / 2); }
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, p.wU * scale, p.hU * scale);
      var r = rectImagen(p);
      if (p.bitmap) ctx.drawImage(p.bitmap, r.x * scale, r.y * scale, r.w * scale, r.h * scale);
      ctx.restore();
      return Promise.resolve();
    }

    var d = docOf(p.docId);
    if (!d || !d.pdf) return Promise.reject(new Error("documento no disponible"));
    return d.pdf.getPage(p.idx + 1).then(function (pg) {
      var vp = pg.getViewport({ scale: scale, rotation: totalRot(p) });
      return pg.render({ canvas: c, canvasContext: c.getContext("2d"), viewport: vp }).promise;
    });
  }

  function drawThumb(box) {
    if (!box || box.dataset.done === "1") return;
    var p = pageOf(box.dataset.thumb);
    if (!p) return;
    box.dataset.done = "1";
    var ds = dispSize(p);
    var scale = (150 * Math.min(2, window.devicePixelRatio || 1)) / ds.w;
    var c = document.createElement("canvas");
    c.style.width = "100%"; c.style.height = "auto";
    pintarPagina(p, c, scale).then(function () {
      box.innerHTML = "";
      box.appendChild(c);
    })["catch"](function (e) { console.warn("miniatura", e); box.textContent = "—"; });
  }

  function refreshThumb(uid) {
    var box = grid && grid.querySelector('[data-thumb="' + uid + '"]');
    if (!box) return;
    box.dataset.done = "0"; box.innerHTML = "";
    drawThumb(box);
  }

  /* ---------- acciones sobre paginas ---------- */
  function movePage(uid, delta) {
    var i = S.pages.findIndex(function (p) { return p.uid === uid; });
    var j = i + delta;
    if (i < 0 || j < 0 || j >= S.pages.length) return;
    var tmp = S.pages[i]; S.pages[i] = S.pages[j]; S.pages[j] = tmp;
    renderPages();
  }
  function removePage(uid) {
    S.pages = S.pages.filter(function (p) { return p.uid !== uid; });
    S.docs = S.docs.filter(function (d) {
      return S.pages.some(function (p) { return p.docId === d.id; });
    });
    if (!S.pages.length) { setState("idle"); notice(""); return; }
    renderPages(); updateWarnings();
  }
  function rotatePage(uid) {
    var p = pageOf(uid); if (!p) return;
    p.rot = (p.rot + 90) % 360;
    refreshThumb(uid);
  }

  // Que paneles de opciones tienen sentido en el modo actual
  function updateOptions() {
    var m = S.mode;
    var comp = $("#optCompress");
    var hayImg = S.pages.some(function (p) { return p.kind === "img"; });
    function set(id, on) { var e = $(id); if (e) e.hidden = !on; }
    set("#compressBox", salidaEsPdf(m));
    set("#compressOpts", salidaEsPdf(m) && !!(comp && comp.checked));
    set("#splitOpts", m === "dividir");
    set("#rangeBox", m === "dividir" && (($("#optSplitMode") || {}).value === "rangos"));
    set("#imgOpts", m === "imagen-a-pdf" || hayImg);
    set("#rasterOpts", m === "pdf-a-imagen");
  }

  function updateWarnings() {
    updateOptions();
    var comp = $("#optCompress");
    var textish = S.docs.some(function (d) { return d.textish; });
    var partes = [];
    if (S.avisoCarga) partes.push(S.avisoCarga);
    if (salidaEsPdf(S.mode) && comp && comp.checked && textish) {
      partes.push("Alguno de tus PDF contiene <b>texto seleccionable</b>. " +
        "La compresión convierte cada página en imagen: el archivo pesará menos en documentos escaneados, " +
        "pero el texto dejará de poder copiarse o buscarse. Desactiva la compresión si necesitas mantenerlo.");
    }
    notice(partes.length ? "warn" : "", partes.length ? "<span>" + partes.join(" ") + "</span>" : "");
  }

  /* ---------- reordenar arrastrando ---------- */
  var dragUid = null;
  function initDnD() {
    if (!grid) return;
    grid.addEventListener("dragstart", function (e) {
      var cardEl = e.target.closest && e.target.closest(".page-card");
      if (!cardEl) return;
      dragUid = cardEl.dataset.uid;
      cardEl.classList.add("is-dragging");
      try { e.dataTransfer.setData("text/plain", dragUid); e.dataTransfer.effectAllowed = "move"; } catch (_) { }
    });
    grid.addEventListener("dragend", function () {
      dragUid = null;
      $$(".page-card", grid).forEach(function (el) { el.classList.remove("is-dragging", "is-target"); });
    });
    grid.addEventListener("dragover", function (e) {
      if (!dragUid) return;
      e.preventDefault();
      var over = e.target.closest && e.target.closest(".page-card");
      $$(".page-card", grid).forEach(function (el) { el.classList.toggle("is-target", el === over && el.dataset.uid !== dragUid); });
    });
    grid.addEventListener("drop", function (e) {
      if (!dragUid) return;
      e.preventDefault(); e.stopPropagation();
      var over = e.target.closest && e.target.closest(".page-card");
      if (!over || over.dataset.uid === dragUid) return;
      var from = S.pages.findIndex(function (p) { return p.uid === dragUid; });
      var to = S.pages.findIndex(function (p) { return p.uid === over.dataset.uid; });
      if (from < 0 || to < 0) return;
      var moved = S.pages.splice(from, 1)[0];
      S.pages.splice(to, 0, moved);
      dragUid = null;
      renderPages();
    });
    grid.addEventListener("click", function (e) {
      var b = e.target.closest && e.target.closest("button[data-act]");
      if (!b) return;
      var uid = b.closest(".page-card").dataset.uid;
      var act = b.dataset.act;
      if (act === "left") movePage(uid, -1);
      else if (act === "right") movePage(uid, 1);
      else if (act === "rot") rotatePage(uid);
      else if (act === "del") removePage(uid);
      else if (act === "edit") openEditor(uid);
    });
  }

  /* ---------- editor: texto y firma ---------- */
  var ed = {};
  function openEditor(uid) {
    var p = pageOf(uid), d = p && docOf(p.docId);
    if (!p || !d) return;
    ed.uid = uid;
    ed.dlg = $("#editorDlg");
    ed.stage = $("#edStage");
    ed.stage.innerHTML = "";
    ed.sel = null;
    $("#edTitle").textContent = "Editar página " + (S.pages.indexOf(p) + 1);

    var ds = dispSize(p);
    var maxW = Math.min(780, (window.innerWidth || 800) - 90);
    var maxH = (window.innerHeight || 800) * 0.56;
    ed.scale = Math.min(maxW / ds.w, maxH / ds.h);
    ed.stage.style.width = Math.round(ds.w * ed.scale) + "px";
    ed.stage.style.height = Math.round(ds.h * ed.scale) + "px";

    var dpr = Math.min(2, window.devicePixelRatio || 1);
    var lienzo = document.createElement("canvas");
    lienzo.style.width = Math.round(ds.w * ed.scale) + "px";
    lienzo.style.height = Math.round(ds.h * ed.scale) + "px";
    pintarPagina(p, lienzo, ed.scale * dpr).then(function () {
      ed.stage.insertBefore(lienzo, ed.stage.firstChild);
    })["catch"](function (e) { console.warn("editor", e); });

    p.ov.forEach(function (o) { mountOverlay(o); });
    if (typeof ed.dlg.showModal === "function") ed.dlg.showModal(); else ed.dlg.setAttribute("open", "");
    if (sigApi) sigApi.clear();   // ahora el lienzo ya tiene tamano real
  }

  function mountOverlay(o) {
    var el = document.createElement("div");
    el.className = "ov ov--" + o.type;
    el.dataset.oid = o.id;
    el.style.left = (o.x * ed.scale) + "px";
    el.style.top = (o.y * ed.scale) + "px";
    if (o.type === "text") {
      el.style.fontSize = (o.size * ed.scale) + "px";
      el.style.fontFamily = "Helvetica, Arial, sans-serif";
      el.style.lineHeight = "1.2";
      el.style.color = o.color;
      el.textContent = o.text;
    } else {
      el.style.width = (o.w * ed.scale) + "px";
      el.style.height = (o.h * ed.scale) + "px";
      var img = document.createElement("img");
      img.src = o.data; img.alt = "Firma";
      el.appendChild(img);
      var grip = document.createElement("span");
      grip.className = "ov__grip"; grip.dataset.grip = "1";
      el.appendChild(grip);
    }
    var del = document.createElement("button");
    del.type = "button"; del.className = "ov__del"; del.innerHTML = "×";
    del.title = "Quitar";
    el.appendChild(del);
    ed.stage.appendChild(el);
    wireOverlay(el, o);
  }

  function wireOverlay(el, o) {
    var page = pageOf(ed.uid);
    var drag = null;
    el.addEventListener("pointerdown", function (e) {
      if (e.target.classList.contains("ov__del")) return;
      $$(".ov", ed.stage).forEach(function (x) { x.classList.remove("is-sel"); });
      el.classList.add("is-sel");
      var resizing = e.target.dataset && e.target.dataset.grip === "1";
      drag = { x: e.clientX, y: e.clientY, ox: o.x, oy: o.y, ow: o.w, oh: o.h, resize: resizing };
      el.setPointerCapture(e.pointerId);
      e.preventDefault();
    });
    el.addEventListener("pointermove", function (e) {
      if (!drag) return;
      var dx = (e.clientX - drag.x) / ed.scale, dy = (e.clientY - drag.y) / ed.scale;
      if (drag.resize) {
        var ratio = drag.oh / drag.ow;
        o.w = Math.max(24, drag.ow + dx);
        o.h = o.w * ratio;
        el.style.width = (o.w * ed.scale) + "px";
        el.style.height = (o.h * ed.scale) + "px";
      } else {
        var ds = dispSize(page);
        o.x = Math.max(0, Math.min(ds.w - 6, drag.ox + dx));
        o.y = Math.max(0, Math.min(ds.h - 6, drag.oy + dy));
        el.style.left = (o.x * ed.scale) + "px";
        el.style.top = (o.y * ed.scale) + "px";
      }
    });
    el.addEventListener("pointerup", function () { drag = null; });
    el.addEventListener("pointercancel", function () { drag = null; });
    el.querySelector(".ov__del").addEventListener("click", function () {
      page.ov = page.ov.filter(function (x) { return x.id !== o.id; });
      el.remove();
    });
  }

  var oidSeq = 0;
  function addTextOverlay() {
    var p = pageOf(ed.uid); if (!p) return;
    var txt = ($("#edText").value || "").trim();
    if (!txt) { $("#edText").focus(); return; }
    var o = {
      id: "o" + (++oidSeq), type: "text", text: winAnsi(txt),
      size: parseFloat($("#edSize").value) || 14,
      color: $("#edColor").value || "#111111",
      x: 40, y: 40
    };
    p.ov.push(o); mountOverlay(o);
  }
  function addSignOverlay(dataUrl, wPx, hPx) {
    var p = pageOf(ed.uid); if (!p) return;
    var ds = dispSize(p);
    var w = Math.min(ds.w * 0.4, 200);
    var o = {
      id: "o" + (++oidSeq), type: "sign", data: dataUrl,
      w: w, h: w * (hPx / wPx), x: ds.w * 0.5, y: ds.h * 0.72
    };
    p.ov.push(o); mountOverlay(o);
  }

  /* firma: lienzo de dibujo */
  var sigApi = null;
  function initSigPad() {
    var pad = $("#sigPad"); if (!pad) return;
    var ctx = pad.getContext("2d");
    var drawing = false, last = null, dirty = false;
    // Ojo: con el dialogo cerrado el lienzo mide 0x0. Si se dimensiona ahi,
    // la firma se dibuja en un canvas de 1x1 y sale vacia. Por eso fit() solo
    // hace algo cuando el elemento tiene tamano real, y se vuelve a llamar al
    // abrir el editor.
    function fit() {
      var r = pad.getBoundingClientRect();
      if (r.width < 10 || r.height < 10) return false;
      var dpr = Math.min(2, window.devicePixelRatio || 1);
      pad.width = Math.round(r.width * dpr);
      pad.height = Math.round(r.height * dpr);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.scale(dpr, dpr);
      ctx.lineWidth = 2.4; ctx.lineCap = "round"; ctx.lineJoin = "round";
      ctx.strokeStyle = "#101018";
      return true;
    }
    fit();
    window.addEventListener("resize", function () { if (!dirty) fit(); });
    function pos(e) { var r = pad.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
    pad.addEventListener("pointerdown", function (e) {
      drawing = true; dirty = true; last = pos(e); pad.setPointerCapture(e.pointerId); e.preventDefault();
    });
    pad.addEventListener("pointermove", function (e) {
      if (!drawing) return;
      var p = pos(e);
      ctx.beginPath();
      ctx.moveTo(last.x, last.y);
      ctx.quadraticCurveTo(last.x, last.y, (last.x + p.x) / 2, (last.y + p.y) / 2);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
      last = p;
    });
    pad.addEventListener("pointerup", function () { drawing = false; });
    pad.addEventListener("pointercancel", function () { drawing = false; });
    function clear() {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, pad.width, pad.height);
      dirty = false;
      fit();
    }
    $("#sigClear").addEventListener("click", clear);
    $("#sigAdd").addEventListener("click", function () {
      if (!dirty) { notice("warn", "Dibuja primero tu firma en el recuadro."); return; }
      addSignOverlay(pad.toDataURL("image/png"), pad.width, pad.height);
    });
    sigApi = { fit: fit, clear: clear };
  }

  /* ---------- construir el PDF final ---------- */
  function buildAssembled(onProgress) {
    return getPdfLib().then(function (PDFLib) {
      var PDFDocument = PDFLib.PDFDocument, StandardFonts = PDFLib.StandardFonts,
        rgb = PDFLib.rgb, degrees = PDFLib.degrees;
      return PDFDocument.create().then(function (out) {
        return out.embedFont(StandardFonts.Helvetica).then(function (font) {
          var srcs = {}, copied = {}, imgs = {}, chain = Promise.resolve();

          // 1. abrir los PDF de origen (las imagenes no tienen documento)
          S.docs.forEach(function (d) {
            if (d.kind === "img") return;
            chain = chain.then(function () {
              return PDFDocument.load(d.bytes, { ignoreEncryption: true })
                .then(function (doc) { srcs[d.id] = doc; });
            });
          });

          // 2. copiar de una vez las paginas que se usan de cada PDF
          chain = chain.then(function () {
            var c2 = Promise.resolve();
            S.docs.forEach(function (d) {
              if (d.kind === "img") return;
              var idxs = S.pages.filter(function (p) { return p.docId === d.id; })
                                .map(function (p) { return p.idx; });
              idxs = idxs.filter(function (v, i, a) { return a.indexOf(v) === i; });
              if (!idxs.length) return;
              c2 = c2.then(function () {
                return out.copyPages(srcs[d.id], idxs).then(function (arr) {
                  var m = {};
                  idxs.forEach(function (ix, i) { m[ix] = arr[i]; });
                  copied[d.id] = m;
                });
              });
            });
            return c2;
          });

          // 3. incrustar las imagenes antes de montar (addPage es sincrono)
          chain = chain.then(function () {
            var c3 = Promise.resolve();
            S.pages.forEach(function (p) {
              if (p.kind !== "img") return;
              c3 = c3.then(function () {
                var emb = (p.mime === "image/png") ? out.embedPng(p.data) : out.embedJpg(p.data);
                return emb.then(function (x) { imgs[p.uid] = x; })["catch"](function (e) {
                  console.warn("imagen", p.uid, e);
                });
              });
            });
            return c3;
          });

          // 4. montar en el orden de la rejilla
          return chain.then(function () {
            S.pages.forEach(function (p, i) {
              var page;
              if (p.kind === "img") {
                page = out.addPage([p.wU, p.hU]);
                var im = imgs[p.uid];
                if (im) {
                  var r = rectImagen(p);
                  // pdf-lib tiene el origen abajo-izquierda
                  page.drawImage(im, { x: r.x, y: p.hU - r.y - r.h, width: r.w, height: r.h });
                }
              } else {
                var src = copied[p.docId] && copied[p.docId][p.idx];
                if (!src) return;
                page = out.addPage(src);
              }
              page.setRotation(degrees(totalRot(p)));
              if (onProgress) onProgress((i + 1) / S.pages.length);
            });

            // 5. superposiciones (texto y firmas) sobre las paginas colocadas
            var pages = out.getPages(), c4 = Promise.resolve();
            S.pages.forEach(function (p, i) {
              var page = pages[i];
              if (!page || !p.ov.length) return;
              var mb = page.getMediaBox();
              p.ov.forEach(function (o) {
                if (o.type === "text") {
                  var lines = String(o.text).split("\n");
                  var col = hexRgb(o.color);
                  lines.forEach(function (line, li) {
                    var baseline = 0.838 * o.size + li * 1.2 * o.size;
                    var a = toPdf(p, o.x, o.y, baseline, mb);
                    try {
                      page.drawText(winAnsi(line), {
                        x: a.x, y: a.y, size: o.size, font: font,
                        color: rgb(col.r, col.g, col.b), rotate: degrees(a.rot)
                      });
                    } catch (e) { console.warn("texto", e); }
                  });
                } else {
                  c4 = c4.then(function () {
                    return out.embedPng(o.data).then(function (png) {
                      var a = toPdf(p, o.x, o.y, o.h, mb);
                      page.drawImage(png, { x: a.x, y: a.y, width: o.w, height: o.h, rotate: degrees(a.rot) });
                    })["catch"](function (e) { console.warn("firma", e); });
                  });
                }
              });
            });
            return c4.then(function () { return out.save({ useObjectStreams: true }); });
          });
        });
      });
    });
  }

  /* ---------- compresion: rasterizar a JPEG ---------- */
  function rasterize(bytes, dpi, quality, onProgress) {
    return Promise.all([getPdfjs(), getPdfLib()]).then(function (mods) {
      var lib = mods[0], PDFLib = mods[1];
      return lib.getDocument(docOpts(bytes.slice(0))).promise.then(function (doc) {
        return PDFLib.PDFDocument.create().then(function (out) {
          var chain = Promise.resolve();
          for (var i = 1; i <= doc.numPages; i++) {
            (function (i) {
              chain = chain.then(function () {
                return doc.getPage(i).then(function (pg) {
                  var v1 = pg.getViewport({ scale: 1 });
                  var scale = dpi / 72;
                  var maxPx = 4200;
                  if (v1.width * scale > maxPx || v1.height * scale > maxPx) {
                    scale = Math.min(maxPx / v1.width, maxPx / v1.height);
                  }
                  var vp = pg.getViewport({ scale: scale });
                  var c = document.createElement("canvas");
                  c.width = Math.max(1, Math.round(vp.width));
                  c.height = Math.max(1, Math.round(vp.height));
                  var ctx = c.getContext("2d");
                  ctx.fillStyle = "#ffffff";
                  ctx.fillRect(0, 0, c.width, c.height);
                  return pg.render({ canvas: c, canvasContext: ctx, viewport: vp }).promise.then(function () {
                    var jpg = c.toDataURL("image/jpeg", quality);
                    c.width = c.height = 1; // liberar memoria
                    return out.embedJpg(jpg).then(function (img) {
                      var page = out.addPage([v1.width, v1.height]);
                      page.drawImage(img, { x: 0, y: 0, width: v1.width, height: v1.height });
                      if (onProgress) onProgress(i / doc.numPages);
                    });
                  });
                });
              });
            })(i);
          }
          return chain.then(function () { return out.save({ useObjectStreams: true }); });
        });
      });
    });
  }

  /* ---------- dividir: un PDF por pagina o por rangos ---------- */
  // Los rangos se refieren al orden ACTUAL de la rejilla, no al del archivo
  // original: lo que ves es lo que se separa.
  function gruposDeCorte(total) {
    var modo = ($("#optSplitMode") || {}).value || "paginas";
    if (modo !== "rangos") {
      var g = [];
      for (var i = 0; i < total; i++) g.push([i]);
      return g;
    }
    var grupos = [];
    (($("#optRanges") || {}).value || "").split(",").forEach(function (t) {
      t = t.trim();
      if (!t) return;
      var a, b, m = /^(\d+)?\s*-\s*(\d+)?$/.exec(t);
      if (m && (m[1] || m[2])) {
        a = parseInt(m[1] || "1", 10);
        b = parseInt(m[2] || String(total), 10);
      } else if (/^\d+$/.test(t)) {
        a = b = parseInt(t, 10);
      } else return;
      a = Math.max(1, Math.min(total, a));
      b = Math.max(1, Math.min(total, b));
      if (b < a) { var x = a; a = b; b = x; }
      var g2 = [];
      for (var i = a; i <= b; i++) g2.push(i - 1);
      grupos.push(g2);
    });
    return grupos;
  }

  function partirPdf(bytes, base, onProgress) {
    return getPdfLib().then(function (PDFLib) {
      return PDFLib.PDFDocument.load(bytes).then(function (src) {
        var grupos = gruposDeCorte(src.getPageCount());
        if (!grupos.length) {
          throw new Error("no hay rangos válidos: escribe algo como 1-3, 5, 8-");
        }
        var salidas = [], c = Promise.resolve();
        grupos.forEach(function (g, i) {
          c = c.then(function () {
            return PDFLib.PDFDocument.create().then(function (out) {
              return out.copyPages(src, g).then(function (arr) {
                arr.forEach(function (pg) { out.addPage(pg); });
                return out.save({ useObjectStreams: true });
              }).then(function (b) {
                var etiqueta = (g.length === 1)
                  ? String(g[0] + 1)
                  : (g[0] + 1) + "-" + (g[g.length - 1] + 1);
                salidas.push({ nombre: base + "-" + etiqueta + ".pdf", bytes: b });
                if (onProgress) onProgress((i + 1) / grupos.length);
              });
            });
          });
        });
        return c.then(function () { return salidas; });
      });
    });
  }

  /* ---------- pasar las paginas a imagenes ---------- */
  function paginasAImagenes(bytes, base, dpi, formato, calidad, onProgress) {
    return getPdfjs().then(function (lib) {
      return lib.getDocument(docOpts(bytes.slice(0))).promise.then(function (doc) {
        var salidas = [], c = Promise.resolve();
        for (var i = 1; i <= doc.numPages; i++) {
          (function (i) {
            c = c.then(function () {
              return doc.getPage(i).then(function (pg) {
                var v1 = pg.getViewport({ scale: 1 }), scale = dpi / 72, maxPx = 6000;
                if (v1.width * scale > maxPx || v1.height * scale > maxPx) {
                  scale = Math.min(maxPx / v1.width, maxPx / v1.height);
                }
                var vp = pg.getViewport({ scale: scale });
                var c2 = document.createElement("canvas");
                c2.width = Math.max(1, Math.round(vp.width));
                c2.height = Math.max(1, Math.round(vp.height));
                var ctx = c2.getContext("2d");
                ctx.fillStyle = "#ffffff";       // el PDF no tiene fondo; el JPG sí
                ctx.fillRect(0, 0, c2.width, c2.height);
                return pg.render({ canvas: c2, canvasContext: ctx, viewport: vp }).promise
                  .then(function () {
                    return new Promise(function (ok) {
                      c2.toBlob(function (b) { ok(b); },
                        formato === "png" ? "image/png" : "image/jpeg", calidad);
                    });
                  })
                  .then(function (blob) {
                    c2.width = c2.height = 1;    // liberar memoria
                    salidas.push({
                      nombre: base + "-" + i + (formato === "png" ? ".png" : ".jpg"),
                      blob: blob
                    });
                    if (onProgress) onProgress(i / doc.numPages);
                  });
              });
            });
          })(i);
        }
        return c.then(function () { return salidas; });
      });
    });
  }

  /* ---------- empaquetar varios archivos en un zip ---------- */
  function empaquetarZip(archivos) {
    return loadScript("lib/vendor/jszip.min.js").then(function () {
      var zip = new JSZip();
      archivos.forEach(function (a) { zip.file(a.nombre, a.blob || a.bytes); });
      // PDF y JPEG ya vienen comprimidos: volver a comprimir solo cuesta tiempo
      return zip.generateAsync({ type: "blob" });
    });
  }

  // Entrega de varios archivos de salida. En la web se empaquetan en un ZIP.
  // Está aislado aquí a propósito: la demo de una sola página (que se publica
  // en un visor que no admite .zip) sustituye SOLO esta función por una
  // entrega archivo a archivo. Ver tools/construir-demo.py.
  function entregarVarios(arch, nombreZip) {
    setProgress(0.85, "Empaquetando " + arch.length + " archivos…");
    return empaquetarZip(arch).then(function (blob) {
      return { blob: blob, name: nombreZip, n: arch.length };
    });
  }

  /* ---------- exportar ---------- */
  function salidaEsPdf(m) { return m !== "dividir" && m !== "pdf-a-imagen"; }

  function nombreBase() {
    var n = ($("#optName") && $("#optName").value.trim()) || "";
    if (!n) n = defaultName();
    return n.replace(/\.(pdf|zip|jpe?g|png)$/i, "") || "documento";
  }

  function defaultName() {
    if (S.mode === "comprimir") return "comprimido";
    if (S.mode === "firmar") return "firmado";
    if (S.mode === "dividir") return "documento";
    if (S.mode === "pdf-a-imagen") return "pagina";
    if (S.mode === "imagen-a-pdf") return "imagenes";
    if (S.docs.length > 1) return "unido";
    return (S.docs[0] ? S.docs[0].name.replace(/\.[a-z0-9]+$/i, "") : "documento") + "-editado";
  }

  function exportPdf() {
    if (S.busy || !S.pages.length) return;
    var modo = S.mode;
    var comprimir = !!($("#optCompress") && $("#optCompress").checked) && salidaEsPdf(modo);
    var dpi = parseInt(($("#optDpi") || {}).value || "144", 10);
    var calidad = parseFloat(($("#optQuality") || {}).value || "0.72");
    var base = nombreBase();
    var originalBytes = S.docs.reduce(function (a, d) { return a + (d.size || 0); }, 0);

    S.busy = true;
    notice("");
    setState("working");
    setProgress(0.05, "Montando el documento…");

    buildAssembled(function (f) { setProgress(0.05 + f * 0.3, "Montando el documento…"); })
      .then(function (bytes) {

        if (modo === "dividir") {
          setProgress(0.4, "Separando páginas…");
          return partirPdf(bytes, base, function (f) {
            setProgress(0.4 + f * 0.4, "Separando páginas (" + Math.round(f * 100) + "%)…");
          }).then(function (arch) {
            if (arch.length === 1) {
              return { blob: new Blob([arch[0].bytes], { type: "application/pdf" }),
                       name: arch[0].nombre, n: 1 };
            }
            return entregarVarios(arch, base + "-separado.zip");
          });
        }

        if (modo === "pdf-a-imagen") {
          var formato = ($("#optImgFormat") || {}).value || "jpg";
          var dpiImg = parseInt(($("#optImgDpi") || {}).value || "150", 10);
          setProgress(0.4, "Generando imágenes…");
          return paginasAImagenes(bytes, base, dpiImg, formato, 0.92, function (f) {
            setProgress(0.4 + f * 0.4, "Generando imágenes (" + Math.round(f * 100) + "%)…");
          }).then(function (arch) {
            if (arch.length === 1) {
              return { blob: arch[0].blob, name: arch[0].nombre, n: 1 };
            }
            return entregarVarios(arch, base + "-imagenes.zip");
          });
        }

        if (comprimir) {
          setProgress(0.4, "Comprimiendo páginas…");
          return rasterize(bytes, dpi, calidad, function (f) {
            setProgress(0.4 + f * 0.5, "Comprimiendo páginas (" + Math.round(f * 100) + "%)…");
          }).then(function (b) {
            return { blob: new Blob([b], { type: "application/pdf" }), name: base + ".pdf", n: 1 };
          });
        }

        return { blob: new Blob([bytes], { type: "application/pdf" }), name: base + ".pdf", n: 1 };
      })
      .then(function (r) {
        setProgress(0.97, "Preparando la descarga…");
        S.busy = false;
        showResult(r, originalBytes);
      })["catch"](function (err) {
        S.busy = false;
        console.error(err);
        setState("error");
        $("#errMsg").textContent = "No hemos podido generar el archivo (" +
          (err && err.message ? err.message : "error desconocido") +
          "). Si el PDF está protegido con contraseña, quítala antes de abrirlo aquí.";
      });
  }

  function showResult(r, originalBytes) {
    var titulo = $("#resTitle"), lista = $("#resList"), btn = $("#resDownload");
    if (lista) { lista.innerHTML = ""; lista.hidden = true; }

    // Varios archivos entregados de uno en uno (demo de una sola página)
    if (r.archivos) {
      if (titulo) titulo.textContent = "Tus " + r.archivos.length + " archivos están listos";
      $("#resSizes").innerHTML = "Descárgalos de uno en uno:";
      if (btn) btn.hidden = true;
      if (lista) {
        lista.hidden = false;
        r.archivos.forEach(function (a) {
          var b = document.createElement("button");
          b.type = "button";
          b.className = "btn btn--sm";
          b.textContent = a.nombre + " — " + fmtBytes(a.blob.size);
          b.onclick = function () { saveBlob(a.blob, a.nombre); };
          lista.appendChild(b);
        });
      }
      setState("done");
      return;
    }

    if (btn) btn.hidden = false;
    var blob = r.blob, name = r.name, n = r.n || 1;
    var ext = (/\.([a-z0-9]+)$/i.exec(name) || [, "pdf"])[1].toUpperCase();
    if (titulo) {
      titulo.textContent = (n > 1)
        ? "Tus " + n + " archivos están listos"
        : (ext === "PDF" ? "Tu PDF está listo" : "Tu imagen está lista");
    }

    var sizes;
    if (n > 1) {
      sizes = "<b>" + n + " archivos</b> en un ZIP · " + fmtBytes(blob.size);
    } else {
      sizes = "Tamaño final: <b>" + fmtBytes(blob.size) + "</b>";
      if (originalBytes && ext === "PDF") {
        var pct = Math.round((1 - blob.size / originalBytes) * 100);
        sizes += " · original " + fmtBytes(originalBytes);
        if (pct > 2) sizes += " · <b>−" + pct + "%</b>";
        else if (pct < -2) sizes += " · +" + Math.abs(pct) + "%";
      }
    }
    $("#resSizes").innerHTML = sizes;

    btn.textContent = "Descargar " + ext + " — " + fmtBytes(blob.size);
    btn.onclick = function () { saveBlob(blob, name); };
    setState("done");
    setTimeout(function () { safe(function () { saveBlob(blob, name); }, "autoDownload"); }, 60);
  }

  function resetAll() {
    S.pages.forEach(function (p) {
      if (p.bitmap && typeof p.bitmap.close === "function") { try { p.bitmap.close(); } catch (_) { } }
    });
    S.docs = []; S.pages = []; S.busy = false; S.avisoCarga = "";
    if (grid) grid.innerHTML = "";
    if (fileInput) fileInput.value = "";
    notice("");
    setState("idle");
  }

  /* ---------- modos ---------- */
  var MODOS = {
    "organizar": {
      btn: "Generar y descargar PDF",
      hint: "Arrastra las miniaturas para reordenar, gira, elimina o edita cualquier página."
    },
    "unir": {
      btn: "Unir y descargar",
      hint: "Suelta varios PDF: se unirán en el orden de la lista. Arrastra las miniaturas para cambiarlo."
    },
    "dividir": {
      btn: "Separar y descargar",
      hint: "Una página por archivo, o los rangos que tú indiques. Si sale más de un archivo, se descargan juntos en un ZIP."
    },
    "comprimir": {
      btn: "Comprimir y descargar",
      hint: "Reduce el peso rasterizando cada página. Ideal para documentos escaneados y para enviar por correo."
    },
    "firmar": {
      btn: "Aplicar y descargar",
      hint: "Pulsa el lápiz de una página para dibujar tu firma o añadir texto encima."
    },
    "imagen-a-pdf": {
      btn: "Crear PDF y descargar",
      hint: "Cada imagen será una página. Arrástralas para ordenarlas y gíralas si hace falta."
    },
    "pdf-a-imagen": {
      btn: "Convertir y descargar",
      hint: "Cada página se convierte en una imagen. Si hay más de una, se descargan juntas en un ZIP."
    }
  };

  function setMode(m) {
    if (!MODOS[m]) m = "organizar";
    S.mode = m;
    $$("[data-mode]").forEach(function (b) {
      b.setAttribute("aria-pressed", String(b.dataset.mode === m));
    });
    var comp = $("#optCompress");
    if (comp) comp.checked = (m === "comprimir");
    var btn = $("#exportBtn");
    if (btn) btn.textContent = MODOS[m].btn;
    var hint = $("#modeHint");
    if (hint) hint.textContent = MODOS[m].hint;

    var esImg = (m === "imagen-a-pdf");
    var mas = $("#addMore");
    if (mas) mas.textContent = esImg ? "+ Añadir más imágenes" : "+ Añadir más PDF";
    var t = $("#dzTitle"), sub = $("#dzSub"), h = $("#dzHint");
    if (t) t.textContent = esImg ? "Arrastra aquí tus imágenes" : "Arrastra aquí tus PDF";
    if (sub) sub.textContent = esImg
      ? "o pulsa para elegirlas en tu dispositivo"
      : "o pulsa para elegirlos en tu dispositivo";
    if (h) h.textContent = esImg
      ? "JPG, PNG o WebP · una o varias · también puedes pegar con Ctrl+V"
      : "Uno o varios archivos · hasta " + LIMITS.tamanoMB + " MB cada uno · también puedes pegar con Ctrl+V";

    updateWarnings();
  }

  /* ---------- arranque ---------- */
  function initTool() {
    card = $("#toolCard");
    if (!card) return;
    grid = $("#pageGrid");
    dz = $("#dropzone");
    fileInput = $("#fileInput");
    bar = $("#progressBar i");
    barLabel = $("#progressLabel");
    noticeBox = $("#noticeBox");

    $$(".nojs").forEach(function (n) { n.hidden = true; });
    setState("idle");

    fileInput.addEventListener("change", function () { pickFiles(fileInput.files); });

    ["dragenter", "dragover"].forEach(function (ev) {
      dz.addEventListener(ev, function (e) { e.preventDefault(); dz.classList.add("is-over"); });
    });
    ["dragleave", "drop"].forEach(function (ev) {
      dz.addEventListener(ev, function (e) { e.preventDefault(); dz.classList.remove("is-over"); });
    });
    dz.addEventListener("drop", function (e) {
      if (e.dataTransfer && e.dataTransfer.files) pickFiles(e.dataTransfer.files);
    });
    // Soltar en cualquier parte de la pagina
    window.addEventListener("dragover", function (e) { e.preventDefault(); });
    window.addEventListener("drop", function (e) {
      e.preventDefault();
      if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length) pickFiles(e.dataTransfer.files);
    });
    document.addEventListener("paste", function (e) {
      if (e.clipboardData && e.clipboardData.files && e.clipboardData.files.length) pickFiles(e.clipboardData.files);
    });

    $$("[data-mode]").forEach(function (b) {
      b.addEventListener("click", function () { setMode(b.dataset.mode); });
    });
    var addMore = $("#addMore");
    if (addMore) addMore.addEventListener("click", function () { fileInput.click(); });
    var exportBtn = $("#exportBtn");
    if (exportBtn) exportBtn.addEventListener("click", exportPdf);
    $$("[data-reset]").forEach(function (b) { b.addEventListener("click", resetAll); });
    var comp = $("#optCompress");
    if (comp) comp.addEventListener("change", updateWarnings);
    var split = $("#optSplitMode");
    if (split) split.addEventListener("change", updateOptions);
    var fit = $("#optImgFit");
    if (fit) fit.addEventListener("change", function () {
      S.imgFit = fit.value === "original" ? "original" : "a4";
      refrescarPaginasImagen();
      if (S.pages.length) renderPages();
    });
    var q = $("#optQuality");
    if (q) q.addEventListener("input", function () {
      var out = $("#optQualityOut");
      if (out) out.textContent = Math.round(parseFloat(q.value) * 100) + "%";
    });

    initDnD();
    safe(initSigPad, "initSigPad");
    var edAdd = $("#edAddText");
    if (edAdd) edAdd.addEventListener("click", addTextOverlay);
    var edDone = $("#edDone");
    if (edDone) edDone.addEventListener("click", function () {
      var dlg = $("#editorDlg");
      if (dlg.close) dlg.close(); else dlg.removeAttribute("open");
      renderPages();
    });

    // modo por parametro (?modo=comprimir) para las landings
    var m = new URLSearchParams(location.search).get("modo") ||
      (document.body.dataset.modo || "organizar");
    setMode(m);
  }

  function initFooterYear() {
    $$("[data-year]").forEach(function (el) { el.textContent = new Date().getFullYear(); });
  }

  function boot() {
    safe(initTool, "initTool");
    safe(initFooterYear, "initFooterYear");
    document.documentElement.classList.add("is-ready");
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
