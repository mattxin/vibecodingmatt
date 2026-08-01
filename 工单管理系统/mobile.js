// mobile.js — 移动 H5 只读查询：按 类型/状态/处理人 筛选
(function () {
  "use strict";
  var WOMS = window.WOMS = window.WOMS || {};

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
  function opt(selected, arr, allLabel) {
    var s = ['<option value="">' + allLabel + '</option>'];
    arr.forEach(function (v) { s.push('<option value="' + escapeHtml(v) + '"' + (selected === v ? " selected" : "") + '>' + escapeHtml(v) + '</option>'); });
    return s.join("");
  }

  var mstate = { view: "list", filters: { type: "", status: "", assignee: "" }, detailId: null };

  function filtered() {
    var f = mstate.filters;
    var data = WOMS.data.load();
    return data.tickets.filter(function (t) {
      if (f.type && t.type !== f.type) return false;
      if (f.status && t.status !== f.status) return false;
      if (f.assignee && t.assignee !== f.assignee) return false;
      return true;
    });
  }

  function render() {
    var root = $("#mobile-app");
    if (!root) return;
    if (mstate.view === "detail") root.innerHTML = detailHtml();
    else root.innerHTML = listHtml();
    afterRender();
  }

  function listHtml() {
    var f = mstate.filters;
    var list = filtered();
    var cards = list.map(function (t) {
      return '' +
        '<div class="m-card" data-id="' + escapeHtml(t.id) + '">' +
          '<div class="m-card-top">' +
            '<span class="m-card-code">' + escapeHtml(t.code) + '</span>' +
            typeBadge(t.type) +
            statusPill(t.status) +
          '</div>' +
          '<div class="m-card-desc">' + escapeHtml(t.description || "") + '</div>' +
          '<div class="m-card-meta">' +
            '<span class="mi">' + priorityBadge(t.priority) + '</span>' +
            '<span class="mi">处理人：' + escapeHtml(t.assignee || "未分配") + '</span>' +
            '<span class="mi">日期：' + escapeHtml(fmtDate(t.ticketDate)) + '</span>' +
            '<span class="mi">地址：' + escapeHtml(t.address || "—") + '</span>' +
          '</div>' +
        '</div>';
    }).join("");
    if (!list.length) cards = '<div class="m-empty">暂无匹配工单</div>';

    return '' +
      '<div class="m-header">' +
        '<span class="title">工单查询</span>' +
        '<span class="spacer"></span>' +
      '</div>' +
      '<div class="m-filters">' +
        '<div class="m-filter-row"><label>工单类型</label><select id="mf-type">' + opt(f.type, WOMS.ENUMS.types, "全部类型") + '</select></div>' +
        '<div class="m-filter-row"><label>完成状态</label><select id="mf-status">' + opt(f.status, WOMS.ENUMS.statuses, "全部状态") + '</select></div>' +
        '<div class="m-filter-row"><label>归属处理人</label><select id="mf-assignee">' + opt(f.assignee, WOMS.ENUMS.assignees, "全部处理人") + '</select></div>' +
      '</div>' +
      '<div class="m-list">' + cards + '</div>' +
      '<div style="text-align:center;color:#9ca3af;font-size:12px;padding:8px 0 24px">共 ' + list.length + ' 条 · 仅查询，不可编辑</div>';
  }

  function detailHtml() {
    var data = WOMS.data.load();
    var t = WOMS.data.getTicket(data, mstate.detailId);
    if (!t) {
      return '' +
        '<div class="m-header"><button class="back" id="m-back">&lsaquo;</button><span class="title">工单详情</span><span class="spacer"></span></div>' +
        '<div class="m-empty">工单不存在</div>';
    }
    var tl = (t.history || []).map(function (h) {
      var flow = (h.from || h.to) ? '<div class="tl-flow">' + escapeHtml(h.from || "—") + ' → ' + escapeHtml(h.to || "—") + '</div>' : "";
      return '' +
        '<div class="tl-item' + (h.action === "创建" ? " create" : "") + '">' +
          '<div class="tl-dot"></div>' +
          '<div class="tl-head"><span class="tl-action">' + escapeHtml(h.action) + '</span><span class="tl-time">' + escapeHtml(fmtDateTime(h.time)) + '</span></div>' +
          flow +
          (h.note ? '<div class="tl-note">' + escapeHtml(h.note) + '</div>' : "") +
        '</div>';
    }).join("");

    return '' +
      '<div class="m-header">' +
        '<button class="back" id="m-back">&lsaquo;</button>' +
        '<span class="title">工单详情</span>' +
        '<span class="spacer"></span>' +
      '</div>' +
      '<div class="m-detail">' +
        '<div class="m-detail-head">' +
          '<span class="m-detail-code">' + escapeHtml(t.code) + '</span>' +
          typeBadge(t.type) +
          statusPill(t.status) +
          priorityBadge(t.priority) +
        '</div>' +
        '<div class="m-detail-section">' +
          '<h3>基本信息</h3>' +
          mField("工单类型", t.type) +
          mField("完成状态", t.status) +
          mField("优先级", t.priority) +
          mField("归属处理人", t.assignee || "未分配") +
          mField("所属网格", t.grid) +
        '</div>' +
        '<div class="m-detail-section">' +
          '<h3>客户信息</h3>' +
          mField("客户账号", t.customerAccount) +
          mField("联系方式", t.contact || "—") +
          mField("服务地址", t.address) +
        '</div>' +
        '<div class="m-detail-section">' +
          '<h3>工单信息</h3>' +
          mField("工单日期", fmtDate(t.ticketDate)) +
          mField("创建人", t.creator) +
          mField("创建时间", fmtDateTime(t.createdAt)) +
          mField("更新时间", fmtDateTime(t.updatedAt)) +
        '</div>' +
        '<div class="m-detail-section">' +
          '<h3>问题详情</h3>' +
          '<div style="font-size:14px;line-height:1.6;white-space:pre-wrap">' + escapeHtml(t.description || "") + '</div>' +
        '</div>' +
        '<div class="m-detail-section">' +
          '<h3>操作历史</h3>' +
          '<div class="timeline">' + (tl || '<div class="muted">暂无记录</div>') + '</div>' +
        '</div>' +
        '<div style="text-align:center;color:#9ca3af;font-size:12px;padding:8px 0 24px">仅查询，不可编辑</div>' +
      '</div>';
  }
  function mField(k, v) {
    return '<div class="m-field"><span class="mk">' + escapeHtml(k) + '</span><span class="mv">' + escapeHtml(v === undefined || v === null || v === "" ? "—" : v) + '</span></div>';
  }

  function afterRender() {
    if (mstate.view === "list") {
      ["type", "status", "assignee"].forEach(function (key) {
        var n = $("#mf-" + key);
        if (n) n.addEventListener("change", function () { mstate.filters[key] = n.value; render(); });
      });
      $all(".m-card").forEach(function (c) {
        c.addEventListener("click", function () { mstate.view = "detail"; mstate.detailId = c.getAttribute("data-id"); render(); window.scrollTo(0, 0); });
      });
    } else {
      var back = $("#m-back");
      if (back) back.addEventListener("click", function () { mstate.view = "list"; mstate.detailId = null; render(); window.scrollTo(0, 0); });
    }
  }

  WOMS.mobile = {
    render: render,
    back: function () { mstate.view = "list"; mstate.detailId = null; render(); }
  };
})();
