/* ============================================================
   shell.js — gestor de ventanas de Mini Desktop
   Reglas:
   - Solo 3 apps posibles: notepad, sheet, pdf (fijas, no instancias).
   - Máximo 2 visibles a la vez, en slot "left" / "right".
   - Estados por app: 'closed' | 'open' | 'minimized'.
   - "-" minimiza (el contenido sigue vivo, oculto en #tray).
   - "X" cierra de verdad (se destruye y se borra su almacenamiento).
   ============================================================ */
(function () {
  'use strict';

  var APP_ORDER = ['notepad', 'sheet', 'pdf'];
  var STORAGE_KEY = 'md_shell_v1';

  var els = {};
  var instances = {}; // appId -> { el, controller }
  var shellState = {
    layout: { left: null, right: null },
    apps: { notepad: 'closed', sheet: 'closed', pdf: 'closed' },
    // view.mode: '100' | '78-22' | '50-50'. view.bigSide: 'left' | 'right'
    // (en modo '50-50' bigSide no afecta nada, los dos miden igual).
    view: { mode: '50-50', bigSide: 'left' }
  };

  // ---------- utilidades de almacenamiento ----------
  function loadShellState() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      var parsed = JSON.parse(raw);
      if (parsed && parsed.layout && parsed.apps) {
        shellState = parsed;
        if (!shellState.view) {
          shellState.view = { mode: '50-50', bigSide: 'left' }; // estado guardado por una versión anterior
        }
      }
    } catch (e) {
      console.warn('No se pudo leer el estado del escritorio guardado:', e);
    }
  }
  function persistShellState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(shellState));
    } catch (e) {
      console.warn('No se pudo guardar el estado del escritorio:', e);
    }
  }
  function loadAppData(appId) {
    try {
      var raw = localStorage.getItem('md_' + appId + '_v1');
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  // ---------- modal genérico (confirmaciones / elegir slot) ----------
  function showModal(opts) {
    // opts: { title, message, buttons: [{label, onClick}] }
    var overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    var box = document.createElement('div');
    box.className = 'modal-box bevel-out';
    var titlebar = document.createElement('div');
    titlebar.className = 'modal-titlebar';
    titlebar.textContent = opts.title || 'Mini Desktop';
    var body = document.createElement('div');
    body.className = 'modal-body';
    if (typeof opts.message === 'string') {
      body.textContent = opts.message;
    } else if (opts.message instanceof Node) {
      body.appendChild(opts.message);
    }
    var actions = document.createElement('div');
    actions.className = 'modal-actions';
    (opts.buttons || []).forEach(function (btnDef) {
      var b = document.createElement('button');
      b.className = 'bevel-out';
      b.textContent = btnDef.label;
      b.addEventListener('click', function () {
        document.body.removeChild(overlay);
        if (btnDef.onClick) btnDef.onClick();
      });
      actions.appendChild(b);
    });
    box.appendChild(titlebar);
    box.appendChild(body);
    box.appendChild(actions);
    overlay.appendChild(box);
    document.body.appendChild(overlay);
    return overlay;
  }
  window.MiniDesktopModal = showModal; // expuesto para las mini-apps

  function confirmAction(message, onConfirm) {
    showModal({
      title: 'Confirmar',
      message: message,
      buttons: [
        { label: 'Cancelar' },
        { label: 'Continuar', onClick: onConfirm }
      ]
    });
  }
  window.MiniDesktopConfirm = confirmAction;

  // ---------- creación / montaje de ventanas ----------
  function appTitle(appId) {
    var def = window.MiniApps && window.MiniApps[appId];
    return def ? def.title : appId;
  }
  function appIcon(appId) {
    var def = window.MiniApps && window.MiniApps[appId];
    return def ? def.icon : '';
  }

  function createWindowEl(appId) {
    var tpl = document.getElementById('tpl-window');
    var frag = tpl.content.cloneNode(true);
    var winEl = frag.querySelector('.window');
    winEl.dataset.app = appId;
    winEl.querySelector('.window-icon').textContent = appIcon(appId);
    winEl.querySelector('.window-title').textContent = appTitle(appId);
    winEl.querySelector('.win-min').addEventListener('click', function () {
      minimizeApp(appId);
    });
    winEl.querySelector('.win-close').addEventListener('click', function () {
      closeApp(appId);
    });
    return winEl;
  }

  function ensureInstance(appId) {
    if (instances[appId]) return instances[appId];
    var def = window.MiniApps && window.MiniApps[appId];
    if (!def) {
      console.error('Mini-app no encontrada:', appId);
      return null;
    }
    var winEl = createWindowEl(appId);
    var bodyEl = winEl.querySelector('.window-body');
    var savedData = loadAppData(appId);
    var controller = def.mount(bodyEl, savedData);
    els.tray.appendChild(winEl); // por defecto arranca oculto en la bandeja
    instances[appId] = { el: winEl, controller: controller };
    return instances[appId];
  }

  function moveElToSlot(appId, side) {
    var inst = instances[appId];
    if (!inst) return;
    var target = side === 'left' ? els.slotLeft : els.slotRight;
    clearSlotHint(target);
    target.appendChild(inst.el);
  }
  function moveElToTray(appId) {
    var inst = instances[appId];
    if (!inst) return;
    els.tray.appendChild(inst.el);
  }
  function clearSlotHint(slotEl) {
    var hint = slotEl.querySelector('.slot-empty-hint');
    if (hint) hint.remove();
  }
  function renderSlotHints() {
    [['left', els.slotLeft], ['right', els.slotRight]].forEach(function (pair) {
      var side = pair[0], slotEl = pair[1];
      var occupied = shellState.layout[side];
      var hint = slotEl.querySelector('.slot-empty-hint');
      if (!occupied && !hint) {
        var h = document.createElement('div');
        h.className = 'slot-empty-hint';
        h.textContent = 'Vacío — usa Inicio o un icono para abrir una app aquí';
        slotEl.appendChild(h);
      } else if (occupied && hint) {
        hint.remove();
      }
    });
  }

  // ---------- transiciones de estado ----------
  function placeInSlot(appId) {
    if (shellState.view.mode === '100') {
      placeInSingleSlot(appId);
      return;
    }
    var layout = shellState.layout;
    if (!layout.left) {
      layout.left = appId;
      moveElToSlot(appId, 'left');
      finishOpen(appId);
      return;
    }
    if (!layout.right) {
      layout.right = appId;
      moveElToSlot(appId, 'right');
      finishOpen(appId);
      return;
    }
    // ambos slots ocupados -> preguntar cuál reemplazar
    var leftName = appTitle(layout.left);
    var rightName = appTitle(layout.right);
    showModal({
      title: 'Elegir ventana',
      message: 'Ya hay dos ventanas abiertas. ¿Cuál quieres reemplazar con ' + appTitle(appId) + '?',
      buttons: [
        { label: 'Izquierda (' + leftName + ')', onClick: function () { replaceSlot('left', appId); } },
        { label: 'Derecha (' + rightName + ')', onClick: function () { replaceSlot('right', appId); } },
        { label: 'Cancelar' }
      ]
    });
  }
  function replaceSlot(side, appId) {
    var victim = shellState.layout[side];
    if (victim) {
      shellState.layout[side] = null;
      moveElToTray(victim);
      shellState.apps[victim] = 'minimized';
    }
    shellState.layout[side] = appId;
    moveElToSlot(appId, side);
    finishOpen(appId);
  }
  function finishOpen(appId) {
    shellState.apps[appId] = 'open';
    persistShellState();
    renderTaskbar();
    renderSlotHints();
  }

  // En modo "100%" solo existe un slot activo (el que marca view.bigSide).
  // Si ya había otra app ahí, se minimiza (no se pierde, solo se oculta).
  function placeInSingleSlot(appId) {
    var layout = shellState.layout;
    var side = shellState.view.bigSide;
    var otherSide = side === 'left' ? 'right' : 'left';
    if (layout[otherSide]) {
      var leftover = layout[otherSide];
      layout[otherSide] = null;
      moveElToTray(leftover);
      shellState.apps[leftover] = 'minimized';
    }
    if (layout[side] && layout[side] !== appId) {
      var victim = layout[side];
      layout[side] = null;
      moveElToTray(victim);
      shellState.apps[victim] = 'minimized';
    }
    layout[side] = appId;
    moveElToSlot(appId, side);
    finishOpen(appId);
  }

  // ---------- vista: 100% / 78-22 / 50-50 ----------
  function viewLabel() {
    var side = shellState.view.bigSide === 'left' ? 'Izq' : 'Der';
    switch (shellState.view.mode) {
      case '100': return '100% (' + side + ')';
      case '78-22': return '78/22 (grande: ' + side + ')';
      default: return '50/50';
    }
  }
  function renderViewLabel() {
    if (els.viewBtn) els.viewBtn.textContent = 'Vista: ' + viewLabel();
  }
  function applyViewMode(mode, bigSide) {
    shellState.view = { mode: mode, bigSide: bigSide };
    var leftPct, rightPct;
    if (mode === '100') {
      leftPct = bigSide === 'left' ? 100 : 0;
    } else if (mode === '78-22') {
      leftPct = bigSide === 'left' ? 78 : 22;
    } else {
      leftPct = 50;
    }
    rightPct = 100 - leftPct;
    document.documentElement.style.setProperty('--slot-a', leftPct + '%');
    document.documentElement.style.setProperty('--slot-b', rightPct + '%');
    els.slotLeft.classList.toggle('slot-zero', leftPct === 0);
    els.slotRight.classList.toggle('slot-zero', rightPct === 0);

    if (mode === '100') {
      var hiddenSide = bigSide === 'left' ? 'right' : 'left';
      var hiddenApp = shellState.layout[hiddenSide];
      if (hiddenApp) {
        shellState.layout[hiddenSide] = null;
        moveElToTray(hiddenApp);
        shellState.apps[hiddenApp] = 'minimized';
      }
    }
    persistShellState();
    renderTaskbar();
    renderSlotHints();
    renderViewLabel();
  }
  function promptBigSide(mode) {
    var leftLabel = shellState.layout.left ? appTitle(shellState.layout.left) : 'vacío';
    var rightLabel = shellState.layout.right ? appTitle(shellState.layout.right) : 'vacío';
    var question = mode === '100'
      ? '¿Qué ventana quieres ver a pantalla completa?'
      : '¿Qué lado quieres que sea el grande (78%)?';
    showModal({
      title: 'Elegir lado',
      message: question,
      buttons: [
        { label: 'Izquierda (' + leftLabel + ')', onClick: function () { applyViewMode(mode, 'left'); } },
        { label: 'Derecha (' + rightLabel + ')', onClick: function () { applyViewMode(mode, 'right'); } },
        { label: 'Cancelar' }
      ]
    });
  }
  function openViewMenu() {
    showModal({
      title: 'Vista de pantalla',
      message: 'Elige cómo repartir el espacio entre las dos ventanas.',
      buttons: [
        { label: 'Pantalla completa (100%)', onClick: function () { promptBigSide('100'); } },
        { label: '78% / 22%', onClick: function () { promptBigSide('78-22'); } },
        { label: '50% / 50%', onClick: function () { applyViewMode('50-50', 'left'); } },
        { label: 'Cancelar' }
      ]
    });
  }

  function openApp(appId) {
    var status = shellState.apps[appId];
    if (status === 'open') {
      return; // ya visible, nada que hacer
    }
    var inst = ensureInstance(appId);
    if (!inst) return;
    placeInSlot(appId);
    closeStartMenu();
  }

  function minimizeApp(appId) {
    var layout = shellState.layout;
    if (layout.left === appId) layout.left = null;
    if (layout.right === appId) layout.right = null;
    moveElToTray(appId);
    shellState.apps[appId] = 'minimized';
    persistShellState();
    renderTaskbar();
    renderSlotHints();
  }

  function closeApp(appId) {
    var inst = instances[appId];
    var hasChanges = false;
    try {
      hasChanges = !!(inst && inst.controller.hasUnsavedChanges && inst.controller.hasUnsavedChanges());
    } catch (e) { /* ignorar */ }
    if (hasChanges) {
      confirmAction(
        'Hay cambios en "' + appTitle(appId) + '" que no has descargado. Si cierras, se pierden. ¿Cerrar de todas formas?',
        function () { reallyClose(appId); }
      );
    } else {
      reallyClose(appId);
    }
  }
  function reallyClose(appId) {
    var layout = shellState.layout;
    if (layout.left === appId) layout.left = null;
    if (layout.right === appId) layout.right = null;
    var inst = instances[appId];
    if (inst) {
      try { inst.controller.destroy && inst.controller.destroy(); } catch (e) { console.warn(e); }
      if (inst.el && inst.el.parentNode) inst.el.parentNode.removeChild(inst.el);
      delete instances[appId];
    }
    shellState.apps[appId] = 'closed';
    persistShellState();
    renderTaskbar();
    renderSlotHints();
  }

  // ---------- barra de tareas ----------
  function renderTaskbar() {
    els.taskbarApps.innerHTML = '';
    APP_ORDER.forEach(function (appId) {
      var status = shellState.apps[appId];
      if (status === 'closed') return;
      var btn = document.createElement('button');
      btn.className = 'taskbar-btn bevel-out' + (status === 'open' ? ' active' : '');
      btn.textContent = appIcon(appId) + ' ' + appTitle(appId);
      btn.addEventListener('click', function () {
        if (shellState.apps[appId] === 'open') {
          minimizeApp(appId);
        } else {
          openApp(appId);
        }
      });
      els.taskbarApps.appendChild(btn);
    });
  }

  function closeStartMenu() {
    els.startMenu.classList.add('hidden');
  }
  function toggleStartMenu() {
    els.startMenu.classList.toggle('hidden');
  }

  // ---------- reloj ----------
  function tickClock() {
    var now = new Date();
    var hh = String(now.getHours()).padStart(2, '0');
    var mm = String(now.getMinutes()).padStart(2, '0');
    els.clock.textContent = hh + ':' + mm;
  }

  // ---------- arranque ----------
  function hydrateFromSavedState() {
    APP_ORDER.forEach(function (appId) {
      var status = shellState.apps[appId];
      if (status === 'closed') return;
      var inst = ensureInstance(appId); // crea el DOM + monta con su propia data guardada
      if (!inst) return;
      if (status === 'open') {
        var side = shellState.layout.left === appId ? 'left' : (shellState.layout.right === appId ? 'right' : null);
        if (side) {
          moveElToSlot(appId, side);
        } else {
          // estado inconsistente: lo dejamos minimizado en vez de romper
          shellState.apps[appId] = 'minimized';
        }
      }
      // si está 'minimized' ya quedó en el tray por ensureInstance()
    });
  }

  function init() {
    els.slotLeft = document.getElementById('slot-left');
    els.slotRight = document.getElementById('slot-right');
    els.tray = document.getElementById('tray');
    els.taskbarApps = document.getElementById('taskbar-apps');
    els.startBtn = document.getElementById('start-btn');
    els.startMenu = document.getElementById('start-menu');
    els.viewBtn = document.getElementById('view-btn');
    els.clock = document.getElementById('clock');

    loadShellState();
    hydrateFromSavedState();
    applyViewMode(shellState.view.mode, shellState.view.bigSide);

    els.viewBtn.addEventListener('click', openViewMenu);
    els.startBtn.addEventListener('click', toggleStartMenu);
    els.startMenu.querySelectorAll('button[data-app]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        openApp(btn.dataset.app);
      });
    });
    document.querySelectorAll('.desktop-icon[data-app]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        openApp(btn.dataset.app);
      });
    });
    document.addEventListener('click', function (ev) {
      if (!els.startMenu.classList.contains('hidden')) {
        if (!els.startMenu.contains(ev.target) && ev.target !== els.startBtn) {
          closeStartMenu();
        }
      }
    });

    tickClock();
    setInterval(tickClock, 15000);

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('service-worker.js').catch(function (e) {
        console.warn('No se pudo registrar el service worker:', e);
      });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
