(function () {
  'use strict';

  document.getElementById('back-link')?.addEventListener('click', (e) => {
    e.preventDefault();
    if (document.referrer && document.referrer.includes(window.location.host)) {
      history.back();
    } else {
      window.location.href = '../index.html';
    }
  });

  // ─── 1. CONFIGURATION ──────────────────────────────────────────

  const levelChoices = ['100L','200L','300L','400L','500L','Relevant'];
  let catalog = []; // Only current, published courses. Approved inventory remains available independently.
  function catalogScope() {
    return catalog.filter(r => (selectedLevel === 'all' || selectedLevel === r.level) &&
      (selectedSemester === 'all' || selectedSemester === r.semester));
  }
  function courseLabel(key, rows = catalogScope()) {
    const names = new Set(rows.filter(r => r.key.toLowerCase() === key.toLowerCase()).map(r=>r.name));
    if(names.size !== 1) return key;
    const label=[...names][0], matched=rows.filter(r=>r.key.toLowerCase()===key.toLowerCase());
    const namesakes=rows.some(r=>r.name.toLowerCase()===label.toLowerCase() && r.key.toLowerCase()!==key.toLowerCase());
    if (namesakes && matched.length) return label+' · '+[...new Set(matched.map(r=>r.curriculum_name||'Existing desk'))].join(' / ');
    return label;
  }
  const textHTML = value => String(value).replace(/[&<>]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;'})[c]);

  let ALL_COURSES = ['All'];

  function withinDesk(book) {
    return (selectedLevel === 'all' || book.level === selectedLevel || book.level === 'relevant') &&
      (selectedSemester === 'all' || book.semester === selectedSemester || book.semester === 'all');
  }

  function getCourseSuggestions() {
    const values = [...catalogScope().map(r => r.key), ...books.filter(withinDesk).map(b => b.courseName)];
    return [...new Set(values.filter(Boolean))];
  }

  function updateCourseFilters() {
    if (selectedLevel === 'Relevant') selectedSemester = 'all';
    ALL_COURSES = ['All', ...getCourseSuggestions()];
    // A desk can acquire a course before the library's legacy suggestion list is updated.
    // Keep that explicit filter in its own level/semester; it is not an upload permission.
    if (requestedCourse && !userChangedScope && !ALL_COURSES.includes(requestedCourse)) {
      ALL_COURSES.push(requestedCourse);
    }
    if (!ALL_COURSES.includes(activeFilter)) activeFilter = 'All';
    document.getElementById('levelFilter').value = selectedLevel;
    const semesterSelect = document.getElementById('semesterFilter');
    if (selectedLevel === 'Relevant') {
      semesterSelect.value = 'all';
      semesterSelect.disabled = true;
      semesterSelect.innerHTML = `<option value="all">All</option>`;
    } else {
      semesterSelect.disabled = false;
      semesterSelect.innerHTML =
        `<option value="all">All</option>
      <option value="first">First Semester</option>
      <option value="second">Second Semester</option>`;
      semesterSelect.value = selectedSemester;
    }
    buildFilterChips();
    buildMobileList();
    render();
  }

  const PDF_JS_VERSION = '3.11.174';
  pdfjsLib.GlobalWorkerOptions.workerSrc =
    `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${PDF_JS_VERSION}/pdf.worker.min.js`;

  const PDF_FOLDER = null; // no longer used - files now load via signed URLs from Supabase

  const COURSE_STYLES = {
    'communication in English': { bg: '#EEF2FF', spine: '#4F46E5', icon: '📖' },
    'legal method': { bg: '#FEF3C7', spine: '#D97706', icon: '⚖️' },
    'Customary law': { bg: '#FCE4EC', spine: '#DB2777', icon: '📜' },
    'philosophy': { bg: '#D1FAE5', spine: '#059669', icon: '🧠' },
    'psychology': { bg: '#EDE9FE', spine: '#7C3AED', icon: '🧩' },
    'natural Science': { bg: '#CCFBF1', spine: '#0D9488', icon: '🔬' },
    'logics': { bg: '#FEF3C7', spine: '#D97706', icon: '🧮' },
    'ELS': { bg: '#E0E7FF', spine: '#4F46E5', icon: 'NO FILE📘' },
  };
  const DEFAULT_STYLE = { bg: '#F1F5F9', spine: '#94A3B8', icon: '📄' };

  // ─── 2. GENERATE BOOK DATA ──────────────────────────────────────

  function generateBookData(fileName, courseName) {
    const clean = fileName.split('/').pop().replace(/\.pdf$/i, '');
    courseName = courseName || 'communication in English';

    const words = clean.split(/[-_\s]+/).filter(w => w.length > 0);
    const title = words
      .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
      .join(' ');

    const style = Object.hasOwn(COURSE_STYLES, courseName) ? COURSE_STYLES[courseName] : DEFAULT_STYLE;

    return {
      fileName,
      displayName: title || clean,
      courseName,
      icon: style.icon,
      coverBg: style.bg,
      spineColor: style.spine,
      raw: clean.toLowerCase(),
    };
  }

  // ─── 3. STATE ──────────────────────────────────────────────────

  let libraryState = 'loading';
  let books = [];
  let filteredBooks = [];
  const libraryParams = new URLSearchParams(window.location.search);
  const requestedLevel = libraryParams.get('level');
  const courseParam = (libraryParams.get('course') || '').trim();
  const requestedCourse = courseParam.length <= 240 ? courseParam : '';
  const termParam = libraryParams.get('semester');
  const requestedSemester = ['first', 'second'].includes(termParam) ? termParam : 'all';
  const requestedMaterial = libraryParams.get('material');
  let selectedLevel = levelChoices.includes(requestedLevel) ? requestedLevel : 'all';
  // Both Home Library links are unscoped. Bookmarks from a desk or a shared material are instructions,
  // not defaults: don't replace their scope with the profile, even if its response arrives later.
  const unscopedEntry = !['level', 'semester', 'course', 'material'].some(key => libraryParams.has(key));
  let acceptProfileLevel = selectedLevel === 'all' && requestedLevel !== 'all' && !libraryParams.has('material');
  let profileNote = null;
  function keepReaderFilters() {
    acceptProfileLevel = false;
    profileNote?.remove();
    profileNote = null;
  }
  function explainMissingDefault() {
    if (!unscopedEntry || !acceptProfileLevel || profileNote) return;
    const host = document.querySelector?.('.library-filters');
    if (!host) return;
    profileNote = document.createElement('p');
    profileNote.setAttribute('role', 'status');
    profileNote.textContent = 'Your study level is unavailable. Showing all levels and semesters; you can choose either filter.';
    host.after(profileNote);
  }
  let selectedSemester = requestedLevel === 'Relevant' ? 'all' : requestedSemester;
  let userChangedScope = false;
  let isAdmin = false;
  let viewerId = null;

  async function loadUserFilters() {
    const { data: { user } } = await supabaseClient.auth.getUser();
    if (!user) return;
    viewerId = user.id;

    const [role, level] = await Promise.allSettled([
      supabaseClient.from('users').select('is_admin').eq('id', user.id).single(),
      supabaseClient.rpc('get_effective_level', { p_uid: user.id })
    ]);
    isAdmin = role.status === 'fulfilled' && !role.value.error && role.value.data?.is_admin === true;
    const profileLevel = level.status === 'fulfilled' && !level.value.error ? level.value.data : null;
    if (acceptProfileLevel && ['100L', '200L', '300L', '400L', '500L'].includes(profileLevel)) {
      selectedLevel = profileLevel;
      if (unscopedEntry) selectedSemester = 'first';
    } else if (acceptProfileLevel) {
      explainMissingDefault();
    }
    document.getElementById('levelFilter').value = selectedLevel;
  }

  async function loadApprovedMaterials() {
    const { data, error } = await supabaseClient
      .from("materials")
      .select("id, file_name, material_name, course, level, semester, storage_path")
      .eq("status", "approved");

    if (error || !Array.isArray(data)) throw Error('Approved materials unavailable');

    const withUrls = await Promise.all(data.map(async (m) => {
      const { data: signed } = await supabaseClient.functions.invoke("r2-presign", {
        body: { action: "download", key: m.storage_path },
      });
      return {
        ...generateBookData(m.material_name || m.file_name, m.course),
        materialName: m.material_name || m.file_name.replace(/\.pdf$/i, ''),
        level: m.level || 'relevant',
        semester: m.semester || 'all',
        url: signed?.downloadUrl || null,
        reviewItem: {id:m.id, material_name:m.material_name, file_name:m.file_name, level:m.level,semester:m.semester,course:m.course,status:"approved",storage_path:m.storage_path},
        materialId: m.id,
        storagePath: m.storage_path,
      };
    }));

    books = withUrls.filter(b => b.url);
    libraryState = 'ready';
    updateCourseFilters();
  }
  let activeFilter = requestedCourse || 'All';
  let searchTerm = '';

  const grid = document.getElementById('bookGrid');
  const totalBooksEl = document.getElementById('totalBooks');
  const visibleCountEl = document.getElementById('visibleCount');
  const searchInput = document.getElementById('searchInput');
  const filterChipsContainer = document.getElementById('filterChips');
  const mobileListContainer = document.getElementById('mobileCourseList');
  const bottomSheetOverlay = document.getElementById('bottomSheetOverlay');
  const hamburgerBtn = document.getElementById('hamburgerBtn');
  const sheetCloseBtn = document.getElementById('sheetCloseBtn');

  const coverCache = new Map();

  // ─── 4. RENDER COVER (PDF.js) ──────────────────────────────────

  async function renderCover(book, container) {
    const filePath = book.url;
    const canvas = container.querySelector('canvas');
    const placeholder = container.querySelector('.cover-placeholder');
    const fallback = container.querySelector('.cover-fallback');

    if (coverCache.has(book.materialId)) {
      const dataUrl = coverCache.get(book.materialId);
      const ctx = canvas.getContext('2d');
      const img = new Image();
      img.onload = () => {
        canvas.width = img.width;
        canvas.height = img.height;
        ctx.drawImage(img, 0, 0);
        container.classList.add('cover-loaded');
      };
      img.onerror = () => showFallback();
      img.src = dataUrl;
      return;
    }

    try {
      const loadingTask = pdfjsLib.getDocument(filePath);
      const pdf = await loadingTask.promise;
      const page = await pdf.getPage(1);
      const viewport = page.getViewport({ scale: 1 });
      const rect = container.getBoundingClientRect();
      const cw = rect.width || 200;
      const ch = rect.height || 260;
      const scale = Math.min((cw - 16) / viewport.width, (ch - 24) / viewport.height, 1.6);
      const scaled = page.getViewport({ scale });
      canvas.width = scaled.width;
      canvas.height = scaled.height;
      const ctx = canvas.getContext('2d');
      await page.render({ canvasContext: ctx, viewport: scaled }).promise;
      const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
      coverCache.set(book.materialId, dataUrl);
      container.classList.add('cover-loaded');
    } catch (err) {
      console.warn('Cover render failed:', book.fileName, err);
      showFallback();
    }

    function showFallback() {
      fallback.classList.add('show');
      container.classList.add('cover-loaded');
      if (placeholder) placeholder.style.display = 'none';
    }
  }

  // ─── 5. DOWNLOAD HELPER ────────────────────────────────────────

  window.downloadPDF = async function (filePath, fileName) {
    try {
      const response = await fetch(filePath);
      const blob = await response.blob();
      const blobUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = blobUrl;
      link.download = (fileName || 'document') + '.pdf';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(blobUrl);
    } catch (err) {
      alert('Could not download this file. Try again.');
    }
  };

  // ─── 6. BUILD UI COMPONENTS ────────────────────────────────────

  function buildCourseControls(parent, cssClass, mobile) {
    const controls = ALL_COURSES.map(course => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = cssClass;
      button.classList.toggle('active', course === activeFilter);
      button.dataset.filter = course;
      button.textContent = courseLabel(course);
      button.addEventListener('click', () => {
        setActiveFilter(course);
        if (mobile) closeBottomSheet();
      });
      return button;
    });
    parent.replaceChildren(...controls);
  }
  function buildFilterChips() { buildCourseControls(filterChipsContainer, 'filter-chip', false); }
  function buildMobileList() { buildCourseControls(mobileListContainer, 'sheet-course-item', true); }

  // ─── 7. FILTER LOGIC ───────────────────────────────────────────

  function setActiveFilter(filter) {
    keepReaderFilters();
    activeFilter = filter;

    document.querySelectorAll('.filter-chip').forEach(chip => {
      chip.classList.toggle('active', chip.dataset.filter === filter);
    });

    document.querySelectorAll('.sheet-course-item').forEach(item => {
      item.classList.toggle('active', item.dataset.filter === filter);
    });

    render();
  }

  // ─── 8. BOTTOM SHEET CONTROLS ──────────────────────────────────

  function openBottomSheet() {
    bottomSheetOverlay.classList.add('open');
    document.body.style.overflow = 'hidden';
  }

  function closeBottomSheet() {
    bottomSheetOverlay.classList.remove('open');
    document.body.style.overflow = '';
  }

  // ─── 9. RENDER GRID ────────────────────────────────────────────

  function render() {
    if (libraryState !== 'ready') {
      const message = document.createElement('p');
      message.className = 'empty-state';
      message.setAttribute('role', 'status');
      message.textContent = libraryState === 'loading' ? 'Loading approved materials…' : 'Library temporarily unavailable. Please try again.';
      grid.replaceChildren(message);
      return;
    }
    filteredBooks = books.filter(book => {
      const matchesMaterial = !requestedMaterial || String(book.materialId) === requestedMaterial;
      const matchFilter = activeFilter === 'All' || book.courseName.toLowerCase() === activeFilter.toLowerCase();
      const matchSearch = searchTerm === '' ||
        book.displayName.toLowerCase().includes(searchTerm) ||
        book.courseName.toLowerCase().includes(searchTerm) ||
        courseLabel(book.courseName).toLowerCase().includes(searchTerm) ||
        book.raw.includes(searchTerm);
      return matchesMaterial && withinDesk(book) && matchFilter && matchSearch;
    });

    totalBooksEl.textContent = books.length;
    visibleCountEl.textContent = filteredBooks.length;

    if (filteredBooks.length === 0) {
      grid.innerHTML = `
            <div class="empty-state">
              <span class="big-icon">📭</span>
              <h3>No books found</h3>
              <p>Try adjusting your search or filter.</p>
            </div>
          `;
      return;
    }

    let html = '';
    filteredBooks.forEach((book, bookIndex) => {
      html += `
            <div class="book-card"
                 style="--spine-color: ${book.spineColor}; --cover-bg: ${book.coverBg}; position: relative;"
                 data-book-index="${bookIndex}">
              <div class="book-cover">
                <canvas></canvas>
                <div class="cover-placeholder">
                  <span class="cover-icon">${book.icon}</span>
                  <span class="cover-label">loading…</span>
                </div>
                <div class="cover-fallback">
                  <span class="fallback-icon">${book.icon}</span>
                  <div class="fallback-title">${textHTML(book.displayName)}</div>
                </div>
              </div>
              ${isAdmin ? `
                <button class="material-kebab" type="button" aria-label="Material actions"
                  data-book-action="menu"
                  style="position:absolute; top:8px; right:8px; z-index:5; width:28px; height:28px; border-radius:50%; border:none; background:rgba(255,255,255,0.9); box-shadow:0 1px 4px rgba(0,0,0,0.2); cursor:pointer; font-weight:bold; font-size:16px; line-height:1;">⋮</button>
                <div class="kebab-menu" style="display:none; position:absolute; top:38px; right:8px; z-index:6; background:white; border-radius:8px; box-shadow:0 4px 12px rgba(0,0,0,0.2); overflow:hidden;">
                  <button type="button" data-book-action="delete"
                    style="display:block; width:100%; padding:8px 16px; border:none; background:white; color:#dc2626; font-size:13px; cursor:pointer; text-align:left;">Delete</button>
                </div>
              ` : ""}
              <div class="book-meta">
                <div class="book-title">${textHTML(book.materialName)}</div>
                <span class="course-tag">${textHTML(courseLabel(book.courseName, catalog.filter(r => r.level === book.level && (book.semester === 'all' || r.semester === book.semester))))}</span>
                <div class="book-actions">
                  <button class="btn-read" type="button" data-book-action="read">📖 Read</button>
                  <button class="btn-download" type="button" data-book-action="download">⬇ Download</button>
                  <button class="btn-share" type="button" data-book-action="share" aria-label="Share material" title="Share material">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                      <path d="M12 16V4m0 0L7 9m5-5 5 5M5 14v4a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-4"
                        stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
                    </svg>
                  </button>
                </div>
              </div>
            </div>
          `;
    });

    grid.innerHTML = html;

    const coverContainers = grid.querySelectorAll('.book-cover');
    coverContainers.forEach((container, idx) => {
      const card = container.closest('.book-card');
      const book = filteredBooks[Number(card.dataset.bookIndex)];
      if (book) {
        setTimeout(() => renderCover(book, container), 80 + idx * 60);
      }
    });
  }

  // ─── 10. SEARCH & KEYBOARD ──────────────────────────────────────

  let searchTimeout;
  searchInput.addEventListener('input', function () {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => {
      searchTerm = this.value.trim().toLowerCase();
      render();
    }, 150);
  });

  document.addEventListener('keydown', (e) => {
    if (document.querySelector?.('dialog.lh-review[open]')) return;
    if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
      e.preventDefault();
      searchInput.focus();
    }
    if (e.key === 'Escape') {
      searchInput.blur();
      searchInput.value = '';
      searchTerm = '';
      render();
      closeBottomSheet();
    }
  });

  // ─── 11. EVENT LISTENERS ──────────────────────────────────────

  hamburgerBtn.addEventListener('click', openBottomSheet);
  sheetCloseBtn.addEventListener('click', closeBottomSheet);

  document.getElementById('levelFilter').addEventListener('change', function () {
    keepReaderFilters();
    userChangedScope = true;
    selectedLevel = this.value;
    updateCourseFilters();
  });

  document.getElementById('semesterFilter').addEventListener('change', function () {
    keepReaderFilters();
    userChangedScope = true;
    selectedSemester = this.value;
    updateCourseFilters();
  });

  document.getElementById('resetFilters').addEventListener('click', () => {
    keepReaderFilters();
    userChangedScope = true;
    selectedLevel = 'all';
    activeFilter = 'All';
    selectedSemester = 'all';
    document.getElementById('levelFilter').value = 'all';
    document.getElementById('semesterFilter').value = 'all';
    updateCourseFilters();
  });

  bottomSheetOverlay.addEventListener('click', function (e) {
    if (e.target === this) {
      closeBottomSheet();
    }
  });

  // ─── 12. RESIZE ──────────────────────────────────────────────────

  let resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(render, 400);
    if (window.innerWidth >= 901) {
      closeBottomSheet();
    }
  });

  // ─── 13. INIT ──────────────────────────────────────────────────

  updateCourseFilters();
  // Keep explicit URL filters and approved old/archived materials, even if the optional list read fails.
  import('./academic/catalog.mjs').then(m => m.readCatalog(supabaseClient)).then(rows => {
    catalog = rows;
    updateCourseFilters();
  }).catch(() => {
    const host = document.querySelector?.('.library-filters');
    if (!host) return;
    const note = document.createElement('p');
    note.setAttribute('role', 'status');
    note.textContent = 'Course list temporarily unavailable. Filters from approved materials are still available.';
    host.after(note);
  });
  loadUserFilters().catch(explainMissingDefault).then(() => {
    updateCourseFilters();
    return loadApprovedMaterials();
  }).catch(() => {
    libraryState = 'unavailable';
    render();
  });
  console.log(`📚 Library ready · ${books.length} book(s) · ${ALL_COURSES.length - 1} courses`);
  console.log('💡 Click any card to open the PDF · Ctrl+K to search');

  window.toggleKebabMenu = function (btn) {
    document.querySelectorAll('.kebab-menu').forEach(menu => {
      if (menu !== btn.nextElementSibling) menu.style.display = 'none';
    });
    const menu = btn.nextElementSibling;
    menu.style.display = menu.style.display === 'block' ? 'none' : 'block';
  };

  window.shareMaterial = async function (materialId, materialName) {
    const shareUrl = new URL('./pdf.html', window.location.href);
    // A shared item is not restricted to the recipient's default level or the sender's desk.
    shareUrl.searchParams.set('level', 'all');
    shareUrl.searchParams.set('material', materialId);
    const shareData = {
      title: materialName,
      text: `View ${materialName} on LegalHub`,
      url: shareUrl.href,
    };

    try {
      if (navigator.share) {
        await navigator.share(shareData);
        return;
      }

      await navigator.clipboard.writeText(shareUrl.href);
      alert('Material link copied to your clipboard.');
    } catch (error) {
      if (error.name !== 'AbortError') {
        alert('Could not share this material. Please copy the link from your browser.');
      }
    }
  };

  document.addEventListener('click', () => {
    document.querySelectorAll('.kebab-menu').forEach(menu => menu.style.display = 'none');
  });

  grid.addEventListener('click', async event => {
    const button=event.target.closest('button[data-book-action]');
    if(!button||!grid.contains(button))return;
    event.stopPropagation();
    const card=button.closest('.book-card'), book=filteredBooks[Number(card?.dataset.bookIndex)];
    if(!book)return;
    switch(button.dataset.bookAction){
      case 'menu': window.toggleKebabMenu(button);break;
      case 'read': window.open(book.url,'_blank','noopener,noreferrer');break;
      case 'download': await window.downloadPDF(book.url,book.materialName);break;
      case 'share': await window.shareMaterial(book.materialId,book.materialName);break;
      case 'delete':
        if(!isAdmin||!viewerId)return;
        try {
          const {reviewMaterial}=await import('./materials/review.mjs');
          if(await reviewMaterial(supabaseClient,{actor:viewerId,item:book.reviewItem,action:'delete'})){
            coverCache.delete(book.materialId);
            books=books.filter(b=>b.materialId!==book.materialId);updateCourseFilters();
          }
        }catch(error){alert(error.message||'Could not review the material. Reload to try again.');}
        break;
    }
  });
})();
