(function () {
  'use strict';

  var cfg = window.APP_CONFIG || {};
  var DEFAULTS = {
    salary: 0, advShare: 50,
    planNew: 200000, planOld: 300000, bonus: 5000,
    rateNew: 10, rateOld: 2.5
  };
  var COLS = {
    salary: 'salary', advShare: 'adv_share', planNew: 'plan_new', planOld: 'plan_old',
    bonus: 'bonus', rateNew: 'rate_new', rateOld: 'rate_old'
  };
  var MONTHS = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];

  var db = null, user = null;
  var state = { clients: [], settings: {} };
  var month = currentMonth();

  /* ---------- Утилиты ---------- */
  function $(id) { return document.getElementById(id); }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function currentMonth() { var d = new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1); }
  function todayStr() { var d = new Date(); return currentMonth() + '-' + pad(d.getDate()); }
  function num(v) { var n = parseFloat(String(v).replace(',', '.')); return isFinite(n) ? n : 0; }
  function money(v) {
    var n = Math.round(v * 100) / 100;
    return n.toLocaleString('ru-RU', { minimumFractionDigits: 0, maximumFractionDigits: 2 }) + ' ₽';
  }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function shiftMonth(m, delta) {
    var p = m.split('-'), d = new Date(+p[0], +p[1] - 1 + delta, 1);
    return d.getFullYear() + '-' + pad(d.getMonth() + 1);
  }
  function monthTitle(m) { var p = m.split('-'); return MONTHS[+p[1] - 1] + ' ' + p[0]; }

  var toastTimer;
  function toast(msg) {
    var t = $('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove('show'); }, 2800);
  }
  function errText(e) {
    return (e && e.message) ? e.message : 'Не удалось связаться с базой данных. Проверьте интернет.';
  }
  function busy(btn, on) { if (btn) btn.disabled = !!on; }

  /* ---------- Преобразование строк БД ---------- */
  function mapClient(r) {
    return { id: r.id, name: r.name, amount: Number(r.amount), date: r.date, type: r.type };
  }
  function mapSettings(r) {
    var s = {};
    for (var k in COLS) s[k] = Number(r[COLS[k]]);
    return s;
  }

  /* ---------- Настройки месяца (наследуются от прошлых месяцев) ---------- */
  function getSettings(m) {
    var out = {}, k, src;
    if (state.settings[m]) {
      src = state.settings[m];
    } else {
      var keys = Object.keys(state.settings).filter(function (x) { return x < m; }).sort();
      src = keys.length ? state.settings[keys[keys.length - 1]] : {};
    }
    for (k in DEFAULTS) out[k] = src[k] !== undefined ? src[k] : DEFAULTS[k];
    return out;
  }

  /* ---------- Расчёт ---------- */
  function calc(m) {
    var s = getSettings(m);
    var list = state.clients.filter(function (c) { return c.date.slice(0, 7) === m; });
    var r = {
      s: s, list: list,
      sold: { new: 0, old: 0 },
      pay: { 1: { new: 0, old: 0 }, 2: { new: 0, old: 0 } }
    };
    list.forEach(function (c) {
      var half = parseInt(c.date.slice(8, 10), 10) <= 15 ? 1 : 2;
      var rate = c.type === 'new' ? s.rateNew : s.rateOld;
      r.sold[c.type] += c.amount;
      r.pay[half][c.type] += c.amount * rate / 100;
    });
    r.hasNew = s.planNew > 0;
    r.hasOld = s.planOld > 0;
    r.doneNew = r.hasNew && r.sold.new >= s.planNew;
    r.doneOld = r.hasOld && r.sold.old >= s.planOld;
    r.leftNew = r.hasNew ? Math.max(0, s.planNew - r.sold.new) : 0;
    r.leftOld = r.hasOld ? Math.max(0, s.planOld - r.sold.old) : 0;
    // Один общий бонус: платится, когда выполнены все заданные планы
    r.kpiOk = (r.hasNew || r.hasOld) && (!r.hasNew || r.doneNew) && (!r.hasOld || r.doneOld);
    r.kpi = r.kpiOk ? s.bonus : 0;
    r.salary1 = s.salary * s.advShare / 100;
    r.salary2 = s.salary - r.salary1;
    r.advance = r.salary1 + r.pay[1].new + r.pay[1].old;
    r.second = r.salary2 + r.pay[2].new + r.pay[2].old + r.kpi;
    r.total = r.advance + r.second;
    return r;
  }

  function clientPay(c, s) {
    return c.amount * (c.type === 'new' ? s.rateNew : s.rateOld) / 100;
  }

  /* ---------- Отрисовка ---------- */
  function renderKpi(el, label, kind, sold, plan, left, done) {
    el.className = 'kpi ' + kind + (done ? ' done' : '');
    if (plan <= 0) {
      el.innerHTML = '<div class="kpi-head">' + label + '</div><p class="kpi-note">План не задан. Укажите его в настройках месяца.</p>';
      return;
    }
    var pct = Math.min(100, Math.round(sold / plan * 100));
    var note = done
      ? '<span class="kpi-done">План выполнен.</span>'
      : 'До плана не хватает <b class="left">' + money(left) + '</b>';
    el.innerHTML =
      '<div class="kpi-head">' + label + '<span>' + money(sold) + ' из ' + money(plan) + ' · ' + pct + '%</span></div>' +
      '<div class="bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + pct + '"><i style="width:' + pct + '%"></i></div>' +
      '<p class="kpi-note">' + note + '</p>';
  }

  function render() {
    var r = calc(month), s = r.s;
    $('monthInput').value = month;
    $('slipMonth').textContent = monthTitle(month);

    $('totalAll').textContent = money(r.total);
    $('sumAdvance').textContent = money(r.advance);
    $('sumSecond').textContent = money(r.second);
    $('advSalary').textContent = money(r.salary1);
    $('advNew').textContent = money(r.pay[1].new);
    $('advOld').textContent = money(r.pay[1].old);
    $('secSalary').textContent = money(r.salary2);
    $('secNew').textContent = money(r.pay[2].new);
    $('secOld').textContent = money(r.pay[2].old);
    $('secKpi').textContent = money(r.kpi);
    $('soldNew').textContent = money(r.sold.new);
    $('soldOld').textContent = money(r.sold.old);

    renderKpi($('kpiNew'), 'Новые клиенты', 'new', r.sold.new, s.planNew, r.leftNew, r.doneNew);
    renderKpi($('kpiOld'), 'Продления', 'old', r.sold.old, s.planOld, r.leftOld, r.doneOld);

    var kb = $('kpiBonus');
    if (!r.hasNew && !r.hasOld) {
      kb.className = 'kpi-bonus';
      kb.textContent = 'Задайте планы в настройках, и здесь появится расчёт бонуса.';
    } else if (r.kpiOk) {
      kb.className = 'kpi-bonus ok';
      kb.innerHTML = 'Все планы выполнены. Бонус KPI <b>+' + money(s.bonus) + '</b> входит в остаток зарплаты.';
    } else {
      kb.className = 'kpi-bonus';
      kb.innerHTML = 'Бонус KPI <b>' + money(s.bonus) + '</b> выплачивается, когда выполнены все планы. До бонуса в сумме не хватает <b class="left">' + money(r.leftNew + r.leftOld) + '</b>.';
    }

    fillSettingsForm(s);
    renderList(r);

    var f = $('addForm').elements.date;
    if (f.value.slice(0, 7) !== month) f.value = defaultDate();
  }

  function defaultDate() {
    return month === currentMonth() ? todayStr() : month + '-01';
  }

  function fillSettingsForm(s) {
    var f = $('settingsForm');
    if (document.activeElement && f.contains(document.activeElement)) return;
    for (var k in DEFAULTS) f.elements[k].value = s[k];
  }

  function renderList(r) {
    var q = $('search').value.trim().toLowerCase();
    var items = r.list.filter(function (c) { return !q || c.name.toLowerCase().indexOf(q) !== -1; })
      .sort(function (a, b) { return a.date < b.date ? 1 : a.date > b.date ? -1 : (a.id < b.id ? 1 : -1); });
    $('listCount').textContent = r.list.length ? '· ' + r.list.length : '';
    $('emptyState').hidden = items.length > 0;
    $('emptyState').textContent = r.list.length
      ? 'По запросу никого не найдено.'
      : 'В этом месяце оплат пока нет. Добавьте первую в форме выше.';
    $('clientList').innerHTML = items.map(function (c) {
      var d = c.date.split('-');
      var half = +d[2] <= 15 ? 'аванс' : 'остаток';
      return '<li class="client ' + c.type + '">' +
        '<div><div class="c-name">' + esc(c.name) + '</div>' +
        '<div class="c-meta"><span class="badge ' + c.type + '">' + (c.type === 'new' ? 'Новый' : 'Продление') + '</span>' +
        '<span>' + d[2] + '.' + d[1] + '.' + d[0] + '</span><span>идёт в ' + half + '</span></div></div>' +
        '<div class="c-money"><b>' + money(c.amount) + '</b><small>вам: ' + money(clientPay(c, r.s)) + '</small></div>' +
        '<button type="button" class="c-edit" data-id="' + esc(c.id) + '">Изменить</button></li>';
    }).join('');
  }

  /* ---------- Работа с базой ---------- */
  function loadAll() {
    return Promise.all([
      db.from('clients').select('id,name,amount,date,type').order('date', { ascending: false }).range(0, 9999),
      db.from('settings').select('*')
    ]).then(function (res) {
      if (res[0].error) throw res[0].error;
      if (res[1].error) throw res[1].error;
      state.clients = res[0].data.map(mapClient);
      state.settings = {};
      res[1].data.forEach(function (row) { state.settings[row.month] = mapSettings(row); });
    });
  }

  function validate(name, amount, date) {
    if (!name) return 'Введите фамилию клиента.';
    if (!(amount > 0)) return 'Введите сумму больше нуля.';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return 'Укажите дату оплаты.';
    return '';
  }
  function showError(id, msg) {
    var e = $(id);
    e.textContent = msg || '';
    e.hidden = !msg;
  }

  /* ---------- События: клиенты ---------- */
  $('addForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var form = e.target, f = form.elements, btn = form.querySelector('button[type="submit"]');
    var name = f.name.value.trim(), amount = num(f.amount.value), date = f.date.value;
    var err = validate(name, amount, date);
    showError('addError', err);
    if (err) return;
    busy(btn, true);
    db.from('clients').insert({ user_id: user.id, name: name, amount: amount, date: date, type: f.type.value })
      .select('id,name,amount,date,type').single()
      .then(function (res) {
        busy(btn, false);
        if (res.error) { showError('addError', errText(res.error)); return; }
        state.clients.push(mapClient(res.data));
        month = date.slice(0, 7);
        f.name.value = '';
        f.amount.value = '';
        render();
        toast('Сохранено');
        f.name.focus();
      }, function (e2) { busy(btn, false); showError('addError', errText(e2)); });
  });

  $('clientList').addEventListener('click', function (e) {
    var b = e.target.closest ? e.target.closest('.c-edit') : null;
    if (!b) return;
    var c = state.clients.filter(function (x) { return x.id === b.getAttribute('data-id'); })[0];
    if (!c) return;
    var f = $('editForm').elements;
    f.id.value = c.id; f.name.value = c.name; f.amount.value = c.amount; f.date.value = c.date;
    var radios = $('editForm').querySelectorAll('input[name="etype"]');
    for (var i = 0; i < radios.length; i++) radios[i].checked = radios[i].value === c.type;
    showError('editError', '');
    $('editModal').hidden = false;
    f.name.focus();
  });

  function closeModal() { $('editModal').hidden = true; }
  $('editCancel').addEventListener('click', closeModal);
  $('editModal').addEventListener('mousedown', function (e) { if (e.target === this) closeModal(); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !$('editModal').hidden) closeModal(); });

  $('editForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var form = e.target, f = form.elements, btn = form.querySelector('button[type="submit"]');
    var name = f.name.value.trim(), amount = num(f.amount.value), date = f.date.value;
    var err = validate(name, amount, date);
    showError('editError', err);
    if (err) return;
    var type = form.querySelector('input[name="etype"]:checked').value;
    var id = f.id.value;
    busy(btn, true);
    db.from('clients').update({ name: name, amount: amount, date: date, type: type })
      .eq('id', id).select('id,name,amount,date,type').single()
      .then(function (res) {
        busy(btn, false);
        if (res.error) { showError('editError', errText(res.error)); return; }
        var upd = mapClient(res.data);
        state.clients = state.clients.map(function (c) { return c.id === id ? upd : c; });
        month = date.slice(0, 7);
        closeModal();
        render();
        toast('Изменения сохранены');
      }, function (e2) { busy(btn, false); showError('editError', errText(e2)); });
  });

  $('editDelete').addEventListener('click', function () {
    var id = $('editForm').elements.id.value, btn = this;
    if (!window.confirm('Удалить этого клиента? Расчёт зарплаты пересчитается.')) return;
    busy(btn, true);
    db.from('clients').delete().eq('id', id).then(function (res) {
      busy(btn, false);
      if (res.error) { showError('editError', errText(res.error)); return; }
      state.clients = state.clients.filter(function (c) { return c.id !== id; });
      closeModal();
      render();
      toast('Клиент удалён');
    }, function (e2) { busy(btn, false); showError('editError', errText(e2)); });
  });

  /* ---------- События: настройки, месяц ---------- */
  $('settingsForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var form = e.target, f = form.elements, btn = form.querySelector('button[type="submit"]');
    var s = {}, row = { user_id: user.id, month: month }, k;
    for (k in DEFAULTS) s[k] = Math.max(0, num(f[k].value));
    if (s.advShare > 100) s.advShare = 100;
    for (k in COLS) row[COLS[k]] = s[k];
    busy(btn, true);
    db.from('settings').upsert(row, { onConflict: 'user_id,month' }).then(function (res) {
      busy(btn, false);
      if (res.error) { toast(errText(res.error)); return; }
      state.settings[month] = s;
      if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
      render();
      toast('Настройки сохранены');
    }, function (e2) { busy(btn, false); toast(errText(e2)); });
  });

  $('prevMonth').addEventListener('click', function () { month = shiftMonth(month, -1); render(); });
  $('nextMonth').addEventListener('click', function () { month = shiftMonth(month, 1); render(); });
  $('monthInput').addEventListener('change', function () {
    if (/^\d{4}-\d{2}$/.test(this.value)) { month = this.value; render(); }
  });
  $('search').addEventListener('input', function () { renderList(calc(month)); });

  /* ---------- Выгрузка CSV ---------- */
  function csvCell(v) {
    v = String(v);
    return /[;"\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
  }
  function csvNum(v) { return String(Math.round(v * 100) / 100).replace('.', ','); }

  $('exportCsv').addEventListener('click', function () {
    var r = calc(month), s = r.s;
    var rows = [['Дата', 'Фамилия', 'Тип клиента', 'Сумма оплаты', 'Ставка, %', 'Начислено мне', 'Период']];
    r.list.slice().sort(function (a, b) { return a.date < b.date ? -1 : 1; }).forEach(function (c) {
      var d = c.date.split('-');
      rows.push([d[2] + '.' + d[1] + '.' + d[0], c.name, c.type === 'new' ? 'Новый' : 'Продление',
        csvNum(c.amount), csvNum(c.type === 'new' ? s.rateNew : s.rateOld), csvNum(clientPay(c, s)),
        +d[2] <= 15 ? 'Аванс' : 'Остаток']);
    });
    rows.push([]);
    rows.push(['ИТОГО ЗА ' + monthTitle(month).toUpperCase()]);
    rows.push(['Продано новым', csvNum(r.sold.new)]);
    rows.push(['План по новым', csvNum(s.planNew)]);
    rows.push(['Продано продлений', csvNum(r.sold.old)]);
    rows.push(['План по продлениям', csvNum(s.planOld)]);
    rows.push(['Оклад', csvNum(s.salary)]);
    rows.push(['Процент с новых', csvNum(r.pay[1].new + r.pay[2].new)]);
    rows.push(['Процент с продлений', csvNum(r.pay[1].old + r.pay[2].old)]);
    rows.push(['Бонус KPI', csvNum(r.kpi)]);
    rows.push(['Аванс (1–15)', csvNum(r.advance)]);
    rows.push(['Остаток (16–конец)', csvNum(r.second)]);
    rows.push(['Всего за месяц', csvNum(r.total)]);
    var text = '\ufeff' + rows.map(function (row) { return row.map(csvCell).join(';'); }).join('\r\n');
    var blob = new Blob([text], { type: 'text/csv;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'zarplata-' + month + '.csv';
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
    toast('Файл выгружен');
  });

  /* ---------- Вход ---------- */
  function showAuth(msg) {
    user = null;
    state = { clients: [], settings: {} };
    $('authBox').hidden = false;
    document.body.classList.add('locked');
    if (msg) showError('authError', msg);
  }

  function enter(session) {
    if (user && user.id === session.user.id) return;
    user = session.user;
    $('authBox').hidden = true;
    document.body.classList.remove('locked');
    showError('authError', '');
    loadAll().then(function () {
      $('addForm').elements.date.value = defaultDate();
      render();
    }, function (err) {
      toast('Ошибка загрузки: ' + errText(err));
    });
  }

  function credentials() {
    var f = $('authForm').elements;
    var email = f.email.value.trim(), password = f.password.value;
    if (!email || password.length < 6) {
      showError('authError', 'Введите почту и пароль не короче 6 символов.');
      return null;
    }
    showError('authError', '');
    return { email: email, password: password };
  }

  $('authForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var cr = credentials();
    if (!cr) return;
    var btn = $('loginBtn');
    busy(btn, true);
    db.auth.signInWithPassword(cr).then(function (res) {
      busy(btn, false);
      if (res.error) showError('authError', res.error.message === 'Invalid login credentials' ? 'Неверная почта или пароль.' : errText(res.error));
    }, function (e2) { busy(btn, false); showError('authError', errText(e2)); });
  });

  $('signupBtn').addEventListener('click', function () {
    var cr = credentials();
    if (!cr) return;
    var btn = this;
    busy(btn, true);
    db.auth.signUp(cr).then(function (res) {
      busy(btn, false);
      if (res.error) { showError('authError', errText(res.error)); return; }
      if (!res.data.session) showError('authError', 'Аккаунт создан. Подтвердите почту по ссылке из письма и войдите.');
    }, function (e2) { busy(btn, false); showError('authError', errText(e2)); });
  });

  $('logoutBtn').addEventListener('click', function () { db.auth.signOut(); });

  /* ---------- Старт ---------- */
  function init() {
    if (!window.supabase || !cfg.SUPABASE_URL || /YOUR-/.test(cfg.SUPABASE_URL) || /YOUR-/.test(cfg.SUPABASE_ANON_KEY || 'YOUR-')) {
      showAuth('Подключение к базе не настроено. Впишите данные Supabase в файл js/config.js (инструкция в README).');
      $('loginBtn').disabled = true;
      $('signupBtn').disabled = true;
      return;
    }
    db = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
    showAuth();
    db.auth.onAuthStateChange(function (event, session) {
      if (session) { setTimeout(function () { enter(session); }, 0); } else if (event === 'SIGNED_OUT') { showAuth(); }
    });
    db.auth.getSession().then(function (res) {
      if (res.data && res.data.session) enter(res.data.session);
    });
  }

  init();
})();
