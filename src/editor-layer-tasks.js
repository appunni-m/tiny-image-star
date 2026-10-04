/** Build searchable layer commands from the current selection capabilities. */
export function createEditorLayerActions({
  selectedCount = 0,
  pageLayerCount = 0,
  canGroup = false,
  canUngroup = false,
  groupUnavailableReason = '',
  ungroupUnavailableReason = '',
  disabledReason = '',
  group,
  ungroup,
  duplicate,
  remove,
  selectAll,
  deselectAll
} = {}) {
  const commands = [group, ungroup, duplicate, remove, selectAll, deselectAll];
  if (commands.some(command => typeof command !== 'function')) {
    throw new TypeError('Editor layer tasks need handlers for each layer command.');
  }
  const noSelection = selectedCount === 0 ? 'Select a layer first.' : '';
  const groupBlocked = disabledReason || (canGroup ? '' : groupUnavailableReason || 'Select compatible sibling layers first.');
  const ungroupBlocked = disabledReason || (canUngroup ? '' : ungroupUnavailableReason || 'Select a group layer first.');
  return [
    {
      id: 'duplicate-layers',
      label: selectedCount > 1 ? `Duplicate ${selectedCount} selected layers` : 'Duplicate selected layer',
      description: 'Make a copy of the selected layer or layers on this page.',
      keywords: ['duplicate', 'copy layer', 'copy layers', 'clone object'],
      disabled: Boolean(disabledReason || noSelection),
      unavailableReason: disabledReason || noSelection,
      run: duplicate
    },
    {
      id: 'group-layers', label: 'Group selected layers',
      description: 'Put compatible selected layers into one group while keeping them editable.',
      keywords: ['group', 'group layers', 'organize layers', 'combine selection'],
      disabled: Boolean(groupBlocked), unavailableReason: groupBlocked, run: group
    },
    {
      id: 'ungroup-layers', label: 'Ungroup selected group',
      description: 'Remove the group while keeping its child layers on the page.',
      keywords: ['ungroup', 'ungroup layers', 'separate group', 'release group'],
      disabled: Boolean(ungroupBlocked), unavailableReason: ungroupBlocked, run: ungroup
    },
    {
      id: 'delete-layers', label: selectedCount > 1 ? `Delete ${selectedCount} selected layers` : 'Delete selected layer',
      description: 'Remove the selected layer or layers from this page.',
      keywords: ['delete', 'remove layer', 'remove layers', 'trash', 'discard object'],
      disabled: Boolean(disabledReason || noSelection),
      unavailableReason: disabledReason || noSelection,
      run: remove
    },
    {
      id: 'select-all-layers', label: 'Select all layers on this page',
      description: 'Select every layer on the current page.',
      keywords: ['select all', 'select everything', 'all objects', 'all layers'],
      disabled: Boolean(disabledReason || pageLayerCount === 0),
      unavailableReason: disabledReason || (pageLayerCount === 0 ? 'This page has no layers yet.' : ''),
      run: selectAll
    },
    {
      id: 'deselect-all-layers', label: 'Clear the selection',
      description: 'Deselect every layer without changing the design.',
      keywords: ['deselect', 'clear selection', 'unselect', 'nothing selected'],
      disabled: Boolean(disabledReason || noSelection),
      unavailableReason: disabledReason || noSelection,
      run: deselectAll
    }
  ];
}
