(function () {
  var TIMEOUT_MS = 10 * 60 * 1000; // give up after 10 minutes
  var overlay = document.querySelector('[data-loading]');

  /* ---------- Loading overlay ---------- */
  function showLoading(message) {
    if (!overlay) return;
    if (message) overlay.querySelector('[data-loading-title]').textContent = message;
    overlay.hidden = false;
    document.body.classList.add('is-loading');
  }

  function hideLoading() {
    if (!overlay) return;
    overlay.hidden = true;
    document.body.classList.remove('is-loading');
  }

  // Back/forward cache can restore the page with the overlay still showing
  window.addEventListener('pageshow', function (e) {
    if (e.persisted) hideLoading();
  });

  /* ---------- Helpers ---------- */
  function formatSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(0) + ' KB';
    return (bytes / 1024 / 1024).toFixed(1) + ' MB';
  }

  function filenameFromHeader(res, fallback) {
    var cd = res.headers.get('content-disposition') || '';
    var star = cd.match(/filename\*=(?:UTF-8'')?([^;]+)/i);
    if (star) { try { return decodeURIComponent(star[1].trim().replace(/"/g, '')); } catch (e) {} }
    var plain = cd.match(/filename="?([^";]+)"?/i);
    return plain ? plain[1] : fallback;
  }

  function triggerDownload(url, filename) {
    var a = document.createElement('a');
    a.href = url;
    a.download = filename || '';
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  // Read a useful message out of a failed response
  async function errorMessage(res) {
    var type = res.headers.get('content-type') || '';
    try {
      if (type.indexOf('application/json') !== -1) {
        var data = await res.json();
        if (data && data.error) return data.error.message || data.error;
        if (data && data.message) return data.message;
      }
    } catch (e) { /* fall through */ }
    return 'The server returned an error (' + res.status + ').';
  }

  /* ---------- Notice (success / error) shown above the form ---------- */
  function showNotice(form, kind, text, link) {
    var old = form.parentNode.querySelector('[data-notice]');
    if (old) old.remove();

    var box = document.createElement('div');
    box.setAttribute('data-notice', '');
    box.className = 'notice ' + (kind === 'ok' ? 'notice-ok' : 'notice-error');
    box.setAttribute('role', kind === 'ok' ? 'status' : 'alert');

    var body = document.createElement('div');
    var strong = document.createElement('strong');
    strong.textContent = kind === 'ok' ? 'Your file is ready.' : 'That didn’t work.';
    var span = document.createElement('span');
    span.textContent = text;
    body.appendChild(strong);
    body.appendChild(span);
    box.appendChild(body);

    if (link) {
      var a = document.createElement('a');
      a.className = 'btn';
      a.href = link.url;
      a.download = link.filename || '';
      a.textContent = 'Download again';
      box.appendChild(a);
    }

    form.parentNode.insertBefore(box, form);
    box.scrollIntoView({ block: 'nearest' });
  }

  /* ---------- Upload forms ---------- */
  document.querySelectorAll('[data-upload-form]').forEach(function (form) {
    var zone = form.querySelector('[data-dropzone]');
    var input = zone.querySelector('input[type="file"]');
    var list = form.querySelector('[data-file-list]');
    var submit = form.querySelector('[data-submit]');
    var multiple = zone.dataset.multiple === 'true';
    var withPreviews = zone.dataset.images === 'true';
    var files = [];
    var lastBlobUrl = null;
    var originalLabel = submit.textContent;

    function sync() {
      var dt = new DataTransfer();
      files.forEach(function (f) { dt.items.add(f); });
      input.files = dt.files;
      submit.disabled = files.length === 0;
      render();
    }

    function setFiles(incoming) {
      var arr = Array.from(incoming);
      files = multiple ? files.concat(arr) : arr.slice(0, 1);
      sync();
    }

    function move(i, d) {
      var j = i + d;
      if (j < 0 || j >= files.length) return;
      var tmp = files[i]; files[i] = files[j]; files[j] = tmp;
      sync();
    }

    function iconButton(label, text, onClick, disabled) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'icon-btn';
      b.setAttribute('aria-label', label);
      b.textContent = text;
      b.disabled = !!disabled;
      b.addEventListener('click', onClick);
      return b;
    }

    function render() {
      list.innerHTML = '';
      files.forEach(function (file, i) {
        var li = document.createElement('li');
        li.className = 'file-item';

        if (withPreviews && file.type.indexOf('image/') === 0) {
          var img = document.createElement('img');
          img.alt = '';
          img.src = URL.createObjectURL(file);
          img.onload = function () { URL.revokeObjectURL(img.src); };
          li.appendChild(img);
        }

        var meta = document.createElement('div');
        meta.className = 'file-meta';
        var name = document.createElement('span');
        name.className = 'file-name';
        name.textContent = file.name;
        var size = document.createElement('span');
        size.className = 'file-size';
        size.textContent = formatSize(file.size);
        meta.appendChild(name);
        meta.appendChild(size);
        li.appendChild(meta);

        var actions = document.createElement('div');
        actions.className = 'file-actions';
        if (multiple) {
          actions.appendChild(iconButton('Move ' + file.name + ' up', '↑', function () { move(i, -1); }, i === 0));
          actions.appendChild(iconButton('Move ' + file.name + ' down', '↓', function () { move(i, 1); }, i === files.length - 1));
        }
        actions.appendChild(iconButton('Remove ' + file.name, 'Remove', function () {
          files.splice(i, 1);
          sync();
        }));
        li.appendChild(actions);
        list.appendChild(li);
      });
    }

    input.addEventListener('change', function () {
      var picked = Array.from(input.files);
      files = multiple ? files.concat(picked) : picked.slice(0, 1);
      sync();
    });

    ['dragenter', 'dragover'].forEach(function (evt) {
      zone.addEventListener(evt, function (e) { e.preventDefault(); zone.classList.add('is-over'); });
    });
    ['dragleave', 'drop'].forEach(function (evt) {
      zone.addEventListener(evt, function (e) { e.preventDefault(); zone.classList.remove('is-over'); });
    });
    zone.addEventListener('drop', function (e) {
      if (e.dataTransfer && e.dataTransfer.files.length) setFiles(e.dataTransfer.files);
    });

    function setBusy(busy) {
      submit.classList.toggle('is-busy', busy);
      submit.disabled = busy || files.length === 0;
      submit.textContent = busy ? (submit.dataset.busyText || 'Working…') : originalLabel;
      if (busy) showLoading(form.dataset.loadingMessage); else hideLoading();
    }

    form.addEventListener('submit', async function (e) {
      e.preventDefault();
      if (files.length === 0) return;

      if (lastBlobUrl) { URL.revokeObjectURL(lastBlobUrl); lastBlobUrl = null; }
      var old = form.parentNode.querySelector('[data-notice]');
      if (old) old.remove();

      var controller = new AbortController();
      var timer = setTimeout(function () { controller.abort(); }, TIMEOUT_MS);
      setBusy(true);

      try {
        var res = await fetch(form.action, {
          method: 'POST',
          body: new FormData(form),
          headers: { 'Accept': 'application/json, application/octet-stream, */*' },
          signal: controller.signal
        });

        if (!res.ok) throw new Error(await errorMessage(res));

        var type = res.headers.get('content-type') || '';
        var url, filename;

        if (type.indexOf('application/json') !== -1) {
          // Server answered with { downloadUrl, filename }
          var data = await res.json();
          url = data.downloadUrl || data.url;
          filename = data.filename;
          if (!url) throw new Error('The server did not return a download link.');
        } else if (type.indexOf('text/html') !== -1) {
          throw new Error('The server returned a web page instead of a file. Check that the POST route sends the file or JSON.');
        } else {
          // Server sent the file itself (res.download / res.sendFile)
          var blob = await res.blob();
          lastBlobUrl = URL.createObjectURL(blob);
          url = lastBlobUrl;
          filename = filenameFromHeader(res, 'download');
        }

        triggerDownload(url, filename);
        showNotice(form, 'ok', filename || 'Your download has started.', { url: url, filename: filename });
      } catch (err) {
        var msg = err.name === 'AbortError'
          ? 'The conversion took too long and was cancelled. Try a smaller file.'
          : (err.message === 'Failed to fetch' ? 'Could not reach the server. Check your connection and try again.' : err.message);
        showNotice(form, 'error', msg);
      } finally {
        clearTimeout(timer);
        setBusy(false); // always runs: success, error, timeout or network failure
      }
    });
  });
})();
