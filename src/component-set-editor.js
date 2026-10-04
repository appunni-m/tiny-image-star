const maxVariantNameLength = 80;

function findSet(document, setId) {
  const set = document?.componentSets?.find(item => item.id === setId);
  if (!set) throw new Error('This component set is no longer available.');
  return set;
}

function membersFor(document, set) {
  const members = set.componentIds.map(id => document.components?.find(component => component.id === id));
  if (members.length < 2 || members.some(component => !component || component.componentSetId !== set.id)) {
    throw new Error('This component set has missing or mismatched variants.');
  }
  return members;
}

function normalizedLabel(value, kind) {
  const label = String(value ?? '').trim();
  if (!label || label.length > maxVariantNameLength || /[\x00-\x1f\x7f]/u.test(label)) {
    throw new TypeError(`${kind} must contain 1–${maxVariantNameLength} printable characters.`);
  }
  return label;
}

function axisIndex(set, name) {
  return set.properties.findIndex(property => property.name === name);
}

function variantCombination(component, properties) {
  return JSON.stringify(properties.map(property => component.variantProperties?.[property.name] ?? ''));
}

/** Add a named axis to every variant, then let the editor assign distinct values. */
export function addComponentVariantAxis(document, setId, name, defaultValue = 'Default') {
  const set = findSet(document, setId);
  const members = membersFor(document, set);
  const axisName = normalizedLabel(name, 'Variant property name');
  const value = normalizedLabel(defaultValue, 'Variant value');
  if (set.properties.some(property => property.name.toLocaleLowerCase() === axisName.toLocaleLowerCase())) {
    throw new Error(`A variant property named “${axisName}” already exists.`);
  }
  set.properties.push({ name: axisName, values: [value] });
  for (const component of members) {
    component.variantProperties = { ...component.variantProperties, [axisName]: value };
  }
  return set.properties.at(-1);
}

/** Rename an axis without changing its values or any instance's selected variant. */
export function renameComponentVariantAxis(document, setId, oldName, newName) {
  const set = findSet(document, setId);
  const members = membersFor(document, set);
  const index = axisIndex(set, oldName);
  if (index < 0) throw new Error('This variant property no longer exists.');
  const axisName = normalizedLabel(newName, 'Variant property name');
  if (axisName === oldName) return set.properties[index];
  if (set.properties.some(property => property.name.toLocaleLowerCase() === axisName.toLocaleLowerCase())) {
    throw new Error(`A variant property named “${axisName}” already exists.`);
  }
  const property = set.properties[index];
  const valuesByComponent = members.map(component => {
    const current = component.variantProperties?.[oldName];
    if (typeof current !== 'string' || !current) throw new Error(`Variant “${component.name}” has no value for ${oldName}.`);
    return current;
  });
  for (let memberIndex = 0; memberIndex < members.length; memberIndex += 1) {
    const component = members[memberIndex];
    component.variantProperties = { ...component.variantProperties, [axisName]: valuesByComponent[memberIndex] };
    delete component.variantProperties[oldName];
  }
  property.name = axisName;
  return property;
}

/** Remove an axis only when the remaining axes still uniquely identify variants. */
export function removeComponentVariantAxis(document, setId, name) {
  const set = findSet(document, setId);
  const members = membersFor(document, set);
  const index = axisIndex(set, name);
  if (index < 0) throw new Error('This variant property no longer exists.');
  if (set.properties.length === 1) throw new Error('A component set needs at least one variant property.');
  const remaining = set.properties.filter((_, propertyIndex) => propertyIndex !== index);
  const combinations = members.map(component => variantCombination(component, remaining));
  if (new Set(combinations).size !== combinations.length) {
    throw new Error(`Removing “${name}” would make variants indistinguishable. Change their other property values first.`);
  }
  for (const component of members) {
    component.variantProperties = { ...component.variantProperties };
    delete component.variantProperties[name];
  }
  set.properties.splice(index, 1);
  return true;
}

export function renameComponentSet(document, setId, name) {
  const set = findSet(document, setId);
  const nextName = normalizedLabel(name, 'Component set name');
  set.name = nextName;
  return set.name;
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/gu, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[character]);
}

function variantLabel(component, set) {
  const values = set.properties.map(property => `${property.name}=${component.variantProperties?.[property.name] || 'Default'}`);
  return `${component.name || 'Variant'} · ${values.join(' · ')}`;
}

