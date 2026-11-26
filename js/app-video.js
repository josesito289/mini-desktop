/* ============================================================
   app-video.js — Reproductor de video (solo lectura)
   Usa el <video> nativo del navegador con sus propios controles
   (play/pausa, barra de progreso, volumen, pantalla completa).
   No se persiste el archivo entre recargas de la PWA: como es
   solo reproducción, si cierras la app por completo simplemente
   vuelves a elegir el archivo con "Abrir video".
   ============================================================ */
(function () {
  'use strict';
  window.MiniApps = window.MiniApps || {};

  window.MiniApps.video = {
    title: 'Reproductor de video',
    icon: '🎬',
    mount: function (bodyEl) {
      var currentUrl = null;

      // ---- toolbar ----
      var toolbar = document.createElement('div');
      toolbar.className = 'app-toolbar';
      var btnOpen = document.createElement('button');
      btnOpen.className = 'bevel-out';
      btnOpen.textContent = 'Abrir video';
      var fileInput = document.createElement('input');
      fileInput.type = 'file';
      fileInput.accept = 'video/*';
      fileInput.style.display = 'none';
      var filenameLabel = document.createElement('span');
      filenameLabel.className = 'app-filename';
      var spacer = document.createElement('span');
      spacer.className = 'spacer';
      toolbar.appendChild(btnOpen);
      toolbar.appendChild(spacer);
      toolbar.appendChild(filenameLabel);
      toolbar.appendChild(fileInput);

      // ---- área de reproducción ----
      var mediaWrap = document.createElement('div');
      mediaWrap.className = 'media-wrap';
      var emptyMsg = document.createElement('div');
      emptyMsg.className = 'media-empty';
      emptyMsg.textContent = 'No hay ningún video abierto. Usa "Abrir video".';
      mediaWrap.appendChild(emptyMsg);

      var video = document.createElement('video');
      video.className = 'video-player';
      video.controls = true;
      video.setAttribute('playsinline', '');

      bodyEl.appendChild(toolbar);
      bodyEl.appendChild(mediaWrap);

      function openFile(file) {
        if (currentUrl) { URL.revokeObjectURL(currentUrl); currentUrl = null; }
        currentUrl = URL.createObjectURL(file);
        video.src = currentUrl;
        mediaWrap.innerHTML = '';
        mediaWrap.appendChild(video);
        filenameLabel.textContent = file.name;
        video.play().catch(function () {
          // el navegador puede bloquear el autoplay si no hubo interacción
          // reciente; no es un error, el usuario solo tiene que darle play.
        });
      }

      btnOpen.addEventListener('click', function () { fileInput.click(); });
      fileInput.addEventListener('change', function () {
        var file = fileInput.files && fileInput.files[0];
        fileInput.value = '';
        if (!file) return;
        if (file.type && file.type.indexOf('video/') !== 0) {
          window.MiniDesktopModal({
            title: 'Archivo no válido',
            message: '"' + file.name + '" no parece ser un archivo de video.',
            buttons: [{ label: 'Aceptar' }]
          });
          return;
        }
        openFile(file);
      });

      return {
        hasUnsavedChanges: function () { return false; }, // es solo reproducción, no hay nada que "perder"
        destroy: function () {
          try { video.pause(); } catch (e) { /* ignorar */ }
          if (currentUrl) { URL.revokeObjectURL(currentUrl); currentUrl = null; }
        }
      };
    }
  };
})();
