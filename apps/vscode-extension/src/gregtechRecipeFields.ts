import { gregtechOperationControls } from './gregtechOperationControls.js';

/** GTCEu controls use typed form rows; generated scripts stay in the native editor. */
export function gregtechAdvancedHtml(extra = ''): string {
  return `<details id="gtAdvanced" class="advanced-settings">
    <summary>Advanced GTCEu</summary>
    <div class="field-row">
      <select id="gtCleanroom" aria-label="Cleanroom"><option value="">No cleanroom</option><option value="cleanroom">Cleanroom</option><option value="sterile_cleanroom">Sterile cleanroom</option></select>
      <input id="gtBlastTemp" type="number" min="1" step="1" placeholder="Temperature K" aria-label="Blast furnace temperature in kelvin">
      <input id="gtResearchId" type="text" placeholder="Research ID" aria-label="Research ID">
    </div>
    ${extra}
    <div id="gtOperationRows"></div>
    <div class="field-row"><select id="gtOperationType" aria-label="GTCEu operation"></select><button id="gtAddOperation" type="button" title="Add operation" aria-label="Add GTCEu operation">+</button></div>
  </details>`;
}

export function gregtechAdvancedScript(): string {
  return `
    const gtControls = ${JSON.stringify(gregtechOperationControls).replaceAll('<', '\\u003c')};
    const gtRows = document.getElementById('gtOperationRows');
    const gtType = document.getElementById('gtOperationType');
    for (const group of [...new Set(gtControls.map(control => control.group))]) {
      const optgroup = document.createElement('optgroup'); optgroup.label = group;
      for (const control of gtControls.filter(control => control.group === group)) {
        const option = document.createElement('option'); option.value = control.op; option.textContent = control.label; optgroup.append(option);
      }
      gtType.append(optgroup);
    }
    function appendGtOperation(operation) {
      const control = gtControls.find(control => control.op === operation.op);
      const row = document.createElement('div'); row.className = 'gt-operation'; row.dataset.op = control.op;
      const head = document.createElement('div'); head.className = 'section-head';
      const title = document.createElement('span'); title.textContent = control.label; head.append(title);
      const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = '×'; remove.title = 'Remove operation'; remove.setAttribute('aria-label', 'Remove ' + control.label); remove.addEventListener('click', () => { row.remove(); preview(); }); head.append(remove); row.append(head);
      const fields = document.createElement('div'); fields.className = 'gt-operation-fields';
      for (const field of control.fields) {
        const label = document.createElement('label'); label.textContent = field.label;
        const input = document.createElement(field.type === 'boolean' ? 'select' : field.type === 'lines' ? 'textarea' : 'input');
        input.dataset.gtField = field.key; input.dataset.gtKind = field.type; input.setAttribute('aria-label', control.label + ': ' + field.label);
        if (field.type === 'boolean') {
          for (const [value, text] of [['', 'Default'], ['true', 'Yes'], ['false', 'No']]) { if (value || !field.required) { const option = document.createElement('option'); option.value = value; option.textContent = text; input.append(option); } }
        } else if (field.type === 'number') { input.type = 'number'; input.step = 'any'; }
        else if (field.type === 'lines') input.rows = 2;
        else { input.type = 'text'; input.spellcheck = false; }
        const value = operation[field.key]; input.value = value === undefined ? '' : Array.isArray(value) ? value.join('\\n') : String(value);
        label.append(input); fields.append(label);
      }
      row.append(fields); gtRows.append(row);
    }
    document.getElementById('gtAddOperation').addEventListener('click', () => {
      if (gtRows.children.length >= 128) return;
      appendGtOperation(gtControls.find(control => control.op === gtType.value).example); preview();
    });
    function gregtechAdvancedDraft() {
      const cleanroom = document.getElementById('gtCleanroom').value || null;
      const temp = document.getElementById('gtBlastTemp').value.trim();
      const researchWithoutRecipe = document.getElementById('gtResearchId').value.trim() || null;
      const operations = [...gtRows.children].map(row => {
        const operation = { op: row.dataset.op };
        for (const input of row.querySelectorAll('[data-gt-field]')) {
          const value = input.value.trim(); if (!value) continue;
          operation[input.dataset.gtField] = input.dataset.gtKind === 'number' ? Number(value) : input.dataset.gtKind === 'boolean' ? value === 'true' : input.dataset.gtKind === 'lines' ? value.split('\\n').map(value => value.trim()).filter(Boolean) : value;
        }
        return operation;
      });
      return { cleanroom, blastFurnaceTemp: temp ? Number(temp) : null, researchWithoutRecipe, operations };
    }
  `;
}
