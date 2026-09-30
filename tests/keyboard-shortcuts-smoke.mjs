const result = document.querySelector('#result');
const frame = document.querySelector('#app-frame');

function assert(value, message) { if (!value) throw new Error(message); }
function keydown(app, key, options = {}) {
  const event = new app.defaultView.KeyboardEvent('keydown', { bubbles: true, cancelable: true, key, ...options });
  app.body.dispatchEvent(event);
  return event;
}

try {
  const started = performance.now();
  while (frame.contentDocument?.documentElement.dataset.appReady !== 'true') {
    if (performance.now() - started > 45000) throw new Error('Timed out waiting for the editor startup.');
    await new Promise(resolve => setTimeout(resolve, 30));
  }
  const app = frame.contentDocument;
  const sectionTool = app.querySelector('[data-tool="section"]');
  assert(sectionTool, 'The Section tool is missing from the toolbar.');
  const sectionEvent = keydown(app, 's', { shiftKey: true });
  assert(sectionEvent.defaultPrevented && sectionTool.classList.contains('is-selected'), 'Shift+S should activate the Section tool without opening a browser action.');

  const imageInput = app.querySelector('#image-input');
  assert(imageInput, 'The local image picker is missing.');
  const originalClick = imageInput.click;
  let imagePickerOpened = false;
  imageInput.click = () => { imagePickerOpened = true; };
  try {
    const imageEvent = keydown(app, 'k', { shiftKey: true, ctrlKey: true });
    assert(imageEvent.defaultPrevented && imagePickerOpened, 'Shift+Ctrl+K should open the local image picker.');
  } finally { imageInput.click = originalClick; }

  result.textContent = `PASS\n${JSON.stringify({ sectionTool: 'Shift+S', imagePicker: 'Shift+Ctrl+K', browserDefaultsPrevented: true })}`;
} catch (error) {
  result.textContent = `FAIL\n${error?.stack || error}`;
}
