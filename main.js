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
    docs: [],     // {id, name, size, bytes:Uint8Array, pdf:pdfjsDoc, textish:bool}
    pages: [],    // {uid, docId, idx, base, rot, wU, hU, ov:[]}
    mode: "organizar",
    busy: false,
    seqD: 0, seqP: 0
  };

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

  /* ---------- entrada de archivos ---------- */
  function pickFiles(list) {
    var files = Array.prototype.slice.call(list || []);
    files = files.filter(function (f) {
      return f && (/\.pdf$/i.test(f.name || "") || f.type === "application/pdf");
    });
    if (!files.length) { notice("warn", "Solo se admiten archivos PDF."); return; }
    addFiles(files);
  }

  function addFiles(files) {
    if (S.busy) return;
    S.busy = true;
    notice("");
    setState("working");
    setProgress(0.02, "Abriendo los archivos en tu navegador…");

    getPdfjs().then(function (lib) {
      var i = 0, skipped = [];
      function next() {
        if (i >= files.length) return Promise.resolve();
        var f = files[i++];
        setProgress(0.1 + 0.85 * (i / files.length), "Leyendo " + f.name + "…");
        if (f.size > LIMITS.tamanoMB * 1048576) {
          skipped.push(esc(f.name) + " (mas de " + LIMITS.tamanoMB + " MB)");
          return next();
        }
        return f.arrayBuffer().then(function (ab) {
          var bytes = new Uint8Array(ab);
          return lib.getDocument({ data: bytes.slice(0) }).promise.then(function (doc) {
            var id = "d" + (++S.seqD);
            var rec = { id: id, name: f.name, size: f.size, bytes: bytes, pdf: doc, textish: false };
            S.docs.push(rec);
            var chain = Promise.resolve();
            var n = Math.min(doc.numPages, LIMITS.paginas);
            for (var k = 1; k <= n; k++) {
              (function (k) {
                chain = chain.then(function () {
                  return doc.getPage(k).then(function (pg) {
                    var v = pg.view; // [x0,y0,x1,y1] sin rotar
                    S.pages.push({
                      uid: "p" + (++S.seqP), docId: id, idx: k - 1,
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
      if (skipped && skipped.length) {
        notice("warn", "No se pudieron abrir: " + skipped.join(", ") + ".");
      }
      if (!S.pages.length) { setState("idle"); return; }
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

  function drawThumb(box) {
    if (!box || box.dataset.done === "1") return;
    var p = pageOf(box.dataset.thumb);
    var d = p && docOf(p.docId);
    if (!p || !d) return;
    box.dataset.done = "1";
    d.pdf.getPage(p.idx + 1).then(function (pg) {
      var t = totalRot(p);
      var v1 = pg.getViewport({ scale: 1, rotation: t });
      var target = 150 * Math.min(2, window.devicePixelRatio || 1);
      var scale = target / v1.width;
      var vp = pg.getViewport({ scale: scale, rotation: t });
      var c = document.createElement("canvas");
      c.width = Math.max(1, Math.round(vp.width));
      c.height = Math.max(1, Math.round(vp.height));
      c.style.width = "100%"; c.style.height = "auto";
      var ctx = c.getContext("2d");
      return pg.render({ canvas: c, canvasContext: ctx, viewport: vp }).promise.then(function () {
        box.innerHTML = "";
        box.appendChild(c);
      });
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

  function updateWarnings() {
    var comp = $("#optCompress");
    var textish = S.docs.some(function (d) { return d.textish; });
    if (comp && comp.checked && textish) {
      notice("warn", "<span>Alguno de tus PDF contiene <b>texto seleccionable</b>. " +
        "La compresión convierte cada página en imagen: el archivo pesará menos en documentos escaneados, " +
        "pero el texto dejará de poder copiarse o buscarse. Desactiva la compresión si necesitas mantenerlo.</span>");
    } else {
      notice("");
    }
    var box = $("#compressOpts");
    if (box) box.hidden = !(comp && comp.checked);
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

    d.pdf.getPage(p.idx + 1).then(function (pg) {
      var dpr = Math.min(2, window.devicePixelRatio || 1);
      var vp = pg.getViewport({ scale: ed.scale * dpr, rotation: totalRot(p) });
      var c = document.createElement("canvas");
      c.width = Math.round(vp.width); c.height = Math.round(vp.height);
      c.style.width = Math.round(ds.w * ed.scale) + "px";
      c.style.height = Math.round(ds.h * ed.scale) + "px";
      return pg.render({ canvas: c, canvasContext: c.getContext("2d"), viewport: vp }).promise
        .then(function () { ed.stage.insertBefore(c, ed.stage.firstChild); });
    })["catch"](function (e) { console.warn(e); });

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
          var srcs = {}, chain = Promise.resolve();
          S.docs.forEach(function (d) {
            chain = chain.then(function () {
              return PDFDocument.load(d.bytes, { ignoreEncryption: true }).then(function (doc) { srcs[d.id] = doc; });
            });
          });
          var copied = {};
          chain = chain.then(function () {
            var c2 = Promise.resolve();
            S.docs.forEach(function (d) {
              var idxs = S.pages.filter(function (p) { return p.docId === d.id; }).map(function (p) { return p.idx; });
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

          return chain.then(function () {
            S.pages.forEach(function (p, i) {
              var src = copied[p.docId] && copied[p.docId][p.idx];
              if (!src) return;
              var page = out.addPage(src);
              page.setRotation(degrees(totalRot(p)));
              if (onProgress) onProgress((i + 1) / S.pages.length);
            });
            // superposiciones (texto y firmas) sobre las paginas ya colocadas
            var pages = out.getPages(), c3 = Promise.resolve();
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
                  c3 = c3.then(function () {
                    return out.embedPng(o.data).then(function (png) {
                      var a = toPdf(p, o.x, o.y, o.h, mb);
                      page.drawImage(png, { x: a.x, y: a.y, width: o.w, height: o.h, rotate: degrees(a.rot) });
                    })["catch"](function (e) { console.warn("firma", e); });
                  });
                }
              });
            });
            return c3.then(function () { return out.save({ useObjectStreams: true }); });
          });
        });
      });
    });
  }

  /* ---------- compresion: rasterizar a JPEG ---------- */
  function rasterize(bytes, dpi, quality, onProgress) {
    return Promise.all([getPdfjs(), getPdfLib()]).then(function (mods) {
      var lib = mods[0], PDFLib = mods[1];
      return lib.getDocument({ data: bytes.slice(0) }).promise.then(function (doc) {
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

  /* ---------- exportar ---------- */
  function exportPdf() {
    if (S.busy || !S.pages.length) return;
    S.busy = true;
    notice("");
    setState("working");
    var compress = $("#optCompress") && $("#optCompress").checked;
    var dpi = parseInt(($("#optDpi") || {}).value || "144", 10);
    var quality = parseFloat(($("#optQuality") || {}).value || "0.72");
    var originalBytes = S.docs.reduce(function (a, d) { return a + d.size; }, 0);

    setProgress(0.05, "Montando el documento…");
    buildAssembled(function (f) { setProgress(0.05 + f * (compress ? 0.3 : 0.85), "Montando el documento…"); })
      .then(function (bytes) {
        if (!compress) return bytes;
        setProgress(0.4, "Comprimiendo páginas…");
        return rasterize(bytes, dpi, quality, function (f) {
          setProgress(0.4 + f * 0.5, "Comprimiendo páginas (" + Math.round(f * 100) + "%)…");
        });
      })
      .then(function (bytes) {
        setProgress(0.97, "Preparando la descarga…");
        var blob = new Blob([bytes], { type: "application/pdf" });
        var name = ($("#optName") && $("#optName").value.trim()) || defaultName();
        if (!/\.pdf$/i.test(name)) name += ".pdf";
        S.busy = false;
        showResult(blob, name, originalBytes);
      })["catch"](function (err) {
        S.busy = false;
        console.error(err);
        setState("error");
        $("#errMsg").textContent = "Algo ha fallado al generar el PDF (" +
          (err && err.message ? err.message : "error desconocido") +
          "). Si el archivo está protegido con contraseña, quítala antes de subirlo.";
      });
  }

  function defaultName() {
    if (S.mode === "comprimir") return "comprimido.pdf";
    if (S.mode === "firmar") return "firmado.pdf";
    if (S.docs.length > 1) return "unido.pdf";
    return (S.docs[0] ? S.docs[0].name.replace(/\.pdf$/i, "") : "documento") + "-editado.pdf";
  }

  function showResult(blob, name, originalBytes) {
    var pct = originalBytes ? Math.round((1 - blob.size / originalBytes) * 100) : 0;
    var sizes = "Tamaño final: <b>" + fmtBytes(blob.size) + "</b>";
    if (originalBytes) {
      sizes += " · original " + fmtBytes(originalBytes);
      if (pct > 2) sizes += " · <b>−" + pct + "%</b>";
      else if (pct < -2) sizes += " · +" + Math.abs(pct) + "%";
    }
    $("#resSizes").innerHTML = sizes;
    var btn = $("#resDownload");
    btn.textContent = "Descargar PDF — " + fmtBytes(blob.size);
    btn.onclick = function () { saveBlob(blob, name); };
    setState("done");
    setTimeout(function () { safe(function () { saveBlob(blob, name); }, "autoDownload"); }, 60);
  }

  function resetAll() {
    S.docs = []; S.pages = []; S.busy = false;
    if (grid) grid.innerHTML = "";
    if (fileInput) fileInput.value = "";
    notice("");
    setState("idle");
  }

  /* ---------- modos ---------- */
  function setMode(m) {
    S.mode = m;
    $$("[data-mode]").forEach(function (b) {
      b.setAttribute("aria-pressed", String(b.dataset.mode === m));
    });
    var comp = $("#optCompress");
    if (comp) comp.checked = (m === "comprimir");
    var exportBtn = $("#exportBtn");
    if (exportBtn) {
      exportBtn.textContent =
        m === "comprimir" ? "Comprimir y descargar" :
        m === "unir" ? "Unir y descargar" :
        m === "firmar" ? "Aplicar y descargar" : "Generar y descargar PDF";
    }
    var hint = $("#modeHint");
    if (hint) {
      hint.textContent =
        m === "comprimir" ? "Reduce el peso rasterizando cada página. Ideal para documentos escaneados y para enviar por correo." :
        m === "unir" ? "Suelta varios PDF: se unirán en el orden de la lista. Arrastra las miniaturas para cambiarlo." :
        m === "firmar" ? "Pulsa el lápiz de una página para dibujar tu firma o añadir texto encima." :
        "Arrastra las miniaturas para reordenar, gira, elimina o edita cualquier página.";
    }
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
    setMode(["organizar", "unir", "comprimir", "firmar"].indexOf(m) >= 0 ? m : "organizar");
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