/** Accessible Assets-panel controls for editing a component set and placing exact variants. */
export function componentSetAssetMarkup(document, set, { open = false, selectedComponentId = null } = {}) {
  const members = membersFor(document, findSet(document, set?.id));
  const setId = escapeHtml(set.id);
  const selectedId = members.some(component => component.id === selectedComponentId) ? selectedComponentId : members[0]?.id;
  const options = members.map(component => `<option value="${escapeHtml(component.id)}"${component.id === selectedId ? ' selected' : ''}>${escapeHtml(variantLabel(component, set))}</option>`).join('');
  const axes = set.properties.map(property => `<div class="component-set-axis" data-component-set-axis="${escapeHtml(property.name)}">
    <label class="component-set-axis-name"><span>Axis</span><input type="text" maxlength="${maxVariantNameLength}" value="${escapeHtml(property.name)}" data-component-set-axis-name data-set-id="${setId}" data-axis-old-name="${escapeHtml(property.name)}" aria-label="Rename ${escapeHtml(property.name)} variant axis" /></label>
    <button type="button" class="component-set-remove-axis" data-action="remove-component-variant-axis" data-set-id="${setId}" data-axis-name="${escapeHtml(property.name)}" aria-label="Remove ${escapeHtml(property.name)} axis" title="Remove axis">×</button>
  </div>`).join('');
  const variantRows = members.map(component => {
    const label = variantLabel(component, set);
    const cannotRemove = members.length <= 2;
    return `<div class="component-set-variant" data-component-variant="${escapeHtml(component.id)}">
    <div class="component-set-variant-heading"><strong>${escapeHtml(component.name || 'Variant')}</strong><button type="button" class="component-set-place-variant" data-place-variant="${escapeHtml(component.id)}" aria-label="Place ${escapeHtml(label)}">Place</button><button type="button" class="component-set-remove-axis component-set-remove-variant" data-action="remove-component-variant-from-set" data-set-id="${setId}" data-component-id="${escapeHtml(component.id)}" aria-label="Remove ${escapeHtml(label)} from set" title="${cannotRemove ? 'A component set must keep at least two variants.' : 'Remove from set; the master and linked instances stay intact.'}"${cannotRemove ? ' disabled' : ''}>Remove</button></div>
    <div class="component-set-variant-values">${set.properties.map(property => `<label><span>${escapeHtml(property.name)}</span><input type="text" maxlength="${maxVariantNameLength}" value="${escapeHtml(component.variantProperties?.[property.name] || '')}" data-variant-master-property="${escapeHtml(property.name)}" data-component-id="${escapeHtml(component.id)}" aria-label="${escapeHtml(component.name)} ${escapeHtml(property.name)} value" /></label>`).join('')}</div>
  </div>`;
  }).join('');
  const newVariantValues = set.properties.map(property => `<label><span>${escapeHtml(property.name)} value</span><input type="text" maxlength="${maxVariantNameLength}" data-component-set-new-variant-value="${setId}" data-set-id="${setId}" data-axis-name="${escapeHtml(property.name)}" placeholder="Inherit selected value" aria-label="New ${escapeHtml(property.name)} value; leave blank to inherit from selected master" /></label>`).join('');
  return `<section class="component-set-card" data-component-set-panel="${setId}">
    <header class="component-set-heading"><label><span>Component set</span><input type="text" maxlength="${maxVariantNameLength}" value="${escapeHtml(set.name)}" data-component-set-name data-set-id="${setId}" aria-label="Rename component set ${escapeHtml(set.name)}" /></label><small>${members.length} variants</small></header>
    <div class="component-set-placement"><label><span>Choose variant</span><select class="select-field" data-component-set-placement="${setId}" aria-label="Choose variant from ${escapeHtml(set.name)}">${options}</select></label><button type="button" class="component-set-place-selected" data-component-set-id="${setId}" aria-label="Place selected ${escapeHtml(set.name)} variant">Place selected</button></div>
    <details class="component-set-editor" data-component-set-editor="${setId}"${open ? ' open' : ''}><summary>Manage axes and variant values</summary>
      <div class="component-set-axis-list" aria-label="Variant axes">${axes}</div>
      <div class="component-set-add-axis"><label><span>New axis</span><input type="text" maxlength="${maxVariantNameLength}" data-component-set-new-axis="${setId}" placeholder="e.g. Size" aria-label="New variant axis for ${escapeHtml(set.name)}" /></label><label><span>Starting value</span><input type="text" maxlength="${maxVariantNameLength}" data-component-set-new-value="${setId}" value="Default" aria-label="Starting value for new axis" /></label><button type="button" data-action="add-component-variant-axis" data-set-id="${setId}">Add axis</button></div>
      <div class="component-set-add-axis component-set-add-variant" data-component-set-add-variant="${setId}" aria-label="Create a variant from the selected master">${newVariantValues}<button type="button" data-action="add-component-variant-from-master" data-set-id="${setId}" aria-label="Add variant from selected master">Add variant from selected</button></div>
      <div class="component-set-variants" aria-label="Variants">${variantRows}</div>
    </details>
  </section>`;
}
