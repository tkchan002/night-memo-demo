let context = {
  reportDate: '',
  reportDateDisplay: '',
  section: '',
  wardSummaryTableHtml: '',
  infectionTableHtml: '',
};

const status = document.getElementById('templateFrameStatus');
function setStatus(message, type='info') {
  status.textContent = message;
  status.className = `manager-status ${type}`;
  status.hidden = !message;
}

window.addEventListener('message', event => {
  if (event.data?.type === 'manager-template-context') {
    context = event.data.context || context;
  }
  if (event.data?.type === 'manager-template-print') {
    context = event.data.context || context;
    printPublishedTemplate();
  }
});

start();

async function start() {
  try {
    const editor = await import('./manager-template-editor.js');
    window.__managerTemplateEditor = editor;
    await editor.initManagerTemplateEditor({
      showPage: () => {},
      getContext: () => context,
    });
    setStatus('', 'info');
    parent.postMessage({ type: 'manager-template-ready' }, '*');
  } catch (error) {
    console.error('Template editor frame failed:', error);
    setStatus(`Print editor unavailable: ${error.message || String(error)}. The manager Night Memo remains unaffected.`, 'error');
    parent.postMessage({ type: 'manager-template-ready' }, '*');
  }
}

async function printPublishedTemplate() {
  try {
    const [{ getActiveManagerPrintTemplate }, editor] = await Promise.all([
      import('./manager-template-store.js'),
      import('./manager-template-editor.js'),
    ]);
    const template = await getActiveManagerPrintTemplate(context.reportDate);
    editor.printTemplateObject(template || editor.getDefaultTemplate());
  } catch (error) {
    console.warn('Published template print failed:', error);
    parent.postMessage({ type: 'manager-template-print-fallback' }, '*');
  }
}
