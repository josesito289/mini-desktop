/* ============================================================
   app-audio.js — Reproductor de audio (solo lectura)
   Usa el <audio> nativo + la Media Session API para que:
   - siga sonando aunque apagues la pantalla o minimices la ventana
     dentro del escritorio (se mueve a la bandeja oculta, pero el
     elemento <audio> sigue vivo y sonando).
   - aparezcan controles (play/pausa) en la pantalla de bloqueo /
     notificaciones de Android.
   No se persiste el archivo entre recargas completas de la PWA.
   ============================================================ */
(function () {
  'use strict';
  window.MiniApps = window.MiniApps || {};

  window.MiniApps.audio = {
    title: 'Reproductor de audio',
    icon: '🎵',
    mount: function (bodyEl) {
      var currentUrl = null;

      // ---- toolbar ----
      var toolbar = document.createElement('div');
      toolbar.className = 'app-toolbar';
      var btnOpen = document.createElement('button');
      btnOpen.className = 'bevel-out';
      btnOpen.textContent = 'Abrir audio';
      var fileInput = document.createElement('input');
      fileInput.type = 'file';
      fileInput.accept = 'audio/*';
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
      mediaWrap.className = 'media-wrap audio-wrap';
      var emptyMsg = document.createElement('div');
      emptyMsg.className = 'media-empty';
      emptyMsg.textContent = 'No hay ningún audio abierto. Usa "Abrir audio".';
      mediaWrap.appendChild(emptyMsg);

      var audio = document.createElement('audio');
      audio.className = 'audio-player';
      audio.controls = true;

      var statusbar = document.createElement('div');
      statusbar.className = 'app-statusbar';
      var bgNote = document.createElement('span');
      bgNote.textContent = 'Sigue sonando al apagar la pantalla o minimizar esta ventana.';
      statusbar.appendChild(bgNote);

      bodyEl.appendChild(toolbar);
      bodyEl.appendChild(mediaWrap);
      bodyEl.appendChild(statusbar);

      // ---- Media Session: controles en pantalla de bloqueo / notificación ----
      function setupMediaSession(file) {
        if (!('mediaSession' in navigator)) return;
        try {
          navigator.mediaSession.metadata = new MediaMetadata({
            title: file.name,
            artist: 'Mini Desktop'
          });
          navigator.mediaSession.setActionHandler('play', function () { audio.play(); });
          navigator.mediaSession.setActionHandler('pause', function () { audio.pause(); });
          navigator.mediaSession.setActionHandler('seekbackward', function (details) {
            audio.currentTime = Math.max(0, audio.currentTime - (details.seekOffset || 10));
          });
          navigator.mediaSession.setActionHandler('seekforward', function (details) {
            var dur = isNaN(audio.duration) ? Infinity : audio.duration;
            audio.currentTime = Math.min(dur, audio.currentTime + (details.seekOffset || 10));
          });
        } catch (e) {
          console.warn('Media Session no disponible en este navegador:', e);
        }
      }
      function clearMediaSession() {
        if (!('mediaSession' in navigator)) return;
        try {
          navigator.mediaSession.metadata = null;
          navigator.mediaSession.setActionHandler('play', null);
          navigator.mediaSession.setActionHandler('pause', null);
          navigator.mediaSession.setActionHandler('seekbackward', null);
          navigator.mediaSession.setActionHandler('seekforward', null);
        } catch (e) { /* ignorar */ }
      }
      audio.addEventListener('play', function () {
        if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'playing';
      });
      audio.addEventListener('pause', function () {
        if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'paused';
      });

      function openFile(file) {
        if (currentUrl) { URL.revokeObjectURL(currentUrl); currentUrl = null; }
        currentUrl = URL.createObjectURL(file);
        audio.src = currentUrl;
        mediaWrap.innerHTML = '';
        mediaWrap.appendChild(audio);
        filenameLabel.textContent = file.name;
        setupMediaSession(file);
        audio.play().catch(function () {
          // autoplay bloqueado por el navegador; el usuario le da play manualmente
        });
      }

      btnOpen.addEventListener('click', function () { fileInput.click(); });
      fileInput.addEventListener('change', function () {
        var file = fileInput.files && fileInput.files[0];
        fileInput.value = '';
        if (!file) return;
        if (file.type && file.type.indexOf('audio/') !== 0) {
          window.MiniDesktopModal({
            title: 'Archivo no válido',
            message: '"' + file.name + '" no parece ser un archivo de audio.',
            buttons: [{ label: 'Aceptar' }]
          });
          return;
        }
        openFile(file);
      });

      return {
        hasUnsavedChanges: function () { return false; }, // es solo reproducción, no hay nada que "perder"
        destroy: function () {
          try { audio.pause(); } catch (e) { /* ignorar */ }
          if (currentUrl) { URL.revokeObjectURL(currentUrl); currentUrl = null; }
          clearMediaSession();
        }
      };
    }
  };
})();
