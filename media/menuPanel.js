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
    c.appendChild(button({ command: card.primary.command, args: card.primary.args, label: "▶ " + card.primary.label }, "action primary big"));
    if (card.secondary.length) {
      const secondaryRow = el("div", "secondary-row");
      for (const action of card.secondary) {
        secondaryRow.appendChild(button(action, "action"));
      }
      c.appendChild(secondaryRow);
    }
    if (card.status) {
      const status = el("div", "statusline");
      status.appendChild(statusIcon(card.status.icon === "ok" ? "success" : card.status.icon === "running" ? "running" : "error"));
      status.appendChild(el("span", null, card.status.text));
      c.appendChild(status);
    }
    return c;
  }

  function renderRegistrations(card) {
    const c = el("section", "card");
    const row = el("div", "head");
    row.appendChild(el("h3", "inline", "Form Registrations"));
    row.appendChild(el("span", "grow"));
    row.appendChild(button({ command: card.add.command, args: card.add.args, label: "＋ " + card.add.label }, "iconbtn text"));
    c.appendChild(row);
    if (card.rows.length === 0) {
      c.appendChild(el("p", "status", "No form registrations yet."));
    } else {
      const list = el("ul", "feed");
      for (const registration of card.rows) {
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
    if (card.note) {
      c.appendChild(el("div", "small", card.note));
    }
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
    ["registrations", renderRegistrations],
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
    return f;
  }

  window.addEventListener("message", function (event) {
    const message = event.data;
    if (!message || message.type !== "model") {
      return;
    }
    closeOverflow();
    root.replaceChildren();
    for (const card of message.model.cards) {
      const renderer = renderers.get(card.kind);
      if (typeof renderer === "function") {
        const node = renderer(card);
        node.dataset.cardId = card.id;
        root.appendChild(node);
      }
    }
    root.appendChild(renderFooter(message.model.footer));
  });

  vscode.postMessage({ type: "ready" });
})();
