// FetchXML Generator webview renderer (#238).
//
// Deliberately dumb: it renders the state the host sends and posts back INTENTS. It holds no query
// model, does no XML parsing, and makes no decisions about what is valid — all of that lives in the
// host's pure modules, where it is unit-tested.
//
// Everything user- or org-supplied is written with textContent, never innerHTML.

(function () {
  const vscode = acquireVsCodeApi();

  const els = {
    title: document.getElementById("title"),
    notice: document.getElementById("notice"),
    tree: document.getElementById("tree"),
    treeActions: document.getElementById("treeActions"),
    properties: document.getElementById("properties"),
    otherAttributes: document.getElementById("otherAttributes"),
    parameters: document.getElementById("parameters"),
    diagnostics: document.getElementById("diagnostics"),
    xml: document.getElementById("xml"),
    xmlError: document.getElementById("xmlError"),
    run: document.getElementById("run"),
    save: document.getElementById("save"),
    copy: document.getElementById("copy"),
    refresh: document.getElementById("refresh"),
  };

  /** True while the user is typing in the XML box, so a re-render doesn't fight the caret. */
  let editingXml = false;
  let state;

  function post(message) {
    vscode.postMessage(message);
  }

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

  function heading(text, badge) {
    const node = el("h3", undefined, text);
    if (badge !== undefined) {
      node.appendChild(el("span", "pill", String(badge)));
    }
    return node;
  }

  // --- tree ---------------------------------------------------------------------------------

  function renderTree() {
    els.tree.replaceChildren();
    for (const row of state.tree) {
      const node = el("div", `row${samePath(row.path, state.selection) ? " selected" : ""}${row.readOnly ? " readonly" : ""}`);
      node.style.paddingLeft = `${8 + row.depth * 16}px`;
      node.setAttribute("role", "treeitem");
      node.appendChild(el("span", "tag", row.tag));
      node.appendChild(el("span", "label", row.label));
      node.addEventListener("click", () => post({ type: "select", path: row.path }));
      els.tree.appendChild(node);
    }
  }

  function renderTreeActions() {
    els.treeActions.replaceChildren();
    for (const tag of state.addable) {
      const button = el("button", undefined, `+ ${tag}`);
      button.disabled = state.readOnly;
      button.addEventListener("click", () => post({ type: "add", path: state.selection, tag }));
      els.treeActions.appendChild(button);
    }
    if (state.canRemove) {
      const remove = el("button", undefined, "Remove");
      remove.disabled = state.readOnly;
      remove.addEventListener("click", () => post({ type: "edit", edit: { kind: "remove", path: state.selection } }));
      els.treeActions.appendChild(remove);

      for (const [label, offset] of [
        ["Move up", -1],
        ["Move down", 1],
      ]) {
        const move = el("button", undefined, label);
        move.disabled = state.readOnly;
        move.addEventListener("click", () => post({ type: "edit", edit: { kind: "move", path: state.selection, offset } }));
        els.treeActions.appendChild(move);
      }
    }
  }

  function samePath(a, b) {
    return a.length === b.length && a.every((value, index) => value === b[index]);
  }

  // --- properties ---------------------------------------------------------------------------

  function optionList(select, values, current, placeholder) {
    if (placeholder !== undefined) {
      const blank = el("option", undefined, placeholder);
      blank.value = "";
      select.appendChild(blank);
    }
    for (const value of values) {
      const option = el("option", undefined, value.label);
      option.value = value.value;
      if (value.value === current) {
        option.selected = true;
      }
      select.appendChild(option);
    }
    // An existing value the picker doesn't offer (a column metadata hasn't loaded, a custom
    // operator) must still be shown, or selecting anything else would silently change it.
    if (current && !values.some((value) => value.value === current)) {
      const extra = el("option", undefined, `${current} (current)`);
      extra.value = current;
      extra.selected = true;
      select.appendChild(extra);
    }
  }

  function fieldRow(field) {
    const { descriptor, value } = field;
    const wrapper = el("div", "field");
    const id = `field-${descriptor.name}`;
    const label = el("label", undefined, descriptor.label);
    label.setAttribute("for", id);
    wrapper.appendChild(label);

    const send = (next) => post({ type: "edit", edit: { kind: "setAttr", path: state.selection, name: descriptor.name, value: next } });

    let input;
    if (descriptor.kind === "boolean") {
      input = el("input");
      input.type = "checkbox";
      input.checked = value === "true" || value === "1";
      input.addEventListener("change", () => send(input.checked ? "true" : ""));
    } else if (descriptor.kind === "select" || descriptor.kind === "entity" || descriptor.kind === "attribute") {
      input = el("select");
      let options = [];
      let placeholder = "(not set)";
      if (descriptor.kind === "entity") {
        options = (state.tables ?? []).map((table) => ({ value: table.logicalName, label: `${table.logicalName} — ${table.displayName}` }));
        placeholder = state.tables ? "(not set)" : "loading tables…";
      } else if (descriptor.kind === "attribute") {
        options = (state.attributes ?? []).map((attribute) => ({ value: attribute.logicalName, label: `${attribute.logicalName} — ${attribute.displayName}` }));
        placeholder = state.attributes ? "(not set)" : "loading columns…";
      } else if (descriptor.name === "operator") {
        // Grouped, so 60 operators stay navigable.
        input.appendChild(Object.assign(document.createElement("option"), { value: "", textContent: "(not set)" }));
        for (const group of state.operatorGroups) {
          const optgroup = document.createElement("optgroup");
          optgroup.label = group.label;
          for (const operator of group.operators) {
            const option = el("option", undefined, operator);
            option.value = operator;
            if (operator === value) {
              option.selected = true;
            }
            optgroup.appendChild(option);
          }
          input.appendChild(optgroup);
        }
        if (value && !state.operatorGroups.some((group) => group.operators.includes(value))) {
          const extra = el("option", undefined, `${value} (current)`);
          extra.value = value;
          extra.selected = true;
          input.appendChild(extra);
        }
        placeholder = undefined;
      } else {
        options = descriptor.options.map((option) => ({ value: option, label: option }));
      }
      if (placeholder !== undefined) {
        optionList(input, options, value, placeholder);
      }
      input.addEventListener("change", () => send(input.value));
    } else {
      input = el("input");
      input.type = descriptor.kind === "number" ? "number" : "text";
      input.value = value;
      // Commit on blur/Enter rather than each keystroke, so the host isn't re-rendering mid-word.
      input.addEventListener("change", () => send(input.value));
      input.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
          send(input.value);
        }
      });
    }
    input.id = id;
    input.disabled = state.readOnly;
    wrapper.appendChild(input);
    return wrapper;
  }

  function renderProperties() {
    els.properties.replaceChildren();
    els.properties.appendChild(heading(state.selectedTag ? `<${state.selectedTag}>` : "Properties"));

    if (state.fields.length === 0) {
      els.properties.appendChild(el("div", "empty", "This element has no editable properties."));
    }
    for (const field of state.fields) {
      els.properties.appendChild(fieldRow(field));
      if (field.descriptor.hint) {
        els.properties.appendChild(el("div", "hint", field.descriptor.hint));
      }
    }

    // A <value> node holds text rather than attributes.
    if (state.selectedTag === "value") {
      const wrapper = el("div", "field");
      const label = el("label", undefined, "Value");
      label.setAttribute("for", "value-text");
      const input = el("input");
      input.type = "text";
      input.id = "value-text";
      input.disabled = state.readOnly;
      const row = state.tree.find((candidate) => samePath(candidate.path, state.selection));
      input.value = row ? row.label : "";
      input.addEventListener("change", () => post({ type: "edit", edit: { kind: "setText", path: state.selection, text: input.value } }));
      wrapper.appendChild(label);
      wrapper.appendChild(input);
      els.properties.appendChild(wrapper);
    }

    els.otherAttributes.replaceChildren();
    if (state.otherAttributes.length > 0) {
      els.otherAttributes.appendChild(heading("Other attributes", state.otherAttributes.length));
      els.otherAttributes.appendChild(el("div", "hint", "Kept exactly as written — edit them in the FetchXML box below."));
      for (const attribute of state.otherAttributes) {
        els.otherAttributes.appendChild(el("div", "other", `${attribute.name} = ${attribute.value}`));
      }
    }
  }

  function renderParameters() {
    els.parameters.replaceChildren();
    if (state.parameters.length === 0) {
      return;
    }
    els.parameters.appendChild(heading("Parameters", state.parameters.length));
    for (const parameter of state.parameters) {
      const wrapper = el("div", "field");
      const id = `param-${parameter.name}`;
      const label = el("label", undefined, `@${parameter.name}`);
      label.setAttribute("for", id);
      label.title = parameter.expression ? `Bound to ${parameter.expression}` : "Typed in the generator";
      const input = el("input");
      input.type = "text";
      input.id = id;
      input.value = parameter.value;
      input.placeholder = parameter.type;
      input.addEventListener("change", () => post({ type: "setParameter", name: parameter.name, value: input.value }));
      wrapper.appendChild(label);
      wrapper.appendChild(input);
      els.parameters.appendChild(wrapper);
      if (parameter.expression) {
        els.parameters.appendChild(el("div", "hint", `Bound to \`${parameter.expression}\` in the code — a test run uses the value above.`));
      }
    }
  }

  function renderDiagnostics() {
    els.diagnostics.replaceChildren();
    if (state.diagnostics.length === 0) {
      return;
    }
    els.diagnostics.appendChild(heading("Issues", state.diagnostics.length));
    for (const diagnostic of state.diagnostics) {
      const row = el("div", `diagnostic ${diagnostic.severity}`);
      row.appendChild(el("span", "severity", diagnostic.severity === "error" ? "✖" : diagnostic.severity === "warning" ? "⚠" : "ℹ"));
      row.appendChild(el("span", "message", diagnostic.message));
      els.diagnostics.appendChild(row);
    }
  }

  function render() {
    els.title.replaceChildren();
    els.title.appendChild(el("span", undefined, state.title));
    els.title.appendChild(el("span", "consumer", state.consumerLabel));
    if (state.dirty) {
      els.title.appendChild(el("span", "dirty", "● unsaved"));
    }

    if (state.readOnly) {
      els.notice.textContent = "This string can't be rewritten safely (a raw string literal), so the generator is read-only. Run and Copy still work.";
      els.notice.hidden = false;
    } else {
      els.notice.hidden = true;
    }

    els.save.disabled = state.readOnly || !state.dirty;

    renderTree();
    renderTreeActions();
    renderProperties();
    renderParameters();
    renderDiagnostics();

    if (!editingXml && els.xml.value !== state.xml) {
      els.xml.value = state.xml;
      els.xmlError.hidden = true;
    }
  }

  // --- wiring -------------------------------------------------------------------------------

  els.run.addEventListener("click", () => post({ type: "run" }));
  els.save.addEventListener("click", () => post({ type: "save" }));
  els.copy.addEventListener("click", () => post({ type: "copyXml" }));
  els.refresh.addEventListener("click", () => post({ type: "refreshMetadata" }));

  els.xml.addEventListener("focus", () => {
    editingXml = true;
  });
  els.xml.addEventListener("blur", () => {
    editingXml = false;
    post({ type: "setXml", xml: els.xml.value });
  });

  window.addEventListener("message", (event) => {
    const message = event.data;
    if (message.type === "state") {
      state = message.state;
      render();
    } else if (message.type === "xmlError") {
      els.xmlError.textContent = message.error;
      els.xmlError.hidden = false;
    }
  });

  post({ type: "ready" });
})();
