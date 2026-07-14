// Actions panel renderer (#100 v2). Dumb by design: the extension host computes
// the card model (src/panel/menuModel.ts) and posts it here; this script only
// builds DOM (textContent, never innerHTML) and posts clicks back.
(function () {
  "use strict";
  const vscode = acquireVsCodeApi();
  const root = document.getElementById("root");
  let openMenu = null;

  function execute(action) {
    vscode.postMessage({ type: "execute", command: action.command, args: action.args || [] });
  }

  function closeOverflow() {
    if (openMenu) {
      openMenu.remove();
      openMenu = null;
    }
  }

  document.addEventListener("click", function (event) {
    if (openMenu && !openMenu.contains(event.target)) {
      closeOverflow();
    }
  });
  document.addEventListener("keydown", function (event) {
    if (event.key === "Escape") {
      closeOverflow();
    }
  });

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) {
      node.className = className;
    }
    if (text !== undefined) {
      node.textContent = text;
    }
    return node;
  }

  function button(action, className) {
    const b = el("button", className, action.label);
    b.type = "button";
    b.addEventListener("click", function () {
      closeOverflow();
      execute(action);
    });
    return b;
  }

  /** ⋯ button opening a popup menu of rare actions. */
  function overflowButton(actions, ownerLabel) {
    const b = el("button", "iconbtn", "⋯");
    b.type = "button";
    b.setAttribute("aria-haspopup", "menu");
    b.setAttribute("aria-label", "More actions for " + ownerLabel);
    b.addEventListener("click", function (event) {
      event.stopPropagation();
      if (openMenu) {
        closeOverflow();
        return;
      }
      const menu = el("div", "overflow-menu");
      menu.setAttribute("role", "menu");
      for (const action of actions) {
        const item = button(action, "menu-item");
        item.setAttribute("role", "menuitem");
        menu.appendChild(item);
      }
      b.parentElement.appendChild(menu);
      openMenu = menu;
      const first = menu.querySelector("button");
      if (first) {
        first.focus();
      }
    });
    return b;
  }

  function statusIcon(status) {
    const span = el("span", "st st-" + status, status === "running" ? "⟳" : status === "error" ? "✗" : "✓");
    span.setAttribute("aria-label", status);
    return span;
  }

  function renderNotice(card) {
    const c = el("section", "card");
    if (card.spinner) {
      const row = el("p", "status spinner-row");
      const spinner = el("span", "spinner");
      spinner.setAttribute("aria-hidden", "true");
      row.appendChild(spinner);
      row.appendChild(el("span", null, card.text));
      c.appendChild(row);
    } else {
      c.appendChild(el("p", "status", card.text));
    }
    return c;
  }

  function renderActions(card) {
    const c = el("section", "card slim");
    card.actions.forEach(function (action) {
      c.appendChild(button(action, "action"));
    });
    return c;
  }

  function renderGetStarted(card) {
    const c = el("section", "card");
    c.appendChild(el("h3", null, "Get Started"));
    c.appendChild(el("p", "status", card.text));
    card.actions.forEach(function (action, index) {
      c.appendChild(button(action, index === 0 ? "action primary" : "action"));
    });
    return c;
  }

  function renderRequirements(card) {
    const c = el("section", "card");
    c.appendChild(el("h3", null, "System Requirements"));
    if (card.scanning) {
      c.appendChild(el("p", "status", "Scanning tools and globals..."));
    }
    const list = el("ul", "requirements");
    for (const row of card.rows) {
      const li = el("li");
      const state = el("span", "req-state " + (row.ok === undefined ? "pending" : row.ok ? "ok" : "missing"), row.ok === undefined ? "…" : row.ok ? "✓" : "✗");
      state.setAttribute("aria-label", row.ok === undefined ? "checking" : row.ok ? "installed" : "missing");
      li.appendChild(state);
      li.appendChild(el("span", "req-label", row.label));
      if (row.ok === false) {
        const link = el("a", "download", "Download");
        link.href = "#";
        link.setAttribute("role", "button");
        link.setAttribute("aria-label", "Download " + row.label);
        link.addEventListener("click", function (event) {
          event.preventDefault();
          vscode.postMessage({ type: "openExternal", url: row.downloadUrl });
        });
        li.appendChild(link);
      }
      list.appendChild(li);
    }
    c.appendChild(list);
    if (card.recheck) {
      c.appendChild(button(card.recheck, "action"));
    }
    return c;
  }

  function renderEnvironment(card) {
    const c = el("section", "card");
    const row = el("div", "head");
    const dot = el("span", "dot " + (card.connected ? "on" : "off"));
    dot.setAttribute("aria-label", card.connected ? "connected" : "not connected");
    row.appendChild(dot);
    row.appendChild(el("span", "title", card.name));
    if (card.label) {
      row.appendChild(el("span", "badge env", card.label.toUpperCase()));
    }
    row.appendChild(el("span", "grow"));
    row.appendChild(button(card.switchAction, "iconbtn text"));
    const anchor = el("span", "menu-anchor");
    anchor.appendChild(overflowButton(card.overflow, "environment"));
    row.appendChild(anchor);
    c.appendChild(row);
    c.appendChild(el("div", "small", card.url + " · " + card.authLabel));
    return c;
  }

  function renderProject(card) {
    const c = el("section", "card");
    const row = el("div", "head");
    // Minimise/expand toggle (#156) — only sub-component cards (dndId set) collapse.
    if (card.dndId) {
      const caret = el("button", "iconbtn caret");
      caret.type = "button";
      caret.textContent = card.collapsed ? "▸" : "▾";
      caret.setAttribute("aria-label", (card.collapsed ? "Expand" : "Collapse") + " " + card.name);
      caret.addEventListener("click", function () {
        toggleCardCollapse(card.dndId);
      });
      row.appendChild(caret);
    }
    row.appendChild(el("span", "title", card.name));
    row.appendChild(el("span", "badge type", card.typeLabel));
    row.appendChild(el("span", "grow"));
    if (card.overflow.length) {
      const anchor = el("span", "menu-anchor");
      anchor.appendChild(overflowButton(card.overflow, card.name));
      row.appendChild(anchor);
    }
    c.appendChild(row);
    if (card.detail) {
      c.appendChild(el("div", "small", card.detail));
    }
    // Collapsed cards show just name/type/detail/status — hide the action rows (#156).
    if (!card.collapsed) {
      c.appendChild(button({ command: card.primary.command, args: card.primary.args, label: "▶ " + card.primary.label }, "action primary big"));
      if (card.secondary.length) {
        const secondaryRow = el("div", "secondary-row");
        for (const action of card.secondary) {
          secondaryRow.appendChild(button(action, "action"));
        }
        c.appendChild(secondaryRow);
      }
      // Web-resource cards embed their own Form Registrations, right under the buttons.
      if (card.registrations) {
        c.appendChild(registrationsBlock(card.registrations));
      }
      // Plugin cards embed the profiler/debugging workflow.
      if (card.debugging) {
        c.appendChild(debuggingBlock(card.debugging));
      }
    }
    if (card.status) {
      const status = el("div", "statusline");
      status.appendChild(statusIcon(card.status.icon === "ok" ? "success" : card.status.icon === "running" ? "running" : "error"));
      status.appendChild(el("span", null, card.status.text));
      c.appendChild(status);
    }
    // Drag to reorder / group (#118). Only sub-component cards (dndId set) are draggable.
    if (card.dndId) {
      c.draggable = true;
      c.dataset.dndid = card.dndId;
      c.classList.add("draggable");
      c.addEventListener("dragstart", onCardDragStart);
      c.addEventListener("dragover", onCardDragOver);
      c.addEventListener("dragleave", onCardDragLeave);
      c.addEventListener("drop", onCardDrop);
      c.addEventListener("dragend", onDragEnd);
    }
    return c;
  }

  // --- drag-and-drop layout (#118) ---
  let dragId = null;
  let lastCards = [];
  let lastMultiComponent = false;

  // Reconstruct the full layout from the rendered cards. collapsedCards (#156) is the set
  // of cards whose collapse DIFFERS from the workspace default (multiComponent) — derived
  // from each card's rendered `collapsed`, so it round-trips through a re-render.
  function deriveLayout(cards) {
    const order = [];
    const groups = [];
    const collapsedCards = [];
    function noteCollapse(p) {
      if (p.dndId && !!p.collapsed !== lastMultiComponent) {
        collapsedCards.push(p.dndId);
      }
    }
    for (const card of cards) {
      if (card.kind === "project" && card.dndId) {
        order.push(card.dndId);
        noteCollapse(card);
      } else if (card.kind === "group") {
        const members = card.projects.filter((p) => p.dndId).map((p) => p.dndId);
        order.push.apply(order, members);
        groups.push({ name: card.name, members: members, collapsed: card.collapsed });
        card.projects.forEach(noteCollapse);
      }
    }
    return { order: order, groups: groups, collapsedCards: collapsedCards };
  }

  function moveCard(layout, id, targetId, after) {
    const groups = layout.groups.map(function (g) {
      return { name: g.name, collapsed: g.collapsed, members: g.members.filter((m) => m !== id) };
    });
    const targetGroup = layout.groups.find((g) => g.members.indexOf(targetId) !== -1);
    if (targetGroup) {
      const g = groups.find((x) => x.name === targetGroup.name);
      const ti = g.members.indexOf(targetId);
      g.members.splice(after ? ti + 1 : ti, 0, id);
    }
    const order = layout.order.filter((x) => x !== id);
    const oi = order.indexOf(targetId);
    order.splice(after ? oi + 1 : oi, 0, id);
    return { order: order, groups: groups.filter((g) => g.members.length), collapsedCards: layout.collapsedCards };
  }

  function addToGroup(layout, id, groupName) {
    const groups = layout.groups.map(function (g) {
      return { name: g.name, collapsed: g.collapsed, members: g.members.filter((m) => m !== id) };
    });
    const g = groups.find((x) => x.name === groupName);
    if (!g) {
      return layout;
    }
    const order = layout.order.filter((x) => x !== id);
    let lastIdx = -1;
    g.members.forEach(function (m) {
      lastIdx = Math.max(lastIdx, order.indexOf(m));
    });
    order.splice(lastIdx + 1, 0, id);
    g.members.push(id);
    return { order: order, groups: groups, collapsedCards: layout.collapsedCards };
  }

  // Toggle a card's minimise state (#156): flip its membership in collapsedCards (the
  // override set), which flips its rendered `collapsed` on the next model.
  function toggleCardCollapse(dndId) {
    const layout = deriveLayout(lastCards);
    const i = layout.collapsedCards.indexOf(dndId);
    if (i === -1) {
      layout.collapsedCards.push(dndId);
    } else {
      layout.collapsedCards.splice(i, 1);
    }
    sendLayout(layout);
  }

  function sendLayout(layout) {
    vscode.postMessage({ type: "updateLayout", layout: layout });
  }

  function clearDropHints() {
    const nodes = document.querySelectorAll(".drop-before,.drop-after,.drop-into");
    for (const n of nodes) {
      n.classList.remove("drop-before", "drop-after", "drop-into");
    }
  }

  function onCardDragStart(e) {
    dragId = this.dataset.dndid;
    e.dataTransfer.effectAllowed = "move";
    this.classList.add("dragging");
  }
  function onDragEnd() {
    dragId = null;
    clearDropHints();
    const dn = document.querySelector(".dragging");
    if (dn) {
      dn.classList.remove("dragging");
    }
  }
  function onCardDragOver(e) {
    if (!dragId || dragId === this.dataset.dndid) {
      return;
    }
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    const after = e.offsetY > this.offsetHeight / 2;
    this.classList.toggle("drop-after", after);
    this.classList.toggle("drop-before", !after);
  }
  function onCardDragLeave() {
    this.classList.remove("drop-before", "drop-after");
  }
  function onCardDrop(e) {
    e.preventDefault();
    e.stopPropagation();
    const target = this.dataset.dndid;
    this.classList.remove("drop-before", "drop-after");
    if (!dragId || dragId === target) {
      return;
    }
    const after = e.offsetY > this.offsetHeight / 2;
    sendLayout(moveCard(deriveLayout(lastCards), dragId, target, after));
  }

  function renderGroup(card) {
    const c = el("section", "group");
    c.dataset.group = card.name;
    const head = el("div", "group-head");
    const caret = el("button", "iconbtn caret");
    caret.type = "button";
    caret.textContent = card.collapsed ? "▸" : "▾";
    caret.setAttribute("aria-label", (card.collapsed ? "Expand" : "Collapse") + " group " + card.name);
    caret.addEventListener("click", function () {
      const layout = deriveLayout(lastCards);
      const g = layout.groups.find((x) => x.name === card.name);
      if (g) {
        g.collapsed = !g.collapsed;
      }
      sendLayout(layout);
    });
    head.appendChild(caret);
    head.appendChild(el("span", "group-name grow-text", card.name));
    head.appendChild(el("span", "small", card.projects.length + ""));
    // Ungroup (#156): dissolve the group; members fall back to the ungrouped list in order
    // (deriveLayout already keeps them in `order`, so dropping the group entry is enough).
    const ungroup = el("button", "iconbtn");
    ungroup.type = "button";
    ungroup.textContent = "⊗";
    ungroup.title = "Ungroup";
    ungroup.setAttribute("aria-label", "Ungroup " + card.name);
    ungroup.addEventListener("click", function () {
      const layout = deriveLayout(lastCards);
      layout.groups = layout.groups.filter((g) => g.name !== card.name);
      sendLayout(layout);
    });
    head.appendChild(ungroup);
    // Header is a drop target: dropping a card here adds it to the group.
    head.addEventListener("dragover", function (e) {
      if (dragId) {
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        c.classList.add("drop-into");
      }
    });
    head.addEventListener("dragleave", function () {
      c.classList.remove("drop-into");
    });
    head.addEventListener("drop", function (e) {
      e.preventDefault();
      e.stopPropagation();
      c.classList.remove("drop-into");
      if (dragId) {
        sendLayout(addToGroup(deriveLayout(lastCards), dragId, card.name));
      }
    });
    c.appendChild(head);
    if (!card.collapsed) {
      const body = el("div", "group-body");
      for (const project of card.projects) {
        body.appendChild(renderProject(project));
      }
      c.appendChild(body);
    }
    return c;
  }

  function newGroupZone() {
    const z = el("div", "new-group-zone small", "Drag a project here to start a group");
    z.addEventListener("dragover", function (e) {
      if (dragId) {
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        z.classList.add("drop-into");
      }
    });
    z.addEventListener("dragleave", function () {
      z.classList.remove("drop-into");
    });
    z.addEventListener("drop", function (e) {
      e.preventDefault();
      z.classList.remove("drop-into");
      if (dragId) {
        vscode.postMessage({ type: "newGroupFromDrop", member: dragId });
      }
    });
    return z;
  }

  function registrationsBlock(block) {
    const c = el("div", "registrations");
    const row = el("div", "head");
    row.appendChild(el("h3", "inline", "Form Registrations"));
    row.appendChild(el("span", "grow"));
    row.appendChild(button({ command: block.add.command, args: block.add.args, label: "＋ " + block.add.label }, "iconbtn text"));
    c.appendChild(row);
    if (block.rows.length === 0) {
      c.appendChild(el("p", "status", "No form registrations yet."));
    } else {
      const list = el("ul", "feed");
      for (const registration of block.rows) {
        const li = el("li");
        if (registration.index !== undefined) {
          // Row opens the TS file at the decoration.
          const rowButton = el("button", "rowbtn", "");
          rowButton.type = "button";
          rowButton.setAttribute("aria-label", "Open " + registration.label);
          rowButton.appendChild(el("span", "grow-text", registration.label));
          rowButton.appendChild(el("span", "t", registration.detail));
          rowButton.addEventListener("click", function () {
            vscode.postMessage({ type: "openRegistration", index: registration.index });
          });
          li.appendChild(rowButton);
        } else {
          li.appendChild(el("span", "grow-text", registration.label));
          li.appendChild(el("span", "t", registration.detail));
        }
        list.appendChild(li);
      }
      c.appendChild(list);
    }
    if (block.note) {
      c.appendChild(el("div", "small", block.note));
    }
    return c;
  }

  function debuggingBlock(block) {
    const c = el("div", "debugging");
    const row = el("div", "head");
    row.appendChild(el("h3", "inline", "Debugging"));
    row.appendChild(el("span", "grow"));
    c.appendChild(row);
    const actions = el("div", "secondary-row");
    if (block.captureSupported) {
      actions.appendChild(button(block.capture, "action"));
    } else {
      // Capture (Start Profiling) is a Windows-only net48 tool; disable it elsewhere.
      const disabled = el("button", "action", block.capture.label);
      disabled.type = "button";
      disabled.disabled = true;
      disabled.title = "Profiling capture is Windows-only. Use Download a run, or Replay a downloaded profile file.";
      actions.appendChild(disabled);
    }
    actions.appendChild(button(block.download, "action"));
    actions.appendChild(button(block.replay, "action"));
    c.appendChild(actions);
    var note;
    if (block.downloadedProfiles > 0) {
      note = block.downloadedProfiles + " profile" + (block.downloadedProfiles === 1 ? "" : "s") + " in profiles/ · Replay to debug";
    } else if (block.captureSupported) {
      note = "Profile next run captures a live execution; or Download a run / Replay a profile file, then debug it as a test.";
    } else {
      note = "Download a captured run, or drop a profile file in profiles/ and Replay to debug it as a test.";
    }
    c.appendChild(el("div", "small", note));
    return c;
  }

  function renderSession(card) {
    const c = el("section", "card session");
    const row = el("div", "head");
    row.appendChild(el("span", null, "🐞"));
    const text = el("span", "grow-text", card.text + (card.detail ? " " : ""));
    if (card.detail) {
      text.appendChild(el("span", "small", "(" + card.detail + ")"));
    }
    row.appendChild(text);
    row.appendChild(button(card.stop, "iconbtn text"));
    c.appendChild(row);
    return c;
  }

  function renderActivity(card) {
    const c = el("section", "card");
    c.appendChild(el("h3", null, "Recent"));
    const list = el("ul", "feed");
    for (const item of card.items) {
      const li = el("li");
      li.appendChild(statusIcon(item.status));
      li.appendChild(el("span", "grow-text", item.label + (item.status === "error" && item.detail ? " — " + item.detail : "")));
      li.appendChild(el("span", "t", item.status === "running" ? "…" : item.time));
      list.appendChild(li);
    }
    c.appendChild(list);
    return c;
  }

  // A Map (not a plain object) so card.kind can only ever select one of our
  // renderers — never a prototype member (js/unvalidated-dynamic-method-call).
  const renderers = new Map([
    ["notice", renderNotice],
    ["actions", renderActions],
    ["getStarted", renderGetStarted],
    ["requirements", renderRequirements],
    ["environment", renderEnvironment],
    ["project", renderProject],
    ["group", renderGroup],
    ["session", renderSession],
    ["activity", renderActivity],
  ]);

  function renderFooter(footer) {
    const f = el("footer", "panel-footer");
    if (footer.requirementsOk) {
      f.appendChild(el("span", "st st-success small", "✓ requirements"));
    } else {
      f.appendChild(el("span"));
    }
    f.appendChild(button(footer.log, "linkbtn"));
    // Help & feedback links (#120): Docs · Report an issue.
    if (footer.help && footer.help.length) {
      const help = el("div", "help-links small");
      footer.help.forEach(function (link, i) {
        if (i > 0) {
          help.appendChild(el("span", "sep", " · "));
        }
        const a = el("button", "linkbtn", link.label);
        a.type = "button";
        a.addEventListener("click", function () {
          vscode.postMessage({ type: "openExternal", url: link.url });
        });
        help.appendChild(a);
      });
      f.appendChild(help);
    }
    return f;
  }

  window.addEventListener("message", function (event) {
    const message = event.data;
    if (!message || message.type !== "model") {
      return;
    }
    closeOverflow();
    root.replaceChildren();
    lastCards = message.model.cards;
    lastMultiComponent = !!message.model.multiComponent;
    let draggableCount = 0;
    for (const card of message.model.cards) {
      if ((card.kind === "project" && card.dndId) || card.kind === "group") {
        draggableCount++;
      }
      const renderer = renderers.get(card.kind);
      if (typeof renderer === "function") {
        const node = renderer(card);
        node.dataset.cardId = card.id;
        root.appendChild(node);
      }
    }
    // Offer grouping once there are at least two arrangeable projects.
    if (draggableCount >= 2) {
      root.appendChild(newGroupZone());
    }
    root.appendChild(renderFooter(message.model.footer));
  });

  vscode.postMessage({ type: "ready" });
})();
