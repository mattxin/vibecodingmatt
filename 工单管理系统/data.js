// data.js — 数据层：枚举、存储、种子数据、CRUD、状态流转
(function () {
  "use strict";
  var WOMS = window.WOMS = window.WOMS || {};

  WOMS.ENUMS = {
    types: ["故障报修", "投诉建议", "安装开通", "日常巡检", "其他"],
    statuses: ["待分配", "处理中", "已完成", "已驳回", "已关闭"],
    priorities: ["高", "中", "低"],
    grids: ["城东网格", "城西网格", "城南网格", "城北网格", "中心网格"],
    assignees: ["张伟", "李娜", "王强", "刘洋", "陈静"]
  };

  WOMS.STORAGE_KEY = "woms_data_v1";

  WOMS.STATUS_META = {
    "待分配": { color: "#6b7280", bg: "#f3f4f6" },
    "处理中": { color: "#2563eb", bg: "#eff6ff" },
    "已完成": { color: "#16a34a", bg: "#f0fdf4" },
    "已驳回": { color: "#dc2626", bg: "#fef2f2" },
    "已关闭": { color: "#475569", bg: "#f1f5f9" }
  };

  WOMS.PRIORITY_META = {
    "高": { color: "#dc2626", bg: "#fef2f2" },
    "中": { color: "#d97706", bg: "#fffbeb" },
    "低": { color: "#6b7280", bg: "#f3f4f6" }
  };

  WOMS.TYPE_COLOR = {
    "故障报修": "#dc2626",
    "投诉建议": "#7c3aed",
    "安装开通": "#2563eb",
    "日常巡检": "#0891b2",
    "其他": "#6b7280"
  };

  // 合法状态流转
  WOMS.TRANSITIONS = {
    "待分配": ["处理中"],
    "处理中": ["已完成", "已驳回"],
    "已驳回": ["处理中", "已关闭"],
    "已完成": ["已关闭"],
    "已关闭": []
  };

  // 当前角色与用户
  WOMS.role = "admin";       // "admin" | "assignee"
  WOMS.currentUser = "系统管理员";

  function nowISO() { return new Date().toISOString(); }
  function pad(n) { return n < 10 ? "0" + n : "" + n; }
  function pad3(n) { n = "" + n; while (n.length < 3) n = "0" + n; return n; }

  function genCode(existing) {
    var d = new Date();
    var prefix = "WO" + d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate());
    var max = 0;
    (existing || []).forEach(function (t) {
      if (t.code && t.code.indexOf(prefix + "-") === 0) {
        var n = parseInt(t.code.slice(prefix.length + 1), 10);
        if (!isNaN(n) && n > max) max = n;
      }
    });
    return prefix + "-" + pad3(max + 1);
  }

  function addHistory(t, action, from, to, note, operator) {
    t.history = t.history || [];
    t.history.unshift({
      time: nowISO(),
      operator: operator || WOMS.currentUser,
      action: action,
      from: from || "",
      to: to || "",
      note: note || ""
    });
  }

  function buildSeed() {
    var tickets = [];
    var seq = 0;
    function mk(o) {
      seq++;
      var code = "WO20260731-" + pad3(seq);
      var t = {
        id: "seed-" + seq,
        code: code,
        type: o.type, status: o.status, priority: o.priority,
        customerAccount: o.acc, assignee: o.asg || "", grid: o.grid,
        address: o.addr, ticketDate: o.date, description: o.desc, contact: o.tel,
        creator: o.creator || "系统管理员",
        createdAt: o.date + "T09:00:00.000Z",
        updatedAt: o.updateTime || (o.date + "T09:00:00.000Z"),
        history: []
      };
      t.history.push({ time: o.date + "T09:00:00.000Z", operator: o.creator || "系统管理员", action: "创建", from: "", to: o.status, note: "工单创建" });
      if (o.flow) {
        o.flow.forEach(function (f) {
          t.history.unshift({ time: f.time, operator: f.op, action: "状态变更", from: f.from, to: f.to, note: f.note });
        });
      }
      tickets.push(t);
      return t;
    }
    mk({ type: "故障报修", status: "待分配", priority: "高", acc: "KH00128", grid: "城东网格", addr: "城东区幸福路88号", date: "2026-07-31", desc: "用户家中宽带无法上网，指示灯红灯闪烁", tel: "13800001234" });
    mk({ type: "投诉建议", status: "待分配", priority: "中", acc: "KH00211", grid: "城西网格", addr: "城西区和平街12栋", date: "2026-07-31", desc: "用户投诉安装人员上门迟到", tel: "13900002222" });
    mk({ type: "安装开通", status: "处理中", priority: "中", acc: "KH00345", asg: "张伟", grid: "城南网格", addr: "城南科技园B栋501", date: "2026-07-30", desc: "新装千兆宽带及IPTV", tel: "13700003333", flow: [{ time: "2026-07-30T10:00:00.000Z", op: "系统管理员", from: "待分配", to: "处理中", note: "分配给张伟处理" }] });
    mk({ type: "故障报修", status: "处理中", priority: "高", acc: "KH00456", asg: "李娜", grid: "城北网格", addr: "城北大道218号", date: "2026-07-30", desc: "IPTV频繁卡顿，已重启未解决", tel: "13600004444", flow: [{ time: "2026-07-30T11:00:00.000Z", op: "系统管理员", from: "待分配", to: "处理中", note: "分配给李娜处理" }] });
    mk({ type: "日常巡检", status: "处理中", priority: "低", acc: "KH00567", asg: "王强", grid: "中心网格", addr: "中心机房3号", date: "2026-07-29", desc: "季度机房设备巡检", tel: "13500005555", flow: [{ time: "2026-07-29T09:30:00.000Z", op: "系统管理员", from: "待分配", to: "处理中", note: "分配给王强处理" }] });
    mk({ type: "故障报修", status: "已完成", priority: "高", acc: "KH00678", asg: "张伟", grid: "城东网格", addr: "城东区光明路1号", date: "2026-07-28", desc: "光纤断裂已修复", tel: "13800006666", updateTime: "2026-07-28T15:00:00.000Z", flow: [{ time: "2026-07-28T10:00:00.000Z", op: "系统管理员", from: "待分配", to: "处理中", note: "分配给张伟" }, { time: "2026-07-28T15:00:00.000Z", op: "张伟", from: "处理中", to: "已完成", note: "现场重新熔接光纤，测试正常" }] });
    mk({ type: "安装开通", status: "已完成", priority: "中", acc: "KH00789", asg: "刘洋", grid: "城西网格", addr: "城西区花园小区5栋", date: "2026-07-27", desc: "宽带新装完成", tel: "13900007777", updateTime: "2026-07-27T16:00:00.000Z", flow: [{ time: "2026-07-27T10:00:00.000Z", op: "系统管理员", from: "待分配", to: "处理中", note: "分配给刘洋" }, { time: "2026-07-27T16:00:00.000Z", op: "刘洋", from: "处理中", to: "已完成", note: "完成光猫配置与测速，达标" }] });
    mk({ type: "投诉建议", status: "已驳回", priority: "低", acc: "KH00890", asg: "陈静", grid: "城南网格", addr: "城南商贸城", date: "2026-07-26", desc: "投诉资费问题", tel: "13700008888", updateTime: "2026-07-26T17:00:00.000Z", flow: [{ time: "2026-07-26T10:00:00.000Z", op: "系统管理员", from: "待分配", to: "处理中", note: "分配给陈静" }, { time: "2026-07-26T17:00:00.000Z", op: "陈静", from: "处理中", to: "已驳回", note: "经核实资费无误，已向用户解释" }] });
    mk({ type: "故障报修", status: "已驳回", priority: "中", acc: "KH00901", asg: "李娜", grid: "城北网格", addr: "城北新村", date: "2026-07-25", desc: "疑似伪故障", tel: "13600009999", updateTime: "2026-07-25T18:00:00.000Z", flow: [{ time: "2026-07-25T10:00:00.000Z", op: "系统管理员", from: "待分配", to: "处理中", note: "分配给李娜" }, { time: "2026-07-25T18:00:00.000Z", op: "李娜", from: "处理中", to: "已驳回", note: "多次联系用户无人接听，无法核实" }] });
    mk({ type: "日常巡检", status: "已关闭", priority: "低", acc: "KH00102", asg: "王强", grid: "中心网格", addr: "中心机房1号", date: "2026-07-20", desc: "月度巡检归档", tel: "13500001010", updateTime: "2026-07-21T09:00:00.000Z", flow: [{ time: "2026-07-20T10:00:00.000Z", op: "系统管理员", from: "待分配", to: "处理中", note: "分配给王强" }, { time: "2026-07-20T14:00:00.000Z", op: "王强", from: "处理中", to: "已完成", note: "巡检完成，设备正常" }, { time: "2026-07-21T09:00:00.000Z", op: "系统管理员", from: "已完成", to: "已关闭", note: "归档" }] });
    mk({ type: "其他", status: "已关闭", priority: "低", acc: "KH00113", asg: "张伟", grid: "城东网格", addr: "城东区", date: "2026-07-18", desc: "咨询业务已解答", tel: "13800011111", updateTime: "2026-07-19T09:00:00.000Z", flow: [{ time: "2026-07-18T10:00:00.000Z", op: "系统管理员", from: "待分配", to: "处理中", note: "分配给张伟" }, { time: "2026-07-18T11:00:00.000Z", op: "张伟", from: "处理中", to: "已完成", note: "已解答用户咨询" }, { time: "2026-07-19T09:00:00.000Z", op: "系统管理员", from: "已完成", to: "已关闭", note: "归档" }] });
    mk({ type: "故障报修", status: "处理中", priority: "高", acc: "KH00124", asg: "刘洋", grid: "城南网格", addr: "城南高新路9号", date: "2026-07-31", desc: "企业专线丢包", tel: "13700012222", flow: [{ time: "2026-07-31T08:30:00.000Z", op: "系统管理员", from: "待分配", to: "处理中", note: "分配给刘洋处理" }] });
    return { tickets: tickets, recycle: [] };
  }

  function load() {
    try {
      var raw = localStorage.getItem(WOMS.STORAGE_KEY);
      if (raw) {
        var parsed = JSON.parse(raw);
        if (parsed && parsed.tickets) {
          if (!parsed.recycle) parsed.recycle = [];
          return parsed;
        }
      }
    } catch (e) {}
    var seed = buildSeed();
    save(seed);
    return seed;
  }

  function save(data) {
    try {
      // 记录最近一次本地改动时间，配合 sync.js 的 markSynced()/loadRemote() 避免把未同步改动冲掉
      data.__lastChangeAt = new Date().toISOString();
      localStorage.setItem(WOMS.STORAGE_KEY, JSON.stringify(data));
    } catch (e) {}
  }

  function reset() {
    var seed = buildSeed();
    save(seed);
    return seed;
  }

  function getTicket(data, id) {
    for (var i = 0; i < data.tickets.length; i++) {
      if (data.tickets[i].id === id) return data.tickets[i];
    }
    return null;
  }

  function createTicket(data, fields, operator) {
    var code = genCode(data.tickets);
    var now = nowISO();
    var t = {
      id: "t" + Date.now() + Math.floor(Math.random() * 1000),
      code: code,
      type: fields.type,
      status: fields.status || "待分配",
      priority: fields.priority,
      customerAccount: fields.customerAccount,
      assignee: fields.assignee || "",
      grid: fields.grid,
      address: fields.address,
      ticketDate: fields.ticketDate || now.slice(0, 10),
      description: fields.description,
      contact: fields.contact || "",
      creator: operator || WOMS.currentUser,
      createdAt: now,
      updatedAt: now,
      history: []
    };
    addHistory(t, "创建", "", t.status, "工单创建", operator);
    data.tickets.unshift(t);
    save(data);
    return t;
  }

  function updateFields(data, id, patch, note, operator) {
    var t = getTicket(data, id);
    if (!t) return null;
    var changes = [];
    Object.keys(patch).forEach(function (k) {
      if (patch[k] !== t[k]) {
        changes.push({ field: k, from: t[k], to: patch[k] });
        t[k] = patch[k];
      }
    });
    t.updatedAt = nowISO();
    if (changes.length) {
      var desc = changes.map(function (c) {
        return c.field + ": " + (c.from || "空") + " → " + (c.to || "空");
      }).join("；");
      addHistory(t, "编辑", "", "", note || desc, operator);
    }
    save(data);
    return t;
  }

  function changeStatus(data, id, to, note, operator) {
    var t = getTicket(data, id);
    if (!t) return { ok: false, msg: "工单不存在" };
    var from = t.status;
    var allowed = WOMS.TRANSITIONS[from] || [];
    if (allowed.indexOf(to) < 0) {
      return { ok: false, msg: "非法状态流转：" + from + " → " + to };
    }
    if ((to === "已完成" || to === "已驳回") && !note) {
      return { ok: false, msg: "该操作必须填写备注" };
    }
    t.status = to;
    t.updatedAt = nowISO();
    addHistory(t, "状态变更", from, to, note || "", operator);
    save(data);
    return { ok: true, ticket: t };
  }

  function deleteTicket(data, id, operator) {
    var t = getTicket(data, id);
    if (!t) return false;
    data.tickets = data.tickets.filter(function (x) { return x.id !== id; });
    data.recycle = data.recycle || [];
    t.deletedAt = nowISO();
    t.deletedBy = operator || WOMS.currentUser;
    data.recycle.unshift(t);
    save(data);
    return true;
  }
  function getRecycle(data, id) {
    data.recycle = data.recycle || [];
    for (var i = 0; i < data.recycle.length; i++) {
      if (data.recycle[i].id === id) return data.recycle[i];
    }
    return null;
  }
  function restoreTicket(data, id, operator) {
    var t = getRecycle(data, id);
    if (!t) return false;
    data.recycle = data.recycle.filter(function (x) { return x.id !== id; });
    delete t.deletedAt; delete t.deletedBy;
    t.updatedAt = nowISO();
    addHistory(t, "恢复", "", "", "从回收站恢复", operator);
    data.tickets.unshift(t);
    save(data);
    return true;
  }
  function purgeTicket(data, id, operator) {
    data.recycle = data.recycle || [];
    var before = data.recycle.length;
    data.recycle = data.recycle.filter(function (x) { return x.id !== id; });
    if (data.recycle.length !== before) { save(data); return true; }
    return false;
  }
  function emptyRecycle(data) {
    data.recycle = [];
    save(data);
    return true;
  }

  WOMS.data = {
    load: load,
    save: save,
    reset: reset,
    getTicket: getTicket,
    createTicket: createTicket,
    updateFields: updateFields,
    changeStatus: changeStatus,
    deleteTicket: deleteTicket,
    addHistory: addHistory,
    genCode: genCode,
    getRecycle: getRecycle,
    restoreTicket: restoreTicket,
    purgeTicket: purgeTicket,
    emptyRecycle: emptyRecycle
  };

  // ---------- CSV 导入导出 ----------
  var CSV_FIELDS = ["type", "status", "priority", "customerAccount", "assignee", "grid", "address", "ticketDate", "description", "contact", "creator"];
  var CSV_HEADERS = ["类型", "状态", "优先级", "客户账号", "归属处理人", "所属网格", "服务地址", "工单日期", "问题详情", "客户联系方式", "创建人"];
  function csvEscape(v) {
    v = v === undefined || v === null ? "" : String(v);
    if (/[",\n\r]/.test(v)) return '"' + v.replace(/"/g, '""') + '"';
    return v;
  }
  function ticketsToCsv(tickets) {
    var lines = [CSV_HEADERS.join(",")];
    tickets.forEach(function (t) {
      lines.push(CSV_FIELDS.map(function (f) { return csvEscape(t[f]); }).join(","));
    });
    return "\uFEFF" + lines.join("\r\n");
  }
  function parseCsv(text) {
    if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
    var rows = [];
    var row = [], field = "", inQuotes = false;
    for (var i = 0; i < text.length; i++) {
      var c = text[i];
      if (inQuotes) {
        if (c === '"') {
          if (text[i + 1] === '"') { field += '"'; i++; }
          else inQuotes = false;
        } else field += c;
      } else {
        if (c === '"') inQuotes = true;
        else if (c === ",") { row.push(field); field = ""; }
        else if (c === "\r") { /* skip */ }
        else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
        else field += c;
      }
    }
    if (field !== "" || row.length) { row.push(field); rows.push(row); }
    return rows;
  }
  function csvToTickets(text) {
    var rows = parseCsv(text);
    if (!rows.length) return { ok: false, msg: "CSV 为空" };
    var header = rows[0].map(function (h) { return String(h).trim(); });
    var useOrder = (header.join("|") === CSV_HEADERS.join("|"));
    var idx = {};
    CSV_FIELDS.forEach(function (f, i) { idx[f] = header.indexOf(CSV_HEADERS[i]); });
    var imported = [], failed = 0;
    var enumType = {}, enumStatus = {}, enumPri = {}, enumGrid = {};
    WOMS.ENUMS.types.forEach(function (v) { enumType[v] = 1; });
    WOMS.ENUMS.statuses.forEach(function (v) { enumStatus[v] = 1; });
    WOMS.ENUMS.priorities.forEach(function (v) { enumPri[v] = 1; });
    WOMS.ENUMS.grids.forEach(function (v) { enumGrid[v] = 1; });
    function get(f, cells) {
      if (useOrder) { var i = CSV_FIELDS.indexOf(f); return (cells[i] || "").trim(); }
      var ci = idx[f]; return ci >= 0 ? (cells[ci] || "").trim() : "";
    }
    for (var r = 1; r < rows.length; r++) {
      var cells = rows[r];
      if (cells.length === 1 && cells[0] === "") continue;
      var type = get("type", cells), status = get("status", cells), priority = get("priority", cells);
      var acc = get("customerAccount", cells), grid = get("grid", cells);
      if (!type || !enumType[type]) { failed++; continue; }
      if (status && !enumStatus[status]) { failed++; continue; }
      if (priority && !enumPri[priority]) { failed++; continue; }
      if (grid && !enumGrid[grid]) { failed++; continue; }
      imported.push({
        type: type,
        status: status || "待分配",
        priority: priority || "中",
        customerAccount: acc,
        assignee: get("assignee", cells),
        grid: grid || WOMS.ENUMS.grids[0],
        address: get("address", cells),
        ticketDate: get("ticketDate", cells) || nowISO().slice(0, 10),
        description: get("description", cells),
        contact: get("contact", cells),
        creator: get("creator", cells) || "导入"
      });
    }
    return { ok: true, imported: imported, failed: failed };
  }
  WOMS.csv = { fields: CSV_FIELDS, headers: CSV_HEADERS, export: ticketsToCsv, parse: csvToTickets };
})();