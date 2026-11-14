/* ============================================================
   app-sheet.js — Hoja de cálculo básica
   - Grilla fija de 10 columnas (A-J) x 25 filas.
   - Fórmulas: + - * /, paréntesis, SUMA(rango|lista), BUSCARV(valor,rango,col)
   - Filtros por columna (mostrar/ocultar filas).
   - Abre/descarga .csv (no .xlsx).
   ============================================================ */
(function () {
  'use strict';
  window.MiniApps = window.MiniApps || {};

  var COLS = 10; // A..J
  var ROWS = 25;
  var STORAGE_KEY = 'md_sheet_v1';

  function colLetter(index) { return String.fromCharCode(65 + index); } // 0 -> A
  function colIndexFromLetter(letters) {
    var n = 0;
    for (var i = 0; i < letters.length; i++) {
      n = n * 26 + (letters.charCodeAt(i) - 64);
    }
    return n - 1;
  }
  function refOf(c, r) { return colLetter(c) + (r + 1); } // r,c son 0-index
  function parseRef(ref) {
    var m = /^([A-Za-z]+)(\d+)$/.exec(ref);
    if (!m) return null;
    return { c: colIndexFromLetter(m[1].toUpperCase()), r: parseInt(m[2], 10) - 1 };
  }

  // ---------------- motor de fórmulas ----------------
  function tokenize(expr) {
    var tokens = [];
    var i = 0;
    while (i < expr.length) {
      var ch = expr[i];
      if (ch === ' ' || ch === '\t') { i++; continue; }
      if ('+-*/(),:'.indexOf(ch) !== -1) { tokens.push({ t: ch }); i++; continue; }
      if (ch === '"') {
        var j = i + 1, str = '';
        while (j < expr.length && expr[j] !== '"') { str += expr[j]; j++; }
        tokens.push({ t: 'STRING', v: str });
        i = j + 1;
        continue;
      }
      if (/[0-9.]/.test(ch)) {
        var num = '';
        while (i < expr.length && /[0-9.]/.test(expr[i])) { num += expr[i]; i++; }
        tokens.push({ t: 'NUMBER', v: parseFloat(num) });
        continue;
      }
      if (/[A-Za-z]/.test(ch)) {
        var word = '';
        while (i < expr.length && /[A-Za-z0-9]/.test(expr[i])) { word += expr[i]; i++; }
        // ¿es una referencia de celda (letras + números) o un nombre de función (solo letras)?
        if (/^[A-Za-z]+\d+$/.test(word)) {
          tokens.push({ t: 'REF', v: word.toUpperCase() });
        } else {
          tokens.push({ t: 'NAME', v: word.toUpperCase() });
        }
        continue;
      }
      throw new Error('Carácter no reconocido: ' + ch);
    }
    return tokens;
  }

  function Parser(tokens) {
    this.tokens = tokens;
    this.pos = 0;
  }
  Parser.prototype.peek = function () { return this.tokens[this.pos]; };
  Parser.prototype.next = function () { return this.tokens[this.pos++]; };
  Parser.prototype.expect = function (t) {
    var tok = this.next();
    if (!tok || tok.t !== t) throw new Error('Se esperaba "' + t + '"');
    return tok;
  };

  // expr := term (('+'|'-') term)*
  Parser.prototype.parseExpr = function () {
    var node = this.parseTerm();
    while (this.peek() && (this.peek().t === '+' || this.peek().t === '-')) {
      var op = this.next().t;
      var right = this.parseTerm();
      node = { type: 'bin', op: op, left: node, right: right };
    }
    return node;
  };
  // term := factor (('*'|'/') factor)*
  Parser.prototype.parseTerm = function () {
    var node = this.parseFactor();
    while (this.peek() && (this.peek().t === '*' || this.peek().t === '/')) {
      var op = this.next().t;
      var right = this.parseFactor();
      node = { type: 'bin', op: op, left: node, right: right };
    }
    return node;
  };
  // factor := NUMBER | STRING | REF | '(' expr ')' | '-' factor | NAME '(' args ')'
  Parser.prototype.parseFactor = function () {
    var tok = this.peek();
    if (!tok) throw new Error('Expresión incompleta');
    if (tok.t === '-') { this.next(); return { type: 'neg', value: this.parseFactor() }; }
    if (tok.t === 'NUMBER') { this.next(); return { type: 'num', value: tok.v }; }
    if (tok.t === 'STRING') { this.next(); return { type: 'str', value: tok.v }; }
    if (tok.t === 'REF') { this.next(); return { type: 'ref', value: tok.v }; }
    if (tok.t === '(') {
      this.next();
      var inner = this.parseExpr();
      this.expect(')');
      return inner;
    }
    if (tok.t === 'NAME') {
      this.next();
      this.expect('(');
      var args = [];
      if (this.peek() && this.peek().t !== ')') {
        args.push(this.parseArg());
        while (this.peek() && this.peek().t === ',') {
          this.next();
          args.push(this.parseArg());
        }
      }
      this.expect(')');
      return { type: 'call', name: tok.v, args: args };
    }
    throw new Error('Token inesperado');
  };
  // arg := REF ':' REF  |  expr
  Parser.prototype.parseArg = function () {
    if (this.peek() && this.peek().t === 'REF' &&
        this.tokens[this.pos + 1] && this.tokens[this.pos + 1].t === ':') {
      var from = this.next().v;
      this.next(); // ':'
      var to = this.expect('REF').v;
      return { type: 'range', from: from, to: to };
    }
    return this.parseExpr();
  };

  function evalFormula(expr, cells) {
    var tokens = tokenize(expr);
    var ast = new Parser(tokens).parseExpr();
    var visiting = {};
    return evalNode(ast, cells, visiting);
  }

  function toNumber(v) {
    if (typeof v === 'number') return v;
    var s = String(v).trim();
    if (s === '') return 0;
    var n = parseFloat(s);
    if (isNaN(n)) throw new Error('#VALOR');
    return n;
  }

  function getCellRaw(ref, cells) { return cells[ref] || ''; }

  function getCellNumeric(ref, cells, visiting) {
    if (visiting[ref]) throw new Error('#CIRCULAR');
    visiting[ref] = true;
    var raw = getCellRaw(ref, cells);
    var result;
    if (raw.charAt(0) === '=') {
      var tokens = tokenize(raw.slice(1));
      var ast = new Parser(tokens).parseExpr();
      result = evalNode(ast, cells, visiting);
    } else {
      result = toNumber(raw);
    }
    delete visiting[ref];
    return result;
  }

  function getCellDisplayRaw(ref, cells, visiting) {
    visiting = visiting || {};
    if (visiting[ref]) throw new Error('#CIRCULAR');
    var raw = getCellRaw(ref, cells);
    if (raw.charAt(0) === '=') {
      visiting[ref] = true;
      var tokens = tokenize(raw.slice(1));
      var ast = new Parser(tokens).parseExpr();
      var v = evalNode(ast, cells, visiting);
      delete visiting[ref];
      return String(v);
    }
    return raw.trim();
  }

  function expandRange(from, to) {
    var a = parseRef(from), b = parseRef(to);
    if (!a || !b) throw new Error('#REF');
    var c0 = Math.min(a.c, b.c), c1 = Math.max(a.c, b.c);
    var r0 = Math.min(a.r, b.r), r1 = Math.max(a.r, b.r);
    var refs = [];
    for (var r = r0; r <= r1; r++) {
      var row = [];
      for (var c = c0; c <= c1; c++) row.push(refOf(c, r));
      refs.push(row);
    }
    return refs; // matriz [fila][col] de referencias
  }

  function evalNode(node, cells, visiting) {
    switch (node.type) {
      case 'num': return node.value;
      case 'str': return node.value;
      case 'neg': return -toNumber(evalNode(node.value, cells, visiting));
      case 'ref': return getCellNumeric(node.value, cells, visiting);
      case 'bin': {
        var l = toNumber(evalNode(node.left, cells, visiting));
        var r = toNumber(evalNode(node.right, cells, visiting));
        switch (node.op) {
          case '+': return l + r;
          case '-': return l - r;
          case '*': return l * r;
          case '/':
            if (r === 0) throw new Error('#DIV/0');
            return l / r;
        }
        break;
      }
      case 'call': return evalFunction(node.name, node.args, cells, visiting);
      case 'range':
        throw new Error('#VALOR'); // un rango no es un valor por sí solo
    }
    throw new Error('#ERROR');
  }

  function evalFunction(name, args, cells, visiting) {
    if (name === 'SUMA' || name === 'SUM') {
      var total = 0;
      args.forEach(function (arg) {
        if (arg.type === 'range') {
          expandRange(arg.from, arg.to).forEach(function (row) {
            row.forEach(function (ref) {
              var raw = getCellRaw(ref, cells);
              if (raw.trim() !== '') total += toNumber(getCellNumeric(ref, cells, visiting));
            });
          });
        } else {
          total += toNumber(evalNode(arg, cells, visiting));
        }
      });
      return total;
    }
    if (name === 'BUSCARV' || name === 'VLOOKUP') {
      if (args.length < 3) throw new Error('#ARGS');
      var buscado = evalNode(args[0], cells, visiting);
      var buscadoStr = String(buscado).trim().toLowerCase();
      var rangeArg = args[1];
      if (rangeArg.type !== 'range') throw new Error('#VALOR');
      var colOffset = Math.round(toNumber(evalNode(args[2], cells, visiting))) - 1;
      var grid = expandRange(rangeArg.from, rangeArg.to);
      for (var r = 0; r < grid.length; r++) {
        var row = grid[r];
        if (colOffset < 0 || colOffset >= row.length) throw new Error('#REF');
        var firstVal = getCellDisplayRaw(row[0], cells, {}).toLowerCase();
        var firstNum = null, buscadoNum = null;
        var fv = parseFloat(firstVal), bv = parseFloat(buscadoStr);
        var isMatch;
        if (!isNaN(fv) && !isNaN(bv)) {
          isMatch = fv === bv;
        } else {
          isMatch = firstVal === buscadoStr;
        }
        if (isMatch) {
          var resultRaw = getCellDisplayRaw(row[colOffset], cells, {});
          var resultNum = parseFloat(resultRaw);
          return isNaN(resultNum) ? resultRaw : resultNum;
        }
      }
      throw new Error('#N/A');
    }
    throw new Error('#NOMBRE?');
  }

  // ---------------- CSV ----------------
  function parseCSV(text) {
    var rows = [];
    var i = 0, field = '', row = [], inQuotes = false;
    function pushField() { row.push(field); field = ''; }
    function pushRow() { pushField(); rows.push(row); row = []; }
    while (i < text.length) {
      var ch = text[i];
      if (inQuotes) {
        if (ch === '"') {
          if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
          inQuotes = false; i++; continue;
        }
        field += ch; i++; continue;
      }
      if (ch === '"') { inQuotes = true; i++; continue; }
      if (ch === ',') { pushField(); i++; continue; }
      if (ch === '\r') { i++; continue; }
      if (ch === '\n') { pushRow(); i++; continue; }
      field += ch; i++;
    }
    if (field !== '' || row.length) pushRow();
    return rows;
  }
  function toCSV(rows) {
    return rows.map(function (row) {
      return row.map(function (field) {
        field = field == null ? '' : String(field);
        if (/[",\n]/.test(field)) {
          return '"' + field.replace(/"/g, '""') + '"';
        }
        return field;
      }).join(',');
    }).join('\n');
  }

  // ---------------- UI ----------------
  function persist(cells, filters) {
    try {
      var serializedFilters = {};
      Object.keys(filters).forEach(function (c) {
        serializedFilters[c] = Array.from(filters[c]);
      });
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ cells: cells, filters: serializedFilters }));
    } catch (e) { console.warn('No se pudo guardar la hoja de cálculo:', e); }
  }

  window.MiniApps.sheet = {
    title: 'Hoja de cálculo',
    icon: '▦',
    mount: function (bodyEl, savedState) {
      var cells = (savedState && savedState.cells) || {};
      var filters = {}; // colIndex -> Set de valores EXCLUIDOS
      if (savedState && savedState.filters) {
        Object.keys(savedState.filters).forEach(function (c) {
          filters[c] = new Set(savedState.filters[c]);
        });
      }
      var dirty = false;
      var focusedRef = null;
      var saveTimer = null;
      var displayCache = {};
      var inputsByRef = {};
      var rowEls = [];

      // ---- toolbar ----
      var toolbar = document.createElement('div');
      toolbar.className = 'app-toolbar';
      var btnNew = document.createElement('button'); btnNew.className = 'bevel-out'; btnNew.textContent = 'Nuevo';
      var btnOpen = document.createElement('button'); btnOpen.className = 'bevel-out'; btnOpen.textContent = 'Abrir .csv';
      var btnDownload = document.createElement('button'); btnDownload.className = 'bevel-out'; btnDownload.textContent = 'Descargar .csv';
      var fileInput = document.createElement('input');
      fileInput.type = 'file'; fileInput.accept = '.csv,text/csv'; fileInput.style.display = 'none';
      toolbar.appendChild(btnNew);
      toolbar.appendChild(btnOpen);
      toolbar.appendChild(btnDownload);
      toolbar.appendChild(fileInput);

      // ---- barra de fórmulas ----
      var formulaBar = document.createElement('div');
      formulaBar.className = 'sheet-formulabar';
      var cellRefLabel = document.createElement('div');
      cellRefLabel.className = 'sheet-cellref bevel-in';
      cellRefLabel.textContent = 'A1';
      var formulaInput = document.createElement('input');
      formulaInput.className = 'sheet-formulainput bevel-in';
      formulaBar.appendChild(cellRefLabel);
      formulaBar.appendChild(formulaInput);

      // ---- grilla ----
      var gridWrap = document.createElement('div');
      gridWrap.className = 'sheet-grid-wrap';
      var table = document.createElement('table');
      table.className = 'sheet-grid';
      var thead = document.createElement('thead');
      var headRow = document.createElement('tr');
      var corner = document.createElement('th');
      corner.className = 'corner';
      headRow.appendChild(corner);
      var headerCells = [];
      for (var c = 0; c < COLS; c++) {
        var th = document.createElement('th');
        th.textContent = colLetter(c);
        th.dataset.col = c;
        headerCells.push(th);
        headRow.appendChild(th);
      }
      thead.appendChild(headRow);
      table.appendChild(thead);

      var tbody = document.createElement('tbody');
      for (var r = 0; r < ROWS; r++) {
        var tr = document.createElement('tr');
        var tdNum = document.createElement('td');
        tdNum.className = 'rownum';
        tdNum.textContent = String(r + 1);
        tr.appendChild(tdNum);
        for (var cc = 0; cc < COLS; cc++) {
          var td = document.createElement('td');
          var input = document.createElement('input');
          input.className = 'sheet-cell-input';
          var ref = refOf(cc, r);
          input.dataset.ref = ref;
          td.appendChild(input);
          tr.appendChild(td);
          inputsByRef[ref] = input;
        }
        tbody.appendChild(tr);
        rowEls.push(tr);
      }
      table.appendChild(tbody);
      gridWrap.appendChild(table);

      var statusbar = document.createElement('div');
      statusbar.className = 'app-statusbar';
      var statusInfo = document.createElement('span');
      statusInfo.textContent = COLS + ' columnas × ' + ROWS + ' filas';
      statusbar.appendChild(statusInfo);

      bodyEl.appendChild(toolbar);
      bodyEl.appendChild(formulaBar);
      bodyEl.appendChild(gridWrap);
      bodyEl.appendChild(statusbar);

      // ---- lógica ----
      function recompute() {
        displayCache = {};
        for (var ref in inputsByRef) {
          try {
            displayCache[ref] = computeDisplay(ref);
          } catch (e) {
            displayCache[ref] = '#ERROR';
          }
        }
      }
      function computeDisplay(ref) {
        var raw = cells[ref] || '';
        if (raw.charAt(0) !== '=') return raw;
        try {
          var v = evalFormula(raw.slice(1), cells);
          if (typeof v === 'number') {
            return (Math.round(v * 1e6) / 1e6).toString();
          }
          return String(v);
        } catch (e) {
          var msg = (e && e.message) || '#ERROR';
          return msg.charAt(0) === '#' ? msg : '#ERROR';
        }
      }
      function renderAll() {
        for (var ref in inputsByRef) {
          var input = inputsByRef[ref];
          if (ref === focusedRef) {
            input.value = cells[ref] || '';
          } else {
            input.value = displayCache[ref] || '';
          }
        }
        applyFilters();
      }
      function schedulePersist() {
        if (saveTimer) clearTimeout(saveTimer);
        saveTimer = setTimeout(function () { persist(cells, filters); }, 400);
      }
      function commitRef(ref, value) {
        if (value === '') { delete cells[ref]; } else { cells[ref] = value; }
        dirty = true;
        recompute();
        schedulePersist();
      }

      function selectCell(ref) {
        focusedRef = ref;
        cellRefLabel.textContent = ref;
        formulaInput.value = cells[ref] || '';
        renderAll();
        var input = inputsByRef[ref];
        if (input) { input.value = cells[ref] || ''; input.focus(); }
      }

      Object.keys(inputsByRef).forEach(function (ref) {
        var input = inputsByRef[ref];
        input.addEventListener('focus', function (ev) {
          var r2 = ev.target.dataset.ref;
          focusedRef = r2;
          cellRefLabel.textContent = r2;
          formulaInput.value = cells[r2] || '';
          ev.target.value = cells[r2] || '';
        });
        input.addEventListener('input', function (ev) {
          var r2 = ev.target.dataset.ref;
          commitRef(r2, ev.target.value);
          formulaInput.value = ev.target.value;
        });
        input.addEventListener('blur', function (ev) {
          var r2 = ev.target.dataset.ref;
          if (focusedRef === r2) focusedRef = null;
          renderAll();
        });
        input.addEventListener('keydown', function (ev) {
          if (ev.key === 'Enter') {
            ev.preventDefault();
            ev.target.blur();
            var p = parseRef(ev.target.dataset.ref);
            if (p && p.r + 1 < ROWS) selectCell(refOf(p.c, p.r + 1));
          } else if (ev.key === 'Tab') {
            ev.preventDefault();
            ev.target.blur();
            var p2 = parseRef(ev.target.dataset.ref);
            if (p2 && p2.c + 1 < COLS) selectCell(refOf(p2.c + 1, p2.r));
          }
        });
      });

      formulaInput.addEventListener('focus', function () {
        if (!focusedRef) return;
      });
      formulaInput.addEventListener('input', function () {
        if (!focusedRef) return;
        commitRef(focusedRef, formulaInput.value);
        var input = inputsByRef[focusedRef];
        if (input) input.value = formulaInput.value;
      });
      formulaInput.addEventListener('keydown', function (ev) {
        if (ev.key === 'Enter') {
          ev.preventDefault();
          if (focusedRef) {
            var input = inputsByRef[focusedRef];
            if (input) input.blur();
            renderAll();
          }
        }
      });

      // ---- filtros por columna ----
      function uniqueValuesForColumn(colIndex) {
        var seen = {};
        var values = [];
        for (var r2 = 0; r2 < ROWS; r2++) {
          var ref = refOf(colIndex, r2);
          var val = displayCache[ref] || '';
          if (val === '') continue;
          if (!seen[val]) { seen[val] = true; values.push(val); }
        }
        return values;
      }
      function applyFilters() {
        for (var r2 = 0; r2 < ROWS; r2++) {
          var hidden = false;
          for (var c2 = 0; c2 < COLS; c2++) {
            var excluded = filters[c2];
            if (!excluded || excluded.size === 0) continue;
            var ref = refOf(c2, r2);
            var val = displayCache[ref] || '';
            if (excluded.has(val)) { hidden = true; break; }
          }
          rowEls[r2].classList.toggle('row-hidden', hidden);
        }
        headerCells.forEach(function (th, idx) {
          var excluded = filters[idx];
          th.classList.toggle('filtered', !!(excluded && excluded.size > 0));
        });
      }
      headerCells.forEach(function (th) {
        th.addEventListener('click', function () {
          var colIndex = parseInt(th.dataset.col, 10);
          openFilterModal(colIndex);
        });
      });
      function openFilterModal(colIndex) {
        var values = uniqueValuesForColumn(colIndex);
        var excluded = filters[colIndex] || new Set();
        var container = document.createElement('div');
        container.className = 'modal-checklist';
        if (values.length === 0) {
          var p = document.createElement('p');
          p.textContent = 'No hay valores en esta columna todavía.';
          container.appendChild(p);
        }
        var checkboxes = [];
        values.forEach(function (val) {
          var label = document.createElement('label');
          var cb = document.createElement('input');
          cb.type = 'checkbox';
          cb.checked = !excluded.has(val);
          cb.dataset.val = val;
          checkboxes.push(cb);
          label.appendChild(cb);
          label.appendChild(document.createTextNode(' ' + val));
          container.appendChild(label);
        });
        window.MiniDesktopModal({
          title: 'Filtrar columna ' + colLetter(colIndex),
          message: container,
          buttons: [
            { label: 'Cancelar' },
            {
              label: 'Aplicar', onClick: function () {
                var newExcluded = new Set();
                checkboxes.forEach(function (cb) {
                  if (!cb.checked) newExcluded.add(cb.dataset.val);
                });
                filters[colIndex] = newExcluded;
                applyFilters();
                schedulePersist();
              }
            }
          ]
        });
      }

      // ---- abrir / descargar CSV ----
      btnNew.addEventListener('click', function () {
        function doNew() {
          Object.keys(cells).forEach(function (k) { delete cells[k]; });
          filters = {};
          dirty = false;
          recompute();
          renderAll();
          persist(cells, filters);
        }
        if (dirty) {
          window.MiniDesktopConfirm('Tienes datos sin descargar. ¿Empezar una hoja nueva de todas formas?', doNew);
        } else { doNew(); }
      });
      btnOpen.addEventListener('click', function () {
        function doOpen() { fileInput.click(); }
        if (dirty) {
          window.MiniDesktopConfirm('Tienes datos sin descargar. ¿Abrir otro archivo .csv de todas formas?', doOpen);
        } else { doOpen(); }
      });
      fileInput.addEventListener('change', function () {
        var file = fileInput.files && fileInput.files[0];
        fileInput.value = '';
        if (!file) return;
        var reader = new FileReader();
        reader.onload = function () {
          var rows = parseCSV(String(reader.result));
          Object.keys(cells).forEach(function (k) { delete cells[k]; });
          filters = {};
          var truncated = rows.length > ROWS || (rows[0] && rows[0].length > COLS);
          for (var r3 = 0; r3 < Math.min(rows.length, ROWS); r3++) {
            for (var c3 = 0; c3 < Math.min(rows[r3].length, COLS); c3++) {
              var val = rows[r3][c3];
              if (val !== '' && val != null) cells[refOf(c3, r3)] = val;
            }
          }
          dirty = false;
          recompute();
          renderAll();
          persist(cells, filters);
          if (truncated) {
            window.MiniDesktopModal({
              title: 'Archivo truncado',
              message: 'El archivo tenía más de ' + ROWS + ' filas o ' + COLS + ' columnas. Solo se cargó lo que cabe en la grilla.',
              buttons: [{ label: 'Entendido' }]
            });
          }
        };
        reader.onerror = function () {
          window.MiniDesktopModal({ title: 'Error', message: 'No se pudo leer "' + file.name + '".', buttons: [{ label: 'Aceptar' }] });
        };
        reader.readAsText(file, 'utf-8');
      });
      btnDownload.addEventListener('click', function () {
        window.MiniDesktopModal({
          title: 'Descargar CSV',
          message: '¿Exportar todas las filas o solo las que están visibles (según los filtros aplicados)?',
          buttons: [
            { label: 'Solo visibles', onClick: function () { doDownload(true); } },
            { label: 'Todas', onClick: function () { doDownload(false); } }
          ]
        });
      });
      function doDownload(onlyVisible) {
        var outRows = [];
        for (var r4 = 0; r4 < ROWS; r4++) {
          if (onlyVisible && rowEls[r4].classList.contains('row-hidden')) continue;
          var hasAny = false;
          var row = [];
          for (var c4 = 0; c4 < COLS; c4++) {
            var ref = refOf(c4, r4);
            var val = displayCache[ref] != null ? displayCache[ref] : (cells[ref] || '');
            if (val !== '') hasAny = true;
            row.push(val);
          }
          if (hasAny) outRows.push(row);
        }
        var csv = toCSV(outRows);
        var blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url; a.download = 'hoja.csv';
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
        setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
        dirty = false;
      }

      recompute();
      renderAll();

      return {
        getState: function () { return { cells: cells, filters: filters }; },
        hasUnsavedChanges: function () { return dirty; },
        destroy: function () {
          if (saveTimer) clearTimeout(saveTimer);
          try { localStorage.removeItem(STORAGE_KEY); } catch (e) { /* ignorar */ }
        }
      };
    }
  };
})();
