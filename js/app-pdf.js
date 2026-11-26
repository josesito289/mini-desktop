/* ============================================================
   app-pdf.js — Lector de PDF (solo lectura, varias pestañas)
   Usa PDF.js cargado desde CDN (ver index.html / README).
   Los archivos se guardan en IndexedDB para poder restaurarlos
   al recargar la PWA sin tener que volver a seleccionarlos.
   ============================================================ */
(function () {
  'use strict';
  window.MiniApps = window.MiniApps || {};

  var META_KEY = 'md_pdf_v1';
  var DB_NAME = 'mini-desktop-files';
  var STORE_NAME = 'pdfs';

  if (window.pdfjsLib) {
    try {
      window.pdfjsLib.GlobalWorkerOptions.workerSrc =
        'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.worker.min.js';
    } catch (e) { console.warn('No se pudo configurar el worker de PDF.js:', e); }
  }

  // ---------------- IndexedDB helper ----------------
  function openDB() {
    return new Promise(function (resolve, reject) {
      var req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = function () {
        if (!req.result.objectStoreNames.contains(STORE_NAME)) {
          req.result.createObjectStore(STORE_NAME);
        }
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
  }
  function putBlob(id, blob) {
    return openDB().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(STORE_NAME, 'readwrite');
        tx.objectStore(STORE_NAME).put(blob, id);
        tx.oncomplete = function () { resolve(); };
        tx.onerror = function () { reject(tx.error); };
      });
    });
  }
  function getBlob(id) {
    return openDB().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(STORE_NAME, 'readonly');
        var req = tx.objectStore(STORE_NAME).get(id);
        req.onsuccess = function () { resolve(req.result); };
        req.onerror = function () { reject(req.error); };
      });
    });
  }
  function deleteBlob(id) {
    return openDB().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(STORE_NAME, 'readwrite');
        tx.objectStore(STORE_NAME).delete(id);
        tx.oncomplete = function () { resolve(); };
        tx.onerror = function () { reject(tx.error); };
      });
    });
  }
  function uuid() {
    if (window.crypto && window.crypto.randomUUID) return window.crypto.randomUUID();
    return 'id-' + Date.now() + '-' + Math.random().toString(16).slice(2);
  }

  function persistMeta(tabs, activeTabId) {
    try {
      var serial = tabs.map(function (t) {
        return { id: t.id, filename: t.filename, page: t.page, scale: t.scale, blobKey: t.blobKey };
      });
      localStorage.setItem(META_KEY, JSON.stringify({ tabs: serial, activeTabId: activeTabId }));
    } catch (e) { console.warn('No se pudo guardar el estado del lector de PDF:', e); }
  }

  var ZOOM_STEPS = [0.5, 0.75, 1, 1.25, 1.5, 2, 2.5];

  window.MiniApps.pdf = {
    title: 'Lector de PDF',
    icon: '📄',
    mount: function (bodyEl, savedState) {
      var tabs = [];
      var activeTabId = null;

      var toolbar = document.createElement('div');
      toolbar.className = 'app-toolbar';
      var btnOpen = document.createElement('button');
      btnOpen.className = 'bevel-out';
      btnOpen.textContent = 'Abrir PDF(s)';
      var fileInput = document.createElement('input');
      fileInput.type = 'file';
      fileInput.accept = 'application/pdf';
      fileInput.multiple = true;
      fileInput.style.display = 'none';
      toolbar.appendChild(btnOpen);
      toolbar.appendChild(fileInput);

      var tabStrip = document.createElement('div');
      tabStrip.className = 'pdf-tabstrip';
      toolbar.appendChild(tabStrip); // nombres de los PDFs al lado del botón "Abrir"

      var viewerToolbar = document.createElement('div');
      viewerToolbar.className = 'pdf-viewer-toolbar';
      var btnPrev = document.createElement('button'); btnPrev.className = 'bevel-out'; btnPrev.textContent = '◀';
      var pageLabel = document.createElement('span'); pageLabel.textContent = '—';
      var btnNext = document.createElement('button'); btnNext.className = 'bevel-out'; btnNext.textContent = '▶';
      var btnZoomOut = document.createElement('button'); btnZoomOut.className = 'bevel-out'; btnZoomOut.textContent = '−';
      var zoomLabel = document.createElement('span'); zoomLabel.textContent = '100%';
      var btnZoomIn = document.createElement('button'); btnZoomIn.className = 'bevel-out'; btnZoomIn.textContent = '+';
      [btnPrev, pageLabel, btnNext, btnZoomOut, zoomLabel, btnZoomIn].forEach(function (el) {
        viewerToolbar.appendChild(el);
      });

      var canvasWrap = document.createElement('div');
      canvasWrap.className = 'pdf-canvas-wrap';
      var emptyMsg = document.createElement('div');
      emptyMsg.className = 'pdf-empty';
      emptyMsg.textContent = 'No hay PDFs abiertos. Usa "Abrir PDF(s)".';
      var canvas = document.createElement('canvas');
      canvasWrap.appendChild(emptyMsg);

      bodyEl.appendChild(toolbar);
      bodyEl.appendChild(viewerToolbar);
      bodyEl.appendChild(canvasWrap);

      function findTab(id) {
        for (var i = 0; i < tabs.length; i++) if (tabs[i].id === id) return tabs[i];
        return null;
      }

      function renderTabStrip() {
        tabStrip.innerHTML = '';
        tabs.forEach(function (tab) {
          var el = document.createElement('div');
          el.className = 'pdf-tab bevel-out' + (tab.id === activeTabId ? ' pressed' : '');
          var nameSpan = document.createElement('span');
          nameSpan.className = 'pdf-tab-name';
          nameSpan.textContent = tab.filename;
          var closeBtn = document.createElement('button');
          closeBtn.className = 'pdf-tab-close';
          closeBtn.textContent = '×';
          closeBtn.title = 'Cerrar este PDF';
          closeBtn.addEventListener('click', function (ev) {
            ev.stopPropagation();
            closeTab(tab.id);
          });
          el.appendChild(nameSpan);
          el.appendChild(closeBtn);
          el.addEventListener('click', function () {
            activeTabId = tab.id;
            renderTabStrip();
            renderPage();
            persistMeta(tabs, activeTabId);
          });
          tabStrip.appendChild(el);
        });
      }

      function renderViewerState() {
        var tab = activeTabId ? findTab(activeTabId) : null;
        if (!tab || !tab.pdfDoc) {
          canvasWrap.innerHTML = '';
          canvasWrap.appendChild(emptyMsg);
          pageLabel.textContent = '—';
          zoomLabel.textContent = '—';
          return;
        }
        pageLabel.textContent = 'Pág. ' + tab.page + ' / ' + tab.numPages;
        zoomLabel.textContent = Math.round(tab.scale * 100) + '%';
      }

      function renderPage() {
        renderViewerState();
        var tab = activeTabId ? findTab(activeTabId) : null;
        if (!tab || !tab.pdfDoc) return;
        var renderToken = (tab.renderToken = (tab.renderToken || 0) + 1);
        tab.pdfDoc.getPage(tab.page).then(function (page) {
          if (tab.renderToken !== renderToken) return; // llegó una página/zoom más reciente mientras esperábamos
          // Para que se vea nítido en pantallas de alta densidad (la
          // mayoría de teléfonos y monitores modernos), dibujamos el
          // canvas al tamaño real en píxeles físicos (CSS px * devicePixelRatio)
          // y luego lo "encogemos" de vuelta a su tamaño lógico con CSS.
          // Si no se hace esto, PDF.js dibuja 1 píxel de canvas por cada
          // píxel CSS y el navegador termina estirando esa imagen, lo que
          // se ve borroso en cualquier pantalla con densidad > 1.
          var outputScale = window.devicePixelRatio || 1;
          var viewport = page.getViewport({ scale: tab.scale });
          canvas.width = Math.floor(viewport.width * outputScale);
          canvas.height = Math.floor(viewport.height * outputScale);
          canvas.style.width = Math.floor(viewport.width) + 'px';
          canvas.style.height = Math.floor(viewport.height) + 'px';
          var ctx = canvas.getContext('2d');
          var transform = outputScale !== 1 ? [outputScale, 0, 0, outputScale, 0, 0] : null;
          canvasWrap.innerHTML = '';
          canvasWrap.appendChild(canvas);
          page.render({ canvasContext: ctx, viewport: viewport, transform: transform });
        }).catch(function (err) {
          console.warn('No se pudo renderizar la página:', err);
        });
      }

      function loadPdfFromArrayBuffer(arrayBuffer, filename, blobKey, restore) {
        return window.pdfjsLib.getDocument({ data: arrayBuffer }).promise.then(function (doc) {
          var tab = {
            id: (restore && restore.id) || uuid(),
            filename: filename,
            pdfDoc: doc,
            numPages: doc.numPages,
            page: (restore && restore.page) || 1,
            scale: (restore && restore.scale) || 1,
            blobKey: blobKey
          };
          if (tab.page > tab.numPages) tab.page = 1;
          tabs.push(tab);
          if (!activeTabId || !restore) activeTabId = tab.id;
          renderTabStrip();
          renderPage();
          persistMeta(tabs, activeTabId);
          return tab;
        });
      }

      function openFiles(fileList) {
        Array.prototype.forEach.call(fileList, function (file) {
          var id = uuid();
          file.arrayBuffer().then(function (buf) {
            putBlob(id, file).catch(function (e) { console.warn('No se pudo guardar el PDF en IndexedDB:', e); });
            return loadPdfFromArrayBuffer(buf.slice(0), file.name, id, null);
          }).catch(function (err) {
            console.warn(err);
            window.MiniDesktopModal({
              title: 'Error',
              message: 'No se pudo abrir "' + file.name + '". ¿Seguro que es un PDF válido?',
              buttons: [{ label: 'Aceptar' }]
            });
          });
        });
      }

      function closeTab(id) {
        var tab = findTab(id);
        if (!tab) return;
        try { tab.pdfDoc && tab.pdfDoc.destroy(); } catch (e) { /* ignorar */ }
        deleteBlob(tab.blobKey).catch(function () { /* ignorar */ });
        tabs = tabs.filter(function (t) { return t.id !== id; });
        if (activeTabId === id) {
          activeTabId = tabs.length ? tabs[tabs.length - 1].id : null;
        }
        renderTabStrip();
        renderPage();
        persistMeta(tabs, activeTabId);
      }

      btnOpen.addEventListener('click', function () { fileInput.click(); });
      fileInput.addEventListener('change', function () {
        if (fileInput.files && fileInput.files.length) openFiles(fileInput.files);
        fileInput.value = '';
      });
      btnPrev.addEventListener('click', function () {
        var tab = activeTabId ? findTab(activeTabId) : null;
        if (!tab || tab.page <= 1) return;
        tab.page -= 1; renderPage(); persistMeta(tabs, activeTabId);
      });
      btnNext.addEventListener('click', function () {
        var tab = activeTabId ? findTab(activeTabId) : null;
        if (!tab || tab.page >= tab.numPages) return;
        tab.page += 1; renderPage(); persistMeta(tabs, activeTabId);
      });
      btnZoomOut.addEventListener('click', function () {
        var tab = activeTabId ? findTab(activeTabId) : null;
        if (!tab) return;
        var idx = ZOOM_STEPS.indexOf(tab.scale);
        if (idx > 0) { tab.scale = ZOOM_STEPS[idx - 1]; renderPage(); persistMeta(tabs, activeTabId); }
      });
      btnZoomIn.addEventListener('click', function () {
        var tab = activeTabId ? findTab(activeTabId) : null;
        if (!tab) return;
        var idx = ZOOM_STEPS.indexOf(tab.scale);
        if (idx !== -1 && idx < ZOOM_STEPS.length - 1) { tab.scale = ZOOM_STEPS[idx + 1]; renderPage(); persistMeta(tabs, activeTabId); }
      });

      // ---- restaurar sesión anterior ----
      if (savedState && Array.isArray(savedState.tabs) && savedState.tabs.length) {
        var wantedActive = savedState.activeTabId;
        savedState.tabs.forEach(function (meta) {
          getBlob(meta.blobKey).then(function (blob) {
            if (!blob) {
              console.warn('PDF no disponible (fue limpiado del almacenamiento):', meta.filename);
              return;
            }
            return blob.arrayBuffer().then(function (buf) {
              return loadPdfFromArrayBuffer(buf, meta.filename, meta.blobKey, meta);
            }).then(function () {
              if (meta.id === wantedActive) {
                activeTabId = meta.id;
                renderTabStrip();
                renderPage();
              }
            });
          }).catch(function (e) { console.warn('No se pudo restaurar un PDF:', e); });
        });
      } else {
        renderViewerState();
      }

      return {
        getState: function () { return { tabs: tabs, activeTabId: activeTabId }; },
        hasUnsavedChanges: function () { return false; }, // es solo lectura, no hay nada que "perder" al volver a abrirlo
        destroy: function () {
          tabs.forEach(function (tab) {
            try { tab.pdfDoc && tab.pdfDoc.destroy(); } catch (e) { /* ignorar */ }
            deleteBlob(tab.blobKey).catch(function () { /* ignorar */ });
          });
          tabs = [];
          try { localStorage.removeItem(META_KEY); } catch (e) { /* ignorar */ }
        }
      };
    }
  };
})();
