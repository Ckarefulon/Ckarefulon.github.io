(function(){
  const fileInput = document.getElementById('fileInput');
  const dropZone = document.getElementById('dropZone');
  const queue = document.getElementById('queue');
  const fileList = document.getElementById('fileList');
  const queueTitle = document.getElementById('queueTitle');
  const convertBtn = document.getElementById('convertBtn');
  const downloadAllBtn = document.getElementById('downloadAllBtn');
  const clearBtn = document.getElementById('clearBtn');
  let files = [];
  let results = new Map();
  let converting = false;

  const iconMap = {
    'kgm': '\uD83D\uDD12',
    'kgma': '\uD83D\uDD12',
    'flac': '\uD83C\uDFB5',
    'mp3': '\uD83C\uDFB5',
    'default': '\uD83D\uDCC4'
  };

  function getIcon(filename) {
    const lower = filename.toLowerCase();
    const layer = window.__KGM && __KGM.detectEncryptionLayer(filename);
    if (layer) return iconMap[layer];
    if (lower.endsWith('.flac')) return iconMap.flac;
    if (lower.endsWith('.mp3')) return iconMap.mp3;
    return iconMap.default;
  }

  function formatBytes(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, char => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[char]);
  }

  function addFiles(newFiles) {
    const arr = Array.from(newFiles);
    arr.forEach((file, i) => {
      const idx = files.length;
      files.push({ file, idx });
      results.delete(idx);
    });
    renderQueue();
  }

  function renderQueue() {
    if (files.length === 0) {
      queue.style.display = 'none';
      return;
    }
    queue.style.display = 'block';
    queueTitle.textContent = files.length + ' 个文件';
    fileList.innerHTML = '';
    files.forEach(({ file, idx }) => {
      const layer = __KGM.detectEncryptionLayer(file.name);
      const isMp3 = __KGM.isMp3(file.name);
      const result = results.get(idx);
      const hasError = Boolean(result && result.error);
      const item = document.createElement('div');
      item.className = 'file-item';
      item.innerHTML = `
        <span class="file-icon">${getIcon(file.name)}</span>
        <div class="file-info">
          <div class="file-name" title="${escapeHtml(file.name)}">${escapeHtml(file.name)}</div>
          <div class="file-meta">${formatBytes(file.size)}${layer ? ' · ' + layer.toUpperCase() : ''}${isMp3 && !layer ? ' · MP3 直出' : ''}</div>
          ${result ? (result.done
            ? `<div class="file-meta" style="color:var(--green)">✓ ${escapeHtml(result.name)}</div>`
            : hasError ? `<div class="file-meta" style="color:var(--red)">✗ ${escapeHtml(result.error)}</div>` : '')
            : ''}
          <div class="progress-bar" style="display:${result && !result.done && !hasError ? 'block' : 'none'}">
            <div class="progress-fill" style="width:${result ? result.progress : 0}%"></div>
          </div>
        </div>
        <span class="file-status ${result ? (result.done ? 'status-done' : hasError ? 'status-error' : 'status-running') : 'status-pending'}">
          ${result ? (result.done ? '完成' : hasError ? '失败' : '处理中') : '等待'}
        </span>
      `;
      fileList.appendChild(item);
    });
    const pending = files.some(({ idx }) => {
      const result = results.get(idx);
      return !result || Boolean(result.error);
    });
    const hasDownload = files.some(({ idx }) => {
      const result = results.get(idx);
      return Boolean(result && result.done && result.blob);
    });
    convertBtn.disabled = converting || !pending;
    downloadAllBtn.disabled = converting || !hasDownload;
    convertBtn.textContent = converting ? '转换中...' : '转换';
  }

  async function convertFile(file, index) {
    const layer = __KGM.detectEncryptionLayer(file.name);
    const isMp3 = __KGM.isMp3(file.name);
    const isFlac = __KGM.isFlac(file.name);
    results.set(index, { done: false, progress: 0 });
    renderQueue();

    try {
      // Compound names such as song.kgm.mp3 are encrypted despite their final suffix.
      if (!layer && (isMp3 || isFlac)) {
        const outputName = file.name;
        results.set(index, { done: true, blob: file, name: outputName, progress: 100 });
        renderQueue();
        return;
      }
      if (!layer) {
        results.set(index, { done: false, error: '未知格式', progress: 0 });
        renderQueue();
        return;
      }
      results.set(index, { done: false, progress: 10 });
      renderQueue();
      const data = await file.arrayBuffer();
      results.set(index, { done: false, progress: 30 });
      renderQueue();
      const decrypted = await __KGM.decrypt(data, layer);
      const outputFormat = __KGM.detectFormat(decrypted);
      if (!outputFormat) {
        throw new Error('解密结果不是受支持的音频格式，请检查文件是否完整');
      }
      results.set(index, { done: false, progress: 90 });
      renderQueue();
      const outputName = __KGM.getOutputFilename(file.name, outputFormat);
      const mimeType = __KGM.getOutputMimeType(decrypted);
      const blob = new Blob([decrypted], { type: mimeType });
      results.set(index, { done: true, blob, name: outputName, progress: 100 });
    } catch(e) {
      results.set(index, { done: false, error: e.message || '转换失败', progress: 0 });
    }
    renderQueue();
  }

  async function convertAll() {
    if (converting) return;
    converting = true;
    renderQueue();
    for (let i = 0; i < files.length; i++) {
      const result = results.get(files[i].idx);
      if (!result || result.error) {
        await convertFile(files[i].file, files[i].idx);
      }
    }
    converting = false;
    renderQueue();
  }

  function downloadAll() {
    const downloadable = [];
    files.forEach(({ file, idx }) => {
      const r = results.get(idx);
      if (r && r.done && r.blob) downloadable.push(r);
    });
    if (downloadable.length === 0) return;
    downloadable.forEach(r => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(r.blob);
      a.download = r.name;
      a.click();
      const objectUrl = a.href;
      setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
    });
  }

  function clearAll() {
    files = [];
    results.clear();
    renderQueue();
  }

  dropZone.addEventListener('click', () => fileInput.click());
  dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('drag-over'); });
  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
  dropZone.addEventListener('drop', e => {
    e.preventDefault();
    dropZone.classList.remove('drag-over');
    if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files);
  });
  fileInput.addEventListener('change', () => { if (fileInput.files.length) addFiles(fileInput.files); });
  convertBtn.addEventListener('click', convertAll);
  downloadAllBtn.addEventListener('click', downloadAll);
  clearBtn.addEventListener('click', clearAll);
  if (window.siteNav && typeof window.siteNav.init === 'function') {
    window.siteNav.init({
      setTheme: function(theme) {
        document.documentElement.classList.remove('dark', 'light');
        document.documentElement.classList.add(theme);
        localStorage.setItem('theme', theme);
      },
    });
  }

  renderQueue();
})();
