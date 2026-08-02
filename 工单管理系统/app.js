// app.js — PC 端逻辑：路由、看板、列表、详情、表单、看板概览、状态流转
(function () {
  "use strict";
  var WOMS = window.WOMS = window.WOMS || {};

  // ---------- DOM helpers ----------
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $all(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  function escapeHtml(s) {
    if (s === undefined || s === null) return "";
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function pad2(n) { return n < 10 ? "0" + n : "" + n; }
  function fmtDate(iso) {
    if (!iso) return "";
    var d = new Date(iso);
    if (isNaN(d.getTime())) return iso.slice(0, 10);
    return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate());
  }
  function fmtDateTime(iso) {
    if (!iso) return "";
    var d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate()) +
      " " + pad2(d.getHours()) + ":" + pad2(d.getMinutes());
  }
  function todayStr() {
    var d = new Date();
    return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate());
  }

  // ---------- visual helpers ----------
  var AV_COLORS = ["#2B2BFF", "#0891b2", "#16a34a", "#d97706", "#dc2626", "#7c3aed", "#db2777"];
  function avatarColor(name) {
    if (!name) return "#cbd5e1";
    var h = 0;
    for (var i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
    return AV_COLORS[h % AV_COLORS.length];
  }
  function initials(name) {
    if (!name) return "—";
    return name.slice(-2);
  }
  function avatarHtml(name) {
    if (!name) return '<span class="avatar empty">—</span>';
    return '<span class="avatar" style="background:' + avatarColor(name) + '">' + escapeHtml(initials(name)) + '</span>';
  }
  function statusPill(status) {
    var m = WOMS.STATUS_META[status] || { color: "#6b7280", bg: "#f3f4f6" };
    return '<span class="pill" style="color:' + m.color + ';background:' + m.bg + '"><span class="dot" style="background:' + m.color + '"></span>' + escapeHtml(status) + '</span>';
  }
  function priorityBadge(p) {
    var m = WOMS.PRIORITY_META[p] || { color: "#6b7280", bg: "#f3f4f6" };
    return '<span class="badge" style="color:' + m.color + ';background:' + m.bg + '">' + escapeHtml(p) + '</span>';
  }
  function typeBadge(type) {
    var c = WOMS.TYPE_COLOR[type] || "#6b7280";
    return '<span class="kcard-type" style="background:' + c + '">' + escapeHtml(type) + '</span>';
  }

  // ---------- toast ----------
  var toastTimer = null;
  function toast(msg, isErr) {
    var t = $("#toast");
    t.textContent = msg;
    t.className = "toast show" + (isErr ? " error" : "");
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.className = "toast"; }, 2600);
  }

  // ---------- state ----------
  var state = {
    page: "overview",
    data: null,
    listFilters: { type: "", status: "", assignee: "", grid: "", priority: "", kw: "", page: 1, size: 20 },
    dashFilters: { grid: "", assignee: "" },
    kanbanKw: "",
    logFilters: { action: "", operator: "", kw: "", from: "", to: "", page: 1, size: 20 }
  };
  function reload() { state.data = WOMS.data.load(); }
  function refresh() { reload(); renderPage(); }

  // ---------- permissions ----------
  function isAdmin() { return WOMS.role === "admin"; }
  function canTransition(t, to) {
    var allowed = WOMS.TRANSITIONS[t.status] || [];
    if (allowed.indexOf(to) < 0) return false;
    var r = WOMS.role, u = WOMS.currentUser;
    if (t.status === "待分配" && to === "处理中") return r === "admin";
    if (t.status === "已驳回" && to === "处理中") return r === "admin";
    if (to === "已完成" || to === "已驳回") return r === "admin" || t.assignee === u;
    if (to === "已关闭") return r === "admin";
    return false;
  }
  function canEdit(t) { return isAdmin() || t.assignee === WOMS.currentUser; }
  function canDelete(t) { return isAdmin(); }
  function canCreate() { return isAdmin(); }

  // ---------- router ----------
  function route() {
    var hash = location.hash || "#/";
    if (hash.indexOf("#/m") === 0) { showMobile(); return; }
    if (WOMS.auth && !WOMS.auth.isLoggedIn()) { showLogin(); return; }
    showPC();
    if (hash === "#/kanban") setPage("kanban", true);
    else if (hash === "#/list") setPage("list", true);
    else if (hash === "#/recycle") setPage("recycle", true);
    else if (hash === "#/log") setPage("log", true);
    else setPage("overview", true);
  }
  function showPC() {
    var lv = $("#login-view"); if (lv) lv.style.display = "none";
    $("#pc-app").style.display = "";
    $("#mobile-app").style.display = "none";
    syncHeaderRole();
  }
  function showMobile() {
    var lv = $("#login-view"); if (lv) lv.style.display = "none";
    $("#pc-app").style.display = "none";
    $("#mobile-app").style.display = "";
    if (WOMS.mobile) WOMS.mobile.render();
  }
  function showLogin() {
    $("#pc-app").style.display = "none";
    $("#mobile-app").style.display = "none";
    var lv = $("#login-view");
    if (lv) { lv.style.display = ""; bindLogin(); }
  }

  function setPage(page, fromRoute) {
    state.page = page;
    $all("#nav-tabs .nav-tab").forEach(function (t) {
      t.classList.toggle("active", t.dataset.page === page);
    });
    renderPage();
  }
  function renderPage() {
    var main = $("#pc-main");
    if (state.page === "overview") { main.innerHTML = overviewHtml(); afterOverview(); }
    else if (state.page === "kanban") { main.innerHTML = kanbanHtml(); afterKanban(); }
    else if (state.page === "list") { main.innerHTML = listHtml(); afterList(); }
    else if (state.page === "recycle") { main.innerHTML = recycleHtml(); afterRecycle(); }
    else if (state.page === "log") { main.innerHTML = logHtml(); afterLog(); }
  }

  // ---------- header / role ----------
  function buildUserOptions() {
    var opts = ['<option value="系统管理员">系统管理员</option>'];
    getAssignees().forEach(function (a) { opts.push('<option value="' + escapeHtml(a) + '">' + escapeHtml(a) + '</option>'); });
    return opts.join("");
  }
  function syncHeaderRole() {
    var sr = $("#session-role"), su = $("#session-user");
    if (sr) sr.textContent = WOMS.role === "admin" ? "管理员" : "处理员";
    if (su) su.textContent = WOMS.currentUser || "";
    var nb = $("#new-ticket-btn");
    if (nb) nb.style.display = canCreate() ? "" : "none";
  }

  // ---------- overview / dashboard ----------
  function dashTickets() {
    var f = state.dashFilters;
    return state.data.tickets.filter(function (t) {
      if (f.grid && t.grid !== f.grid) return false;
      if (f.assignee && t.assignee !== f.assignee) return false;
      return true;
    });
  }
  function overviewHtml() {
    var ts = dashTickets();
    var total = ts.length;
    var done = ts.filter(function (t) { return t.status === "已完成"; }).length;
    var pending = ts.filter(function (t) { return t.status === "待分配" || t.status === "处理中"; }).length;
    var rate = total ? Math.round(done / total * 100) : 0;
    var today = todayStr();
    var todayNew = ts.filter(function (t) { return fmtDate(t.createdAt) === today; }).length;

    var gridOpts = ['<option value="">全部网格</option>'].concat(WOMS.ENUMS.grids.map(function (g) {
      return '<option value="' + escapeHtml(g) + '"' + (state.dashFilters.grid === g ? " selected" : "") + '>' + escapeHtml(g) + '</option>';
    }));
    var asgOpts = ['<option value="">全部处理人</option>'].concat(getAssignees().map(function (a) {
      return '<option value="' + escapeHtml(a) + '"' + (state.dashFilters.assignee === a ? " selected" : "") + '>' + escapeHtml(a) + '</option>';
    }));

    return "" +
      '<h1 class="page-title">数据概览</h1>' +
      '<div class="dash-filters">' +
        '<span class="toolbar-label">筛选</span>' +
        '<select id="dash-grid">' + gridOpts.join("") + '</select>' +
        '<select id="dash-assignee">' + asgOpts.join("") + '</select>' +
        '<button class="btn btn-sm" id="dash-reset">重置</button>' +
      '</div>' +
      '<div class="stat-grid">' +
        statCard("总工单", total, "") +
        statCard("已完成", done, "green") +
        statCard("待处理", pending, "amber") +
        statCard("完成率", rate + "%", "accent") +
        statCard("今日新增", todayNew, "") +
      '</div>' +
      '<div class="chart-grid">' +
        '<div class="chart-card"><h3 class="chart-title">状态分布</h3><div class="donut-wrap" id="donut-host"></div></div>' +
        '<div class="chart-card"><h3 class="chart-title">类型分布</h3><div id="bar-host"></div></div>' +
      '</div>';
  }
  function statCard(label, value, cls) {
    return '<div class="stat-card"><div class="stat-label">' + escapeHtml(label) + '</div><div class="stat-value ' + cls + '">' + value + '</div></div>';
  }
  function afterOverview() {
    var dg = $("#dash-grid"), da = $("#dash-assignee");
    if (dg) dg.addEventListener("change", function () { state.dashFilters.grid = dg.value; renderPage(); });
    if (da) da.addEventListener("change", function () { state.dashFilters.assignee = da.value; renderPage(); });
    var dr = $("#dash-reset");
    if (dr) dr.addEventListener("click", function () { state.dashFilters = { grid: "", assignee: "" }; renderPage(); });

    var ts = dashTickets();
    var slices = WOMS.ENUMS.statuses.map(function (s) {
      return { name: s, value: ts.filter(function (t) { return t.status === s; }).length, color: (WOMS.STATUS_META[s] || {}).color || "#6b7280" };
    });
    var total = ts.length;
    var host = $("#donut-host");
    if (host) host.innerHTML = donutSvg(slices, total) + donutLegend(slices, total);

    var typeData = WOMS.ENUMS.types.map(function (ty) {
      return { name: ty, value: ts.filter(function (t) { return t.type === ty; }).length, color: WOMS.TYPE_COLOR[ty] };
    });
    var bh = $("#bar-host");
    if (bh) bh.innerHTML = barSvg(typeData);
  }

  function donutSvg(slices, total) {
    var cx = 90, cy = 90, r = 64, sw = 22, C = 2 * Math.PI * r;
    var h = ['<svg viewBox="0 0 180 180" width="180" height="180" style="flex:0 0 auto">'];
    h.push('<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '" fill="none" stroke="#f1f5f9" stroke-width="' + sw + '"/>');
    if (total > 0) {
      var offset = 0;
      slices.forEach(function (s) {
        if (s.value <= 0) return;
        var len = s.value / total * C;
        h.push('<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '" fill="none" stroke="' + s.color + '" stroke-width="' + sw + '" stroke-dasharray="' + len.toFixed(2) + ' ' + (C - len).toFixed(2) + '" stroke-dashoffset="' + (-offset).toFixed(2) + '" transform="rotate(-90 ' + cx + ' ' + cy + ')"/>');
        offset += len;
      });
    }
    h.push('</svg>');
    return h.join("");
  }
  function donutLegend(slices, total) {
    var items = slices.map(function (s) {
      var pct = total ? Math.round(s.value / total * 100) : 0;
      return '<div class="legend-item"><span class="legend-dot" style="background:' + s.color + '"></span>' + escapeHtml(s.name) + ' ' + s.value + ' (' + pct + '%)</div>';
    });
    var center = total ? '<div class="donut-center"><div class="num">' + total + '</div><div class="lbl">工单总数</div></div>' : "";
    return '<div class="chart-legend" style="flex-direction:column;gap:8px">' + items.join("") + '</div>' + center;
  }

  function barSvg(typeData) {
    var W = 420, H = 190, padL = 28, padB = 40, padT = 16, padR = 12;
    var innerW = W - padL - padR, innerH = H - padT - padB;
    var max = 1;
    typeData.forEach(function (d) { if (d.value > max) max = d.value; });
    var n = typeData.length;
    var slot = innerW / n;
    var barW = Math.min(46, slot * 0.6);
    var h = ['<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" style="max-width:520px">'];
    for (var g = 0; g <= 4; g++) {
      var y = padT + innerH - (innerH * g / 4);
      h.push('<line x1="' + padL + '" y1="' + y + '" x2="' + (W - padR) + '" y2="' + y + '" stroke="#f1f5f9" stroke-width="1"/>');
      h.push('<text x="' + (padL - 6) + '" y="' + (y + 3) + '" text-anchor="end" font-size="10" fill="#9ca3af">' + Math.round(max * g / 4) + '</text>');
    }
    typeData.forEach(function (d, i) {
      var bh = max > 0 ? (d.value / max) * innerH : 0;
      var x = padL + i * slot + (slot - barW) / 2;
      var yy = padT + innerH - bh;
      h.push('<rect x="' + x + '" y="' + yy + '" width="' + barW + '" height="' + bh + '" rx="4" fill="' + d.color + '"/>');
      if (d.value > 0) h.push('<text x="' + (x + barW / 2) + '" y="' + (yy - 5) + '" text-anchor="middle" font-size="11" fill="#374151" font-weight="600">' + d.value + '</text>');
      var lx = padL + i * slot + slot / 2;
      h.push('<text x="' + lx + '" y="' + (H - padB + 16) + '" text-anchor="middle" font-size="10" fill="#6b7280">' + escapeHtml(d.name) + '</text>');
    });
    h.push('</svg>');
    return h.join("");
  }

  // ---------- kanban ----------
  function kanbanHtml() {
    var kw = state.kanbanKw;
    var cols = WOMS.ENUMS.statuses.map(function (st) {
      var list = state.data.tickets.filter(function (t) {
        if (t.status !== st) return false;
        if (kw) {
          var blob = (t.code + t.customerAccount + t.address + t.description + t.assignee).toLowerCase();
          if (blob.indexOf(kw.toLowerCase()) < 0) return false;
        }
        return true;
      });
      var cards = list.map(kanbanCardHtml).join("");
      var m = WOMS.STATUS_META[st];
      return "" +
        '<div class="kanban-col" data-status="' + escapeHtml(st) + '">' +
          '<div class="col-head">' +
            '<span class="col-dot" style="background:' + m.color + '"></span>' +
            '<span class="col-name">' + escapeHtml(st) + '</span>' +
            '<span class="col-count">' + list.length + '</span>' +
          '</div>' +
          '<div class="col-body" data-status="' + escapeHtml(st) + '">' + cards + '</div>' +
        '</div>';
    }).join("");
    return "" +
      '<h1 class="page-title">看板</h1>' +
      '<div class="toolbar" style="margin-bottom:16px">' +
        '<input class="input search" id="kanban-kw" placeholder="搜索编号/账号/地址/描述/处理人" value="' + escapeHtml(kw) + '" />' +
        '<span class="muted" style="font-size:12px">拖拽卡片到其他列即流转状态；非法流转会被拦截</span>' +
      '</div>' +
      '<div class="kanban">' + cols + '</div>';
  }
  function kanbanCardHtml(t) {
    return "" +
      '<div class="kcard" draggable="true" data-id="' + escapeHtml(t.id) + '">' +
        '<div class="kcard-top">' +
          '<span class="kcard-code">' + escapeHtml(t.code) + '</span>' +
          typeBadge(t.type) +
          priorityBadge(t.priority) +
        '</div>' +
        '<div class="kcard-desc">' + escapeHtml(t.description || "") + '</div>' +
        '<div class="kcard-foot">' +
          avatarHtml(t.assignee) +
          '<span class="kcard-acc">' + escapeHtml(t.customerAccount || "") + '</span>' +
          '<span class="kcard-date">' + escapeHtml(fmtDate(t.ticketDate)) + '</span>' +
        '</div>' +
      '</div>';
  }
  function afterKanban() {
    var kw = $("#kanban-kw");
    if (kw) kw.addEventListener("input", function () { state.kanbanKw = kw.value; renderPage(); var k = $("#kanban-kw"); if (k) k.focus(); });
    $all(".kanban-col").forEach(function (col) {
      col.addEventListener("dragover", function (e) { e.preventDefault(); col.classList.add("drag-over"); });
      col.addEventListener("dragleave", function () { col.classList.remove("drag-over"); });
      col.addEventListener("drop", function (e) {
        e.preventDefault();
        col.classList.remove("drag-over");
        var id = e.dataTransfer.getData("text/plain");
        var to = col.getAttribute("data-status");
        handleDrop(id, to);
      });
    });
    $all(".kcard").forEach(function (card) {
      card.addEventListener("dragstart", function (e) { e.dataTransfer.setData("text/plain", card.getAttribute("data-id")); e.dataTransfer.effectAllowed = "move"; });
      card.addEventListener("click", function () { openDetail(card.getAttribute("data-id")); });
    });
  }
  function handleDrop(id, to) {
    var t = WOMS.data.getTicket(state.data, id);
    if (!t) return;
    if (t.status === to) return;
    if (!canTransition(t, to)) {
      toast("当前角色无权执行该流转：" + t.status + " → " + to, true);
      renderPage();
      return;
    }
    if (to === "处理中" && (t.status === "待分配" || t.status === "已驳回")) {
      openAssignModal(id, to);
      return;
    }
    if (to === "已完成" || to === "已驳回") {
      openStatusChange(id, to);
      return;
    }
    var res = WOMS.data.changeStatus(state.data, id, to, "归档关闭", WOMS.currentUser);
    if (res.ok) { toast("已流转至「" + to + "」"); renderPage(); }
    else { toast(res.msg, true); renderPage(); }
  }

  // ---------- list ----------
  function listFiltered() {
    var f = state.listFilters;
    return state.data.tickets.filter(function (t) {
      if (f.type && t.type !== f.type) return false;
      if (f.status && t.status !== f.status) return false;
      if (f.assignee && t.assignee !== f.assignee) return false;
      if (f.grid && t.grid !== f.grid) return false;
      if (f.priority && t.priority !== f.priority) return false;
      if (f.kw) {
        var blob = (t.code + " " + t.customerAccount + " " + t.address + " " + t.description + " " + t.assignee + " " + t.grid).toLowerCase();
        if (blob.indexOf(f.kw.toLowerCase()) < 0) return false;
      }
      return true;
    });
  }
  function opt(selected, arr, allLabel) {
    var s = ['<option value="">' + allLabel + '</option>'];
    arr.forEach(function (v) { s.push('<option value="' + escapeHtml(v) + '"' + (selected === v ? " selected" : "") + '>' + escapeHtml(v) + '</option>'); });
    return s.join("");
  }
  function listHtml() {
    var f = state.listFilters;
    var all = listFiltered();
    var total = all.length;
    var size = f.size, pages = Math.max(1, Math.ceil(total / size));
    if (f.page > pages) f.page = pages;
    if (f.page < 1) f.page = 1;
    var slice = all.slice((f.page - 1) * size, f.page * size);

    var rows = slice.map(function (t) {
      return "" +
        '<tr>' +
          '<td class="row-code">' + escapeHtml(t.code) + '</td>' +
          '<td>' + typeBadge(t.type) + '</td>' +
          '<td>' + statusPill(t.status) + '</td>' +
          '<td>' + priorityBadge(t.priority) + '</td>' +
          '<td>' + avatarHtml(t.assignee) + ' <span style="vertical-align:middle">' + escapeHtml(t.assignee || "未分配") + '</span></td>' +
          '<td>' + escapeHtml(t.grid) + '</td>' +
          '<td class="row-code">' + escapeHtml(t.customerAccount) + '</td>' +
          '<td>' + escapeHtml(fmtDate(t.ticketDate)) + '</td>' +
          '<td class="row-actions">' +
            '<button class="btn btn-sm" data-act="detail" data-id="' + escapeHtml(t.id) + '">详情</button>' +
            (canEdit(t) ? '<button class="btn btn-sm" data-act="edit" data-id="' + escapeHtml(t.id) + '">编辑</button>' : "") +
            (canDelete(t) ? '<button class="btn btn-sm btn-danger" data-act="del" data-id="' + escapeHtml(t.id) + '">删除</button>' : "") +
          '</td>' +
        '</tr>';
    }).join("");
    if (!total) rows = '<tr><td colspan="9" class="empty-row">暂无匹配工单</td></tr>';

    var start = total ? (f.page - 1) * size + 1 : 0;
    var end = Math.min(f.page * size, total);

    return "" +
      '<h1 class="page-title">工单列表</h1>' +
      '<div class="toolbar">' +
        '<input class="input search" id="lf-kw" placeholder="搜索编号/账号/地址/描述/处理人" value="' + escapeHtml(f.kw) + '" />' +
        '<select id="lf-type">' + opt(f.type, WOMS.ENUMS.types, "全部类型") + '</select>' +
        '<select id="lf-status">' + opt(f.status, WOMS.ENUMS.statuses, "全部状态") + '</select>' +
        '<select id="lf-assignee">' + opt(f.assignee, getAssignees(), "全部处理人") + '</select>' +
        '<select id="lf-grid">' + opt(f.grid, WOMS.ENUMS.grids, "全部网格") + '</select>' +
        '<select id="lf-priority">' + opt(f.priority, WOMS.ENUMS.priorities, "全部优先级") + '</select>' +
        '<button class="btn btn-sm" id="lf-reset">重置</button>' +
        '<button class="btn btn-sm" id="lf-export">导出CSV</button>' +
        '<label class="btn btn-sm" style="cursor:pointer">导入CSV<input type="file" id="lf-import" accept=".csv,text/csv" style="display:none" /></label>' +
      '</div>' +
      '<div class="table-wrap">' +
        '<table>' +
          '<thead><tr><th>编号</th><th>类型</th><th>状态</th><th>优先级</th><th>处理人</th><th>网格</th><th>客户账号</th><th>工单日期</th><th>操作</th></tr></thead>' +
          '<tbody>' + rows + '</tbody>' +
        '</table>' +
        '<div class="pager">' +
          '<span class="info">共 ' + total + ' 条，第 ' + start + '-' + end + ' 条 / ' + pages + ' 页</span>' +
          '<button class="btn btn-sm" id="pg-prev"' + (f.page <= 1 ? " disabled" : "") + '>上一页</button>' +
          '<span>' + f.page + ' / ' + pages + '</span>' +
          '<button class="btn btn-sm" id="pg-next"' + (f.page >= pages ? " disabled" : "") + '>下一页</button>' +
          '<select id="pg-size">' +
            [10, 20, 50].map(function (n) { return '<option value="' + n + '"' + (f.size === n ? " selected" : "") + '>' + n + '/页</option>'; }).join("") +
          '</select>' +
        '</div>' +
      '</div>';
  }
  function afterList() {
    var f = state.listFilters;
    function bind(id, key, isInput) {
      var n = $("#" + id);
      if (!n) return;
      n.addEventListener(isInput ? "input" : "change", function () {
        f[key] = isInput ? n.value : n.value;
        if (key !== "page") f.page = 1;
        renderPage();
      });
    }
    bind("lf-kw", "kw", true);
    bind("lf-type", "type");
    bind("lf-status", "status");
    bind("lf-assignee", "assignee");
    bind("lf-grid", "grid");
    bind("lf-priority", "priority");
    var reset = $("#lf-reset");
    if (reset) reset.addEventListener("click", function () {
      state.listFilters = { type: "", status: "", assignee: "", grid: "", priority: "", kw: "", page: 1, size: f.size };
      renderPage();
    });
    var ex = $("#lf-export");
    if (ex) ex.addEventListener("click", exportCsv);
    var im = $("#lf-import");
    if (im) im.addEventListener("change", function () { if (im.files && im.files[0]) importCsv(im.files[0]); im.value = ""; });
    var prev = $("#pg-prev"), next = $("#pg-next");
    if (prev) prev.addEventListener("click", function () { f.page--; renderPage(); });
    if (next) next.addEventListener("click", function () { f.page++; renderPage(); });
    var ps = $("#pg-size");
    if (ps) ps.addEventListener("change", function () { f.size = parseInt(ps.value, 10) || 20; f.page = 1; renderPage(); });

    $all("[data-act]").forEach(function (b) {
      b.addEventListener("click", function () {
        var act = b.getAttribute("data-act"), id = b.getAttribute("data-id");
        if (act === "detail") openDetail(id);
        else if (act === "edit") openTicketForm("edit", WOMS.data.getTicket(state.data, id));
        else if (act === "del") openDelete(id);
      });
    });
  }

  // ---------- modal core ----------
  function openModal(inner) {
    $("#modal-root").innerHTML = '<div class="modal-overlay" id="m-overlay">' + inner + '</div>';
    var ov = $("#m-overlay");
    ov.addEventListener("mousedown", function (e) { if (e.target === ov) closeModal(); });
    document.addEventListener("keydown", escClose);
  }
  function escClose(e) { if (e.key === "Escape") closeModal(); }
  function closeModal() { $("#modal-root").innerHTML = ""; document.removeEventListener("keydown", escClose); }

  function selectHtml(selected, arr, allLabel) {
    var s = allLabel ? ['<option value="">' + allLabel + '</option>'] : [];
    arr.forEach(function (v) { s.push('<option value="' + escapeHtml(v) + '"' + (selected === v ? " selected" : "") + '>' + escapeHtml(v) + '</option>'); });
    return s.join("");
  }

  // ---------- ticket form (create / edit) ----------
  function openTicketForm(mode, ticket) {
    if (mode === "create" && !canCreate()) { toast("当前角色无权新建工单", true); return; }
    if (mode === "edit" && ticket && !canEdit(ticket)) { toast("无权编辑该工单", true); return; }
    var t = ticket || {};
    var isEdit = mode === "edit";
    var inner = "" +
      '<div class="modal' + (isEdit ? " wide" : "") + '">' +
        '<div class="modal-head"><span class="modal-title">' + (isEdit ? "编辑工单" : "新建工单") + '</span><button class="modal-close" data-act="cancel">&times;</button></div>' +
        '<div class="modal-body">' +
          '<div class="form-grid">' +
            field("类型", '<select id="f-type">' + selectHtml(t.type || WOMS.ENUMS.types[0], WOMS.ENUMS.types) + '</select>', "f-type-err", true) +
            field("优先级", '<select id="f-priority">' + selectHtml(t.priority || "中", WOMS.ENUMS.priorities) + '</select>', "f-priority-err", true) +
            field("所属网格", '<select id="f-grid">' + selectHtml(t.grid || "", WOMS.ENUMS.grids) + '</select>', "f-grid-err", true) +
            field("归属处理人", '<select id="f-assignee">' + selectHtml(t.assignee || "", getAssignees(), "待分配（不选）") + '</select>', "f-assignee-err", false) +
            field("客户账号", '<input class="input" id="f-account" value="' + escapeHtml(t.customerAccount || "") + '" />', "f-account-err", true) +
            field("客户联系方式", '<input class="input" id="f-contact" value="' + escapeHtml(t.contact || "") + '" />', "f-contact-err", false) +
            field("服务地址", '<input class="input" id="f-address" value="' + escapeHtml(t.address || "") + '" />', "f-address-err", true) +
            field("工单日期", '<input class="input" id="f-date" type="date" value="' + escapeHtml(t.ticketDate || todayStr()) + '" />', "f-date-err", true) +
            fieldFull("问题详情", '<textarea id="f-desc">' + escapeHtml(t.description || "") + '</textarea>', "f-desc-err", true) +
          '</div>' +
        '</div>' +
        '<div class="modal-foot">' +
          '<button class="btn" data-act="cancel">取消</button>' +
          '<button class="btn btn-primary" data-act="save">' + (isEdit ? "保存" : "创建") + '</button>' +
        '</div>' +
      '</div>';
    openModal(inner);
    $("#m-overlay [data-act=cancel]").addEventListener("click", closeModal);
    $("#m-overlay [data-act=save]").addEventListener("click", function () { saveTicketForm(mode, ticket); });
  }
  function field(label, control, errId, required) {
    return '<div class="field"><label class="field-label">' + escapeHtml(label) + (required ? ' <span style="color:#dc2626">*</span>' : "") + '</label>' + control + '<div class="field-error" id="' + errId + '"></div></div>';
  }
  function fieldFull(label, control, errId, required) {
    return '<div class="field full"><label class="field-label">' + escapeHtml(label) + (required ? ' <span style="color:#dc2626">*</span>' : "") + '</label>' + control + '<div class="field-error" id="' + errId + '"></div></div>';
  }
  function setErr(id, msg) { var n = $("#" + id); if (n) n.textContent = msg || ""; return !!msg; }
  function markInvalid(id, bad) { var n = $("#" + id); if (n) n.classList.toggle("invalid", bad); }
  function saveTicketForm(mode, ticket) {
    var fields = {
      type: $("#f-type").value,
      priority: $("#f-priority").value,
      grid: $("#f-grid").value,
      assignee: $("#f-assignee").value,
      customerAccount: $("#f-account").value.trim(),
      contact: $("#f-contact").value.trim(),
      address: $("#f-address").value.trim(),
      ticketDate: $("#f-date").value,
      description: $("#f-desc").value.trim()
    };
    var bad = false;
    bad = setErr("f-account-err", fields.customerAccount ? "" : "请输入客户账号") || bad;
    markInvalid("f-account", !fields.customerAccount);
    bad = setErr("f-address-err", fields.address ? "" : "请输入服务地址") || bad;
    markInvalid("f-address", !fields.address);
    bad = setErr("f-date-err", fields.ticketDate ? "" : "请选择工单日期") || bad;
    markInvalid("f-date", !fields.ticketDate);
    bad = setErr("f-desc-err", fields.description ? "" : "请填写问题详情") || bad;
    markInvalid("f-desc", !fields.description);
    if (bad) return;

    if (mode === "edit" && ticket) {
      WOMS.data.updateFields(state.data, ticket.id, fields, "编辑工单信息", WOMS.currentUser);
      toast("工单已更新");
    } else {
      var t = WOMS.data.createTicket(state.data, fields, WOMS.currentUser);
      if (fields.assignee && fields.assignee !== "") {
        WOMS.data.changeStatus(state.data, t.id, "处理中", "分配给" + fields.assignee, WOMS.currentUser);
      }
      toast("工单已创建：" + t.code);
    }
    closeModal();
    refresh();
  }

  // ---------- detail ----------
  function openDetail(id) {
    var t = WOMS.data.getTicket(state.data, id);
    if (!t) { toast("工单不存在", true); return; }
    var allowed = (WOMS.TRANSITIONS[t.status] || []).filter(function (to) { return canTransition(t, to); });
    var flowBtns = allowed.map(function (to) {
      return '<button class="btn btn-sm btn-primary" data-flow="' + escapeHtml(to) + '">流转至「' + escapeHtml(to) + '」</button>';
    }).join("");
    if (!flowBtns) flowBtns = '<span class="muted" style="font-size:13px">当前状态无可用流转或当前角色无权限</span>';

    var tl = (t.history || []).map(function (h) {
      var cls = h.action === "创建" ? "tl-item create" : "tl-item";
      var flow = (h.from || h.to) ? '<div class="tl-flow">' + escapeHtml(h.from || "—") + ' → ' + escapeHtml(h.to || "—") + '</div>' : "";
      return "" +
        '<div class="' + cls + '">' +
          '<div class="tl-dot"></div>' +
          '<div class="tl-head"><span class="tl-action">' + escapeHtml(h.action) + '</span><span class="tl-time">' + escapeHtml(fmtDateTime(h.time)) + '</span><span class="muted" style="font-size:12px">· ' + escapeHtml(h.operator) + '</span></div>' +
          flow +
          (h.note ? '<div class="tl-note">' + escapeHtml(h.note) + '</div>' : "") +
        '</div>';
    }).join("");

    var inner = "" +
      '<div class="modal wide">' +
        '<div class="modal-head"><span class="modal-title">工单详情</span><button class="modal-close" data-act="cancel">&times;</button></div>' +
        '<div class="modal-body">' +
          '<div class="detail-head">' +
            '<span class="detail-code">' + escapeHtml(t.code) + '</span>' +
            typeBadge(t.type) +
            statusPill(t.status) +
            priorityBadge(t.priority) +
            (canEdit(t) ? '<button class="btn btn-sm" id="d-edit" style="margin-left:auto">编辑</button>' : "") +
          '</div>' +
          '<div class="detail-grid">' +
            detailItem("客户账号", t.customerAccount) +
            detailItem("客户联系方式", t.contact || "—") +
            detailItem("归属处理人", t.assignee || "未分配") +
            detailItem("所属网格", t.grid) +
            detailItem("工单日期", fmtDate(t.ticketDate)) +
            detailItem("创建人", t.creator) +
            detailItem("创建时间", fmtDateTime(t.createdAt)) +
            detailItem("更新时间", fmtDateTime(t.updatedAt)) +
          '</div>' +
          '<div class="detail-section-title">服务地址</div><div class="v" style="margin-bottom:16px">' + escapeHtml(t.address) + '</div>' +
          '<div class="detail-section-title">问题详情</div><div class="v" style="margin-bottom:16px;white-space:pre-wrap">' + escapeHtml(t.description) + '</div>' +
          '<div class="detail-section-title">状态流转</div>' +
          '<div style="margin-bottom:18px">' + flowBtns + '</div>' +
          '<div class="detail-section-title">操作历史</div>' +
          '<div class="timeline">' + (tl || '<div class="muted">暂无记录</div>') + '</div>' +
        '</div>' +
        '<div class="modal-foot"><button class="btn" data-act="cancel">关闭</button></div>' +
      '</div>';
    openModal(inner);
    $("#m-overlay [data-act=cancel]").addEventListener("click", closeModal);
    var edit = $("#d-edit");
    if (edit) edit.addEventListener("click", function () { closeModal(); openTicketForm("edit", t); });
    $all("#m-overlay [data-flow]").forEach(function (b) {
      b.addEventListener("click", function () {
        var to = b.getAttribute("data-flow");
        closeModal();
        if (to === "处理中" && (t.status === "待分配" || t.status === "已驳回")) openAssignModal(id, to);
        else openStatusChange(id, to);
      });
    });
  }
  function detailItem(k, v) {
    return '<div class="detail-item"><div class="k">' + escapeHtml(k) + '</div><div class="v">' + escapeHtml(v === undefined || v === null || v === "" ? "—" : v) + '</div></div>';
  }

  // ---------- assign modal (待分配/已驳回 -> 处理中) ----------
  function openAssignModal(id, to) {
    var t = WOMS.data.getTicket(state.data, id);
    if (!t) return;
    var inner = "" +
      '<div class="modal">' +
        '<div class="modal-head"><span class="modal-title">分配处理人</span><button class="modal-close" data-act="cancel">&times;</button></div>' +
        '<div class="modal-body">' +
          '<div class="flow-row">' + escapeHtml(t.status) + ' <span class="arrow">→</span> ' + escapeHtml(to) + '</div>' +
          '<div class="field"><label class="field-label">归属处理人 <span style="color:#dc2626">*</span></label>' +
            '<select id="a-assignee">' + selectHtml("", getAssignees(), "请选择处理人") + '</select>' +
            '<div class="field-error" id="a-err"></div>' +
          '</div>' +
          '<div class="field" style="margin-top:14px"><label class="field-label">备注</label><textarea id="a-note" placeholder="如：分配给 XX 处理"></textarea></div>' +
        '</div>' +
        '<div class="modal-foot"><button class="btn" data-act="cancel">取消</button><button class="btn btn-primary" data-act="ok">确认分配</button></div>' +
      '</div>';
    openModal(inner);
    $("#m-overlay [data-act=cancel]").addEventListener("click", closeModal);
    $("#m-overlay [data-act=ok]").addEventListener("click", function () {
      var asg = $("#a-assignee").value;
      var note = $("#a-note").value.trim() || ("分配给" + asg);
      if (!asg) { setErr("a-err", "请选择处理人"); return; }
      WOMS.data.updateFields(state.data, id, { assignee: asg }, note, WOMS.currentUser);
      var res = WOMS.data.changeStatus(state.data, id, to, note, WOMS.currentUser);
      if (res.ok) { toast("已分配给 " + asg); closeModal(); refresh(); }
      else toast(res.msg, true);
    });
  }

  // ---------- status change modal (完成/驳回/关闭) ----------
  function openStatusChange(id, to) {
    var t = WOMS.data.getTicket(state.data, id);
    if (!t) return;
    var mustNote = (to === "已完成" || to === "已驳回");
    var inner = "" +
      '<div class="modal">' +
        '<div class="modal-head"><span class="modal-title">状态流转</span><button class="modal-close" data-act="cancel">&times;</button></div>' +
        '<div class="modal-body">' +
          '<div class="flow-row">' + escapeHtml(t.status) + ' <span class="arrow">→</span> ' + escapeHtml(to) + '</div>' +
          '<div class="field"><label class="field-label">备注' + (mustNote ? ' <span style="color:#dc2626">*</span>' : "") + '</label>' +
            '<textarea id="sc-note" placeholder="' + (to === "已完成" ? "说明处理结果" : to === "已驳回" ? "说明驳回原因" : "选填") + '"></textarea>' +
            '<div class="field-error" id="sc-err"></div>' +
          '</div>' +
        '</div>' +
        '<div class="modal-foot"><button class="btn" data-act="cancel">取消</button><button class="btn btn-primary" data-act="ok">确认</button></div>' +
      '</div>';
    openModal(inner);
    $("#m-overlay [data-act=cancel]").addEventListener("click", closeModal);
    $("#m-overlay [data-act=ok]").addEventListener("click", function () {
      var note = $("#sc-note").value.trim();
      if (mustNote && !note) { setErr("sc-err", "该操作必须填写备注"); return; }
      var res = WOMS.data.changeStatus(state.data, id, to, note, WOMS.currentUser);
      if (res.ok) { toast("已流转至「" + to + "」"); closeModal(); refresh(); }
      else toast(res.msg, true);
    });
  }

  // ---------- delete confirm ----------
  function openDelete(id) {
    var t = WOMS.data.getTicket(state.data, id);
    if (!t) return;
    var inner = "" +
      '<div class="modal">' +
        '<div class="modal-head"><span class="modal-title">删除工单</span><button class="modal-close" data-act="cancel">&times;</button></div>' +
        '<div class="modal-body"><div class="confirm-msg">确认删除工单 <b>' + escapeHtml(t.code) + '</b>？此操作不可恢复。</div></div>' +
        '<div class="modal-foot"><button class="btn" data-act="cancel">取消</button><button class="btn btn-danger" data-act="ok">确认删除</button></div>' +
      '</div>';
    openModal(inner);
    $("#m-overlay [data-act=cancel]").addEventListener("click", closeModal);
    $("#m-overlay [data-act=ok]").addEventListener("click", function () {
      WOMS.data.deleteTicket(state.data, id, WOMS.currentUser);
      toast("工单已移入回收站");
      closeModal();
      refresh();
    });
  }

  // ---------- recycle bin ----------
  function recycleHtml() {
    var data = state.data;
    var rec = data.recycle || [];
    var rows = rec.map(function (t) {
      return "" +
        '<tr>' +
          '<td class="row-code">' + escapeHtml(t.code) + '</td>' +
          '<td>' + typeBadge(t.type) + '</td>' +
          '<td>' + statusPill(t.status) + '</td>' +
          '<td>' + escapeHtml(t.assignee || "未分配") + '</td>' +
          '<td>' + escapeHtml(fmtDateTime(t.deletedAt)) + '</td>' +
          '<td class="row-actions">' +
            '<button class="btn btn-sm" data-ract="restore" data-id="' + escapeHtml(t.id) + '">恢复</button>' +
            '<button class="btn btn-sm btn-danger" data-ract="purge" data-id="' + escapeHtml(t.id) + '">彻底删除</button>' +
          '</td>' +
        '</tr>';
    }).join("");
    if (!rec.length) rows = '<tr><td colspan="6" class="empty-row">回收站为空</td></tr>';
    return "" +
      '<h1 class="page-title">回收站</h1>' +
      '<div class="toolbar">' +
        '<span class="muted" style="font-size:12px">删除的工单可在此恢复；彻底删除不可恢复</span>' +
        '<span class="spacer"></span>' +
        '<span class="muted" style="font-size:12px">共 ' + rec.length + ' 条</span>' +
        (rec.length ? '<button class="btn btn-sm btn-danger" id="rc-empty">清空回收站</button>' : "") +
      '</div>' +
      '<div class="table-wrap">' +
        '<table><thead><tr><th>编号</th><th>类型</th><th>状态</th><th>处理人</th><th>删除时间</th><th>操作</th></tr></thead>' +
        '<tbody>' + rows + '</tbody></table>' +
      '</div>';
  }
  function afterRecycle() {
    $all("[data-ract]").forEach(function (b) {
      b.addEventListener("click", function () {
        var act = b.getAttribute("data-ract"), id = b.getAttribute("data-id");
        if (act === "restore") {
          WOMS.data.restoreTicket(state.data, id, WOMS.currentUser);
          toast("已恢复工单");
          refresh();
        } else if (act === "purge") {
          openPurge(id);
        }
      });
    });
    var emp = $("#rc-empty");
    if (emp) emp.addEventListener("click", openEmptyRecycle);
  }
  function openPurge(id) {
    var t = WOMS.data.getRecycle(state.data, id);
    if (!t) return;
    var inner = "" +
      '<div class="modal">' +
        '<div class="modal-head"><span class="modal-title">彻底删除</span><button class="modal-close" data-act="cancel">&times;</button></div>' +
        '<div class="modal-body"><div class="confirm-msg">确认彻底删除工单 <b>' + escapeHtml(t.code) + '</b>？此操作不可恢复。</div></div>' +
        '<div class="modal-foot"><button class="btn" data-act="cancel">取消</button><button class="btn btn-danger" data-act="ok">确认删除</button></div>' +
      '</div>';
    openModal(inner);
    $("#m-overlay [data-act=cancel]").addEventListener("click", closeModal);
    $("#m-overlay [data-act=ok]").addEventListener("click", function () {
      WOMS.data.purgeTicket(state.data, id, WOMS.currentUser);
      toast("已彻底删除");
      closeModal();
      refresh();
    });
  }
  function openEmptyRecycle() {
    var rec = state.data.recycle || [];
    if (!rec.length) { toast("回收站已为空"); return; }
    var inner = "" +
      '<div class="modal">' +
        '<div class="modal-head"><span class="modal-title">清空回收站</span><button class="modal-close" data-act="cancel">&times;</button></div>' +
        '<div class="modal-body"><div class="confirm-msg">确认清空回收站中的 ' + rec.length + ' 条工单？此操作不可恢复。</div></div>' +
        '<div class="modal-foot"><button class="btn" data-act="cancel">取消</button><button class="btn btn-danger" data-act="ok">确认清空</button></div>' +
      '</div>';
    openModal(inner);
    $("#m-overlay [data-act=cancel]").addEventListener("click", closeModal);
    $("#m-overlay [data-act=ok]").addEventListener("click", function () {
      WOMS.data.emptyRecycle(state.data);
      toast("回收站已清空");
      closeModal();
      refresh();
    });
  }

  // ---------- CSV import / export ----------
  function exportCsv() {
    var list = listFiltered();
    var csv = WOMS.csv.export(list);
    var blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    var url = URL.createObjectURL(blob);
    var ael = document.createElement("a");
    ael.href = url;
    ael.download = "工单_" + todayStr().replace(/-/g, "") + ".csv";
    document.body.appendChild(ael);
    ael.click();
    document.body.removeChild(ael);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    toast("已导出 " + list.length + " 条工单");
  }
  function importCsv(file) {
    var reader = new FileReader();
    reader.onload = function () {
      var res = WOMS.csv.parse(reader.result);
      if (!res.ok) { toast(res.msg || "导入失败", true); return; }
      var ok = 0;
      res.imported.forEach(function (f) {
        WOMS.data.createTicket(state.data, f, f.creator || "导入");
        ok++;
      });
      toast("成功导入 " + ok + " 条" + (res.failed ? "，跳过 " + res.failed + " 条无效行" : ""));
      refresh();
    };
    reader.onerror = function () { toast("读取文件失败", true); };
    reader.readAsText(file, "utf-8");
  }

  // ---------- operation log ----------
  function logEntries() {
    var f = state.logFilters;
    var entries = [];
    state.data.tickets.forEach(function (t) {
      (t.history || []).forEach(function (h) {
        entries.push({ time: h.time, code: t.code, action: h.action, operator: h.operator, from: h.from, to: h.to, note: h.note, deleted: false });
      });
    });
    (state.data.recycle || []).forEach(function (t) {
      (t.history || []).forEach(function (h) {
        entries.push({ time: h.time, code: t.code, action: h.action, operator: h.operator, from: h.from, to: h.to, note: h.note, deleted: true });
      });
    });
    entries.sort(function (a, b) { return a.time < b.time ? 1 : -1; });
    return entries.filter(function (e) {
      if (f.action && e.action !== f.action) return false;
      if (f.operator && e.operator !== f.operator) return false;
      if (f.kw) {
        var blob = (e.code + " " + e.note + " " + e.from + " " + e.to + " " + e.operator).toLowerCase();
        if (blob.indexOf(f.kw.toLowerCase()) < 0) return false;
      }
      var d = e.time.slice(0, 10);
      if (f.from && d < f.from) return false;
      if (f.to && d > f.to) return false;
      return true;
    });
  }
  function logOperators() {
    var set = {};
    state.data.tickets.forEach(function (t) { (t.history || []).forEach(function (h) { set[h.operator] = 1; }); });
    (state.data.recycle || []).forEach(function (t) { (t.history || []).forEach(function (h) { set[h.operator] = 1; }); });
    return Object.keys(set).sort();
  }
  function logHtml() {
    var f = state.logFilters;
    var all = logEntries();
    var total = all.length;
    var size = f.size, pages = Math.max(1, Math.ceil(total / size));
    if (f.page > pages) f.page = pages;
    if (f.page < 1) f.page = 1;
    var slice = all.slice((f.page - 1) * size, f.page * size);

    var rows = slice.map(function (e) {
      var flow = (e.from || e.to) ? '<span class="tl-flow">' + escapeHtml(e.from || "—") + " → " + escapeHtml(e.to || "—") + "</span>" : "";
      var codeCell = escapeHtml(e.code) + (e.deleted ? ' <span class="pill" style="color:#dc2626;background:#fef2f2">已删除</span>' : "");
      return "" +
        "<tr>" +
          '<td class="row-code">' + escapeHtml(fmtDateTime(e.time)) + "</td>" +
          '<td class="row-code">' + codeCell + "</td>" +
          "<td>" + escapeHtml(e.action) + "</td>" +
          "<td>" + escapeHtml(e.operator) + "</td>" +
          "<td>" + flow + "</td>" +
          "<td>" + escapeHtml(e.note || "") + "</td>" +
        "</tr>";
    }).join("");
    if (!total) rows = '<tr><td colspan="6" class="empty-row">暂无日志记录</td></tr>';

    var start = total ? (f.page - 1) * size + 1 : 0;
    var end = Math.min(f.page * size, total);
    var actions = ["创建", "状态变更", "编辑", "恢复"];
    var ops = logOperators();

    return "" +
      '<h1 class="page-title">操作日志</h1>' +
      '<div class="toolbar">' +
        '<select id="lg-action"><option value="">全部动作</option>' + actions.map(function (x) { return '<option value="' + escapeHtml(x) + '"' + (f.action === x ? " selected" : "") + ">" + escapeHtml(x) + "</option>"; }).join("") + "</select>" +
        '<select id="lg-operator"><option value="">全部操作人</option>' + ops.map(function (x) { return '<option value="' + escapeHtml(x) + '"' + (f.operator === x ? " selected" : "") + ">" + escapeHtml(x) + "</option>"; }).join("") + "</select>" +
        '<input class="input search" id="lg-kw" placeholder="搜索工单编号/备注/操作人" value="' + escapeHtml(f.kw) + '" />' +
        '<label class="toolbar-label">起</label><input class="input" id="lg-from" type="date" value="' + escapeHtml(f.from) + '" style="min-width:130px" />' +
        '<label class="toolbar-label">止</label><input class="input" id="lg-to" type="date" value="' + escapeHtml(f.to) + '" style="min-width:130px" />' +
        '<button class="btn btn-sm" id="lg-reset">重置</button>' +
      "</div>" +
      '<div class="table-wrap">' +
        "<table><thead><tr><th>时间</th><th>工单编号</th><th>动作</th><th>操作人</th><th>流转</th><th>备注</th></tr></thead>" +
        "<tbody>" + rows + "</tbody></table>" +
        '<div class="pager">' +
          '<span class="info">共 ' + total + " 条，第 " + start + "-" + end + " 条 / " + pages + " 页</span>" +
          '<button class="btn btn-sm" id="lg-prev"' + (f.page <= 1 ? " disabled" : "") + ">上一页</button>" +
          "<span>" + f.page + " / " + pages + "</span>" +
          '<button class="btn btn-sm" id="lg-next"' + (f.page >= pages ? " disabled" : "") + ">下一页</button>" +
          '<select id="lg-size">' + [20, 50, 100].map(function (n) { return '<option value="' + n + '"' + (f.size === n ? " selected" : "") + ">" + n + "/页</option>"; }).join("") + "</select>" +
        "</div>" +
      "</div>";
  }
  function afterLog() {
    var f = state.logFilters;
    function bind(id, key, isInput) {
      var n = $("#" + id);
      if (!n) return;
      n.addEventListener(isInput ? "input" : "change", function () {
        f[key] = isInput ? n.value : n.value;
        if (key !== "page") f.page = 1;
        renderPage();
      });
    }
    bind("lg-action", "action");
    bind("lg-operator", "operator");
    bind("lg-kw", "kw", true);
    bind("lg-from", "from");
    bind("lg-to", "to");
    var reset = $("#lg-reset");
    if (reset) reset.addEventListener("click", function () {
      state.logFilters = { action: "", operator: "", kw: "", from: "", to: "", page: 1, size: f.size };
      renderPage();
    });
    var prev = $("#lg-prev"), next = $("#lg-next");
    if (prev) prev.addEventListener("click", function () { f.page--; renderPage(); });
    if (next) next.addEventListener("click", function () { f.page++; renderPage(); });
    var ps = $("#lg-size");
    if (ps) ps.addEventListener("change", function () { f.size = parseInt(ps.value, 10) || 20; f.page = 1; renderPage(); });
  }

  // ---------- sync indicator ----------
  function setSyncIndicator(state) {
    var el = $("#sync-indicator"), btn = $("#sync-now-btn");
    if (!el) return;
    if (!WOMS.sync || !WOMS.sync.enabled) { el.style.display = "none"; if (btn) btn.style.display = "none"; return; }
    el.style.display = ""; if (btn) btn.style.display = "";
    el.className = "sync-indicator " + state;
    var label = el.querySelector(".label");
    if (label) label.textContent = state === "syncing" ? "同步中" : state === "error" ? "同步失败" : state === "online" ? "云端已连接" : "离线";
  }

  // ---------- init ----------
    // 动态归属处理人列表：profiles + tickets.assignee distinct + 硬编码兜底
  // profiles 来源于 register 时的登记；旧单据上的名字保留（删除 profile 不影响旧数据归属）。
  // 拉取失败/网络断开时回退到 getAssignees()，功能不丢。
  var ASSIGNEE_CACHE = null;
  function getAssignees() {
    if (ASSIGNEE_CACHE && ASSIGNEE_CACHE.names && ASSIGNEE_CACHE.names.length) return ASSIGNEE_CACHE.names;
    var names = [];
    var seen = Object.create(null);
    function add(n) {
      n = (n || "").trim();
      if (!n || seen[n]) return;
      seen[n] = 1;
      names.push(n);
    }
    (WOMS.ENUMS.assignees || []).forEach(add);
    if (ASSIGNEE_CACHE && Array.isArray(ASSIGNEE_CACHE.profiles)) {
      ASSIGNEE_CACHE.profiles.forEach(function (p) { add(p.name); });
    }
    try {
      var data = WOMS.data.load();
      (data.tickets || []).forEach(function (t) { add(t.assignee); });
    } catch (e) {}
    return names;
  }
  function refreshAssignees() {
    if (!WOMS.auth || !WOMS.auth.listProfiles) { ASSIGNEE_CACHE = { profiles: [], names: [] }; return Promise.resolve(); }
    return WOMS.auth.listProfiles().then(function (rows) {
      var profiles = (rows || []).filter(function (p) { return p && p.name; });
      ASSIGNEE_CACHE = { profiles: profiles, names: [] };
      renderPage();
    }).catch(function () { ASSIGNEE_CACHE = { profiles: [], names: [] }; });
  }

  var bound = false;
  function bindAuthTabs() {
    var tabs = $all("#auth-tabs .auth-tab");
    var loginForm = $("#login-form"), regForm = $("#register-form");
    var sub = $("#auth-sub"), hint = $("#login-hint");
    tabs.forEach(function (t) {
      if (t.dataset.bound) return;
      t.dataset.bound = "1";
      t.addEventListener("click", function () {
        tabs.forEach(function (x) { x.classList.toggle("active", x === t); });
        var mode = t.dataset.tab;
        if (mode === "register") {
          loginForm.style.display = "none";
          regForm.style.display = "";
          if (sub) sub.textContent = "注册后可登录使用";
          if (hint) hint.style.display = "none";
        } else {
          loginForm.style.display = "";
          regForm.style.display = "none";
          if (sub) sub.textContent = "请登录后使用";
          if (hint) hint.style.display = "";
        }
      });
    });
  }

  function bindRegister() {
    var form = $("#register-form");
    if (!form) return;
    if (form.dataset.bound) return;
    form.dataset.bound = "1";
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var name = ($("#reg-name").value || "").trim();
      var acct = ($("#reg-account").value || "").trim();
      var pw = $("#reg-password").value || "";
      var pw2 = $("#reg-password2").value || "";
      var err = $("#register-error"), ok = $("#register-ok");
      var btn = form.querySelector(".login-submit");
      if (err) err.textContent = "";
      if (ok) ok.style.display = "none";
      if (!name || !acct || !pw || !pw2) { if (err) err.textContent = "请填写完整"; return; }
      if (pw !== pw2) { if (err) err.textContent = "两次密码不一致"; return; }
      if (btn) btn.disabled = true;
      WOMS.auth.register(acct, name, pw).then(function (res) {
        if (btn) btn.disabled = false;
        if (!res.ok) { if (err) err.textContent = res.msg || "注册失败"; return; }
        $("#reg-password").value = "";
        $("#reg-password2").value = "";
        if (res.autoLogin) {
          if (ok) { ok.textContent = "注册成功，正在进入系统..."; ok.style.display = ""; }
          refreshAssignees();
          setTimeout(function () {
            var lv = $("#login-view"); if (lv) lv.style.display = "none";
            init();
          }, 600);
        } else {
          if (ok) { ok.textContent = res.msg || "注册成功，请使用账号密码登录"; ok.style.display = ""; }
          var loginTab = document.querySelector('#auth-tabs .auth-tab[data-tab="login"]');
          if (loginTab) loginTab.click();
          $("#login-username").value = acct;
          $("#login-password").focus();
        }
      }).catch(function () {
        if (btn) btn.disabled = false;
        if (err) err.textContent = "网络错误，无法连接认证服务";
      });
    });
  }

  function bindLogin() {
    var form = $("#login-form");
    if (!form) return;
    bindAuthTabs();
    bindRegister();
    if (form.dataset.bound) { var u0 = $("#login-username"); if (u0) u0.focus(); return; }
    form.dataset.bound = "1";
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var u = ($("#login-username").value || "").trim();
      var p = $("#login-password").value || "";
      var err = $("#login-error");
      var btn = form.querySelector(".login-submit");
      if (btn) btn.disabled = true;
      if (err) err.textContent = "";
      WOMS.auth.login(u, p).then(function (res) {
        if (btn) btn.disabled = false;
        if (!res.ok) { if (err) err.textContent = res.msg || "登录失败"; return; }
        $("#login-password").value = "";
        var lv = $("#login-view"); if (lv) lv.style.display = "none";
        init();
      }).catch(function () {
        if (btn) btn.disabled = false;
        if (err) err.textContent = "网络错误，无法连接认证服务";
      });
    });
    var u0 = $("#login-username"); if (u0) u0.focus();
  }

  function init() {
    var hash = location.hash || "#/";
    if (hash.indexOf("#/m") === 0) { enterMobile(); return; }
    var s = WOMS.auth ? WOMS.auth.applySession() : null;
    if (WOMS.auth && !s) { showLogin(); return; }
    if (WOMS.auth && s) {
      setSyncIndicator(WOMS.sync && WOMS.sync.enabled ? "syncing" : "offline");
      WOMS.auth.verifySession().then(function (v) {
        if (!v) { showLogin(); return; }
        enterPC(v.offline);
      });
      return;
    }
    enterPC(false);
  }

  function enterMobile() {
    showMobile();
    if (WOMS.sync && WOMS.sync.enabled && !state.mobileSynced) {
      state.mobileSynced = true;
      WOMS.sync.loadRemote().then(function (d) {
        if (d) { state.data = d; if (WOMS.mobile) WOMS.mobile.render(); }
      });
    }
  }

  function enterPC(offline) {
    state.offline = !!offline;
    reload();
    refreshAssignees();
    if (WOMS.sync && WOMS.sync.enabled) {
      setSyncIndicator("syncing");
      WOMS.sync.loadRemote().then(function (remoteData) {
        if (remoteData) { state.data = remoteData; renderPage(); setSyncIndicator("online"); }
        else { setSyncIndicator("error"); }
      });
    }
    if (!bound) {
      bound = true;
      $all("#nav-tabs .nav-tab").forEach(function (t) {
        t.addEventListener("click", function () {
          var p = t.dataset.page;
          location.hash = p === "overview" ? "#/" : ("#/" + p);
        });
      });
      var nb = $("#new-ticket-btn");
      if (nb) nb.addEventListener("click", function () { openTicketForm("create"); });
      var snb = $("#sync-now-btn");
      if (snb) snb.addEventListener("click", function () {
        if (!WOMS.sync || !WOMS.sync.enabled) { toast("同步未启用"); return; }
        snb.disabled = true;
        setSyncIndicator("syncing");
        WOMS.sync.pushNow().then(function (ok) {
          snb.disabled = false;
          if (ok) { toast("同步完成"); setSyncIndicator("online"); }
          else { toast("同步失败，查看控制台", true); setSyncIndicator("error"); }
        });
      });
      var lb = $("#logout-btn");
      if (lb) lb.addEventListener("click", function () {
        var done = function () { showLogin(); };
        if (WOMS.auth && WOMS.auth.logout) WOMS.auth.logout().then(done);
        else done();
      });
      window.addEventListener("hashchange", route);
    }
    setSyncIndicator(WOMS.sync && WOMS.sync.enabled ? "online" : "offline");
    syncHeaderRole();
    route();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();

  WOMS.app = { renderPage: renderPage, reload: reload, refresh: refresh, toast: toast };
})();
