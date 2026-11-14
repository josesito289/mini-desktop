/* ============================================================
   app-notepad.js — Bloc de notas (solo UTF-8)
   ============================================================ */
(function () {
  'use strict';
  window.MiniApps = window.MiniApps || {};

  var STORAGE_KEY = 'md_notepad_v1';

  function persist(state) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        filename: state.filename,
        content: state.content
      }));
    } catch (e) { console.warn('No se pudo guardar el bloc de notas:', e); }
  }

  window.MiniApps.notepad = {
    title: 'Bloc de notas',
    icon: '🗒',
    mount: function (bodyEl, savedState) {
      var state = {
        filename: (savedState && savedState.filename) || null,
        content: (savedState && savedState.content) || '',
        dirty: false
      };
      var saveTimer = null;

      // ---- construir DOM ----
      var toolbar = document.createElement('div');
      toolbar.className = 'app-toolbar';

      var btnNew = document.createElement('button');
      btnNew.className = 'bevel-out';
      btnNew.textContent = 'Nuevo';

      var btnOpen = document.createElement('button');
      btnOpen.className = 'bevel-out';
      btnOpen.textContent = 'Abrir archivo';

      var btnDownload = document.createElement('button');
      btnDownload.className = 'bevel-out';
      btnDownload.textContent = 'Descargar';

      var fileInput = document.createElement('input');
      fileInput.type = 'file';
      fileInput.accept = '.txt,text/plain';
      fileInput.style.display = 'none';

      var filenameLabel = document.createElement('span');
      filenameLabel.className = 'app-filename';

      var spacer = document.createElement('span');
      spacer.className = 'spacer';

      toolbar.appendChild(btnNew);
      toolbar.appendChild(btnOpen);
      toolbar.appendChild(btnDownload);
      toolbar.appendChild(spacer);
      toolbar.appendChild(filenameLabel);
      toolbar.appendChild(fileInput);

      var textarea = document.createElement('textarea');
      textarea.className = 'notepad-textarea';
      textarea.spellcheck = false;
      textarea.placeholder = 'Escribe aquí…';

      var statusbar = document.createElement('div');
      statusbar.className = 'app-statusbar';
      var countsSpan = document.createElement('span');
      var encodingSpan = document.createElement('span');
      encodingSpan.textContent = 'UTF-8';
      statusbar.appendChild(countsSpan);
      statusbar.appendChild(encodingSpan);

      bodyEl.appendChild(toolbar);
      bodyEl.appendChild(textarea);
      bodyEl.appendChild(statusbar);

      // ---- funciones ----
      function updateLabel() {
        filenameLabel.textContent = state.filename || 'Sin título';
      }
      function updateCounts() {
        var lines = state.content.length ? state.content.split('\n').length : 1;
        countsSpan.textContent = 'Líneas: ' + lines + '  ·  Caracteres: ' + state.content.length;
      }
      function schedulePersist() {
        if (saveTimer) clearTimeout(saveTimer);
        saveTimer = setTimeout(function () {
          persist(state);
        }, 400);
      }
      function applyLoaded(content, filename) {
        state.content = content;
        state.filename = filename;
        state.dirty = false;
        textarea.value = content;
        updateLabel();
        updateCounts();
        persist(state);
      }

      textarea.value = state.content;
      updateLabel();
      updateCounts();

      textarea.addEventListener('input', function () {
        state.content = textarea.value;
        state.dirty = true;
        updateCounts();
        schedulePersist();
      });

      btnNew.addEventListener('click', function () {
        function doNew() { applyLoaded('', null); }
        if (state.dirty) {
          window.MiniDesktopConfirm(
            'Tienes texto sin descargar. ¿Empezar un documento nuevo de todas formas?',
            doNew
          );
        } else {
          doNew();
        }
      });

      btnOpen.addEventListener('click', function () {
        function doOpen() { fileInput.click(); }
        if (state.dirty) {
          window.MiniDesktopConfirm(
            'Tienes texto sin descargar. ¿Abrir otro archivo de todas formas?',
            doOpen
          );
        } else {
          doOpen();
        }
      });

      fileInput.addEventListener('change', function () {
        var file = fileInput.files && fileInput.files[0];
        fileInput.value = '';
        if (!file) return;
        var reader = new FileReader();
        reader.onload = function () {
          applyLoaded(String(reader.result), file.name);
        };
        reader.onerror = function () {
          window.MiniDesktopModal({
            title: 'Error',
            message: 'No se pudo leer el archivo "' + file.name + '".',
            buttons: [{ label: 'Aceptar' }]
          });
        };
        reader.readAsText(file, 'utf-8');
      });

      btnDownload.addEventListener('click', function () {
        var name = state.filename || 'documento.txt';
        var blob = new Blob([state.content], { type: 'text/plain;charset=utf-8' });
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = name;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
        state.dirty = false;
      });

      return {
        getState: function () { return { filename: state.filename, content: state.content }; },
        hasUnsavedChanges: function () { return state.dirty; },
        destroy: function () {
          if (saveTimer) clearTimeout(saveTimer);
          try { localStorage.removeItem(STORAGE_KEY); } catch (e) { /* ignorar */ }
        }
      };
    }
  };
})();
