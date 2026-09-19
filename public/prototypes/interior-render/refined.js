// Shared dropdowns keep native select values as the single source of truth.
const chevron = '<svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.4"><path d="m3 4.5 3 3 3-3"/></svg>';
const checkmark = '<svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.4"><path d="m3 7 2.5 2.5L11 4"/></svg>';
const dropdowns = [];
let opened = null;

function closeDropdown(restoreFocus = false) {
  if (!opened) return;
  const { button, menu } = opened;
  menu.remove();
  button.setAttribute('aria-expanded', 'false');
  opened = null;
  if (restoreFocus) button.focus();
}

function openDropdown(entry, focusSelected = false) {
  if (opened?.button === entry.button) return closeDropdown(true);
  closeDropdown();
  const { select, button } = entry;
  const rect = button.getBoundingClientRect();
  const menu = document.createElement('div');
  menu.className = 'select-menu';
  menu.id = 'menu-' + select.id;
  menu.setAttribute('role', 'listbox');
  menu.setAttribute('aria-label', entry.label);
  const desiredHeight = Math.min(280, select.options.length * 34 + 16);
  const below = innerHeight - rect.bottom - 12;
  const above = rect.top - 12;
  const useAbove = below < desiredHeight && above > below;
  const height = Math.max(80, Math.min(desiredHeight, useAbove ? above : below));
  const width = Math.max(150, rect.width);
  Object.assign(menu.style, {
    width: width + 'px', maxHeight: height + 'px',
    left: Math.max(8, Math.min(rect.left, innerWidth - width - 8)) + 'px',
    top: (useAbove ? rect.top - height - 5 : rect.bottom + 5) + 'px'
  });
  Array.from(select.options).forEach(option => {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'select-option' + (option.value === '自定义' ? ' option-custom' : '');
    item.setAttribute('role', 'option');
    item.setAttribute('aria-selected', String(option.selected));
    item.textContent = option.textContent;
    if (option.selected) item.insertAdjacentHTML('beforeend', checkmark);
    item.onclick = () => {
      select.value = option.value;
      select.dispatchEvent(new Event('input', { bubbles: true }));
      closeDropdown(true);
    };
    menu.append(item);
  });
  document.body.append(menu);
  button.setAttribute('aria-expanded', 'true');
  opened = { ...entry, menu };
  menu.addEventListener('keydown', event => {
    const items = Array.from(menu.children);
    const current = items.indexOf(document.activeElement);
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      const index = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (current + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
      items[index].focus();
    } else if (event.key === 'Escape') {
      event.preventDefault(); closeDropdown(true);
    } else if (event.key === 'Tab') closeDropdown(true);
  });
  const selected = menu.querySelector('[aria-selected=true]');
  if (selected) {
    menu.scrollTop = Math.max(0, selected.offsetTop - height / 2 + 17);
    if (focusSelected) selected.focus({ preventScroll: true });
  }
}

document.querySelectorAll('select').forEach(select => {
  const label = Array.from(select.parentElement.childNodes).filter(n => n.nodeType === Node.TEXT_NODE).map(n => n.textContent.trim()).join('');
  select.classList.add('native-select');
  select.setAttribute('aria-hidden', 'true');
  select.tabIndex = -1;
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'select-trigger';
  button.setAttribute('role', 'combobox');
  button.setAttribute('aria-label', label);
  button.setAttribute('aria-haspopup', 'listbox');
  button.setAttribute('aria-expanded', 'false');
  button.setAttribute('aria-controls', 'menu-' + select.id);
  const entry = { select, button, label };
  button.onclick = event => { event.preventDefault(); openDropdown(entry); };
  button.onkeydown = event => {
    if (['ArrowDown', 'ArrowUp'].includes(event.key)) { event.preventDefault(); if (!opened) openDropdown(entry, true); }
    if (event.key === 'Escape') closeDropdown(true);
  };
  select.after(button);
  dropdowns.push(entry);
});

function refreshDropdowns() {
  dropdowns.forEach(({ select, button }) => {
    button.innerHTML = '';
    const text = document.createElement('span');
    text.textContent = select.selectedOptions[0]?.textContent || '';
    button.append(text);
    button.insertAdjacentHTML('beforeend', chevron);
    button.disabled = select.disabled;
  });
}
document.addEventListener('settings-sync', refreshDropdowns);
document.addEventListener('pointerdown', event => {
  if (opened && !opened.menu.contains(event.target) && !opened.button.contains(event.target)) closeDropdown();
});
document.addEventListener('scroll', event => {
  if (opened && event.target !== opened.menu && !opened.menu.contains(event.target)) closeDropdown();
}, true);
window.addEventListener('resize', () => closeDropdown());

$('upload-outside').onclick = () => $('outside-file').click();
$('outside-file').onchange = event => {
  const file = event.target.files[0];
  if (!file) return;
  if (!file.type.startsWith('image/')) return toast('请选择图片文件');
  if (outsideUrl) URL.revokeObjectURL(outsideUrl);
  outsideUrl = URL.createObjectURL(file);
  const image = new Image();
  image.src = outsideUrl;
  image.alt = '外景参考';
  $('outside-preview').replaceChildren(image);
  sync();
  toast('外景参考图已添加，整组视角共用');
};

const generateDemo = $('generate').onclick;
$('generate').onclick = () => {
  if (busy) return;
  for (const key of ['city', 'time', 'temperature', 'outside']) {
    if (key === 'temperature' && !$('lights').checked) continue;
    if (key === 'outside' && $('closed').checked) continue;
    if ($(key).value === '自定义' && !$('custom-' + key).value.trim()) {
      toast('请补充自定义' + { city: '地点', time: '时间', temperature: '色温', outside: '外景' }[key]);
      $('custom-' + key).focus();
      return;
    }
  }
  if ($('lights').checked && $('temperature').value === '自定义') {
    const kelvin = Number($('custom-temperature').value);
    if (!Number.isFinite(kelvin) || kelvin < 1000 || kelvin > 20000) {
      toast('请输入 1000–20000K 之间的色温');
      $('custom-temperature').focus();
      return;
    }
  }
  if (!$('closed').checked && ['参考图', '卫星图'].includes($('outside').value) && !outsideUrl) {
    toast('请先上传外景' + $('outside').value);
    $('upload-outside').focus();
    return;
  }
  generateDemo();
};
refreshDropdowns();
