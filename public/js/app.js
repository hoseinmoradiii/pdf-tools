(function () {
  function formatSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(0) + ' KB';
    return (bytes / 1024 / 1024).toFixed(1) + ' MB';
  }

  document.querySelectorAll('[data-upload-form]').forEach(function (form) {
    var zone = form.querySelector('[data-dropzone]');
    var input = zone.querySelector('input[type="file"]');
    var list = form.querySelector('[data-file-list]');
    var submit = form.querySelector('[data-submit]');
    var multiple = zone.dataset.multiple === 'true';
    var withPreviews = zone.dataset.images === 'true';
    var files = [];

    function sync() {
      // Push our ordered array back into the real input so the browser submits it in this order
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
      // Native picker replaces input.files; rebuild our array from it
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

    form.addEventListener('submit', function () {
      submit.disabled = true;
      submit.classList.add('is-busy');
      submit.textContent = submit.dataset.busyText || 'Working…';
    });
  });
})();
