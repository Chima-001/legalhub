 (function() {
      'use strict';

      // ─── 1. CONFIGURATION ──────────────────────────────────────────

      const ALL_COURSES = [
        'All',
        'legal method',
        'Customary law',
        'philosophy',
        'psychology',
        'communication in English',
        'natural Science',
        'logics',
        'ELS'
      ];

      const PDF_JS_VERSION = '3.11.174';
      pdfjsLib.GlobalWorkerOptions.workerSrc =
        `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${PDF_JS_VERSION}/pdf.worker.min.js`;

      const PDF_FOLDER = '../assets/pdfs/';

      // Map your PDF filenames to course names
      const FILE_COURSE_MAP = {
        "TAMARA.pdf": "communication in English",
        "Legal Methods 7-11.pdf": "legal method",
        "Customary Land Tenure System II.pdf": "Customary law",
        "Customary_Land_Tenure_System_Merged.pdf": "Customary law",
      };

      const PDF_FILES = Object.keys(FILE_COURSE_MAP);

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

      function generateBookData(fileName) {
        const clean = fileName.split('/').pop().replace(/\.pdf$/i, '');
        let courseName = FILE_COURSE_MAP[fileName] || 'communication in English';

        const words = clean.split(/[-_\s]+/).filter(w => w.length > 0);
        const title = words
          .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
          .join(' ');

        const style = COURSE_STYLES[courseName] || DEFAULT_STYLE;

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

      let books = PDF_FILES.map(f => generateBookData(f));
      let filteredBooks = [...books];
      let activeFilter = 'All';
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
        const filePath = PDF_FOLDER + book.fileName;
        const canvas = container.querySelector('canvas');
        const placeholder = container.querySelector('.cover-placeholder');
        const fallback = container.querySelector('.cover-fallback');

        if (coverCache.has(book.fileName)) {
          const dataUrl = coverCache.get(book.fileName);
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
          coverCache.set(book.fileName, dataUrl);
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

      window.downloadPDF = function(filePath) {
        const link = document.createElement('a');
        link.href = filePath;
        link.download = filePath.split('/').pop();
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      };

      // ─── 6. BUILD UI COMPONENTS ────────────────────────────────────

      function buildFilterChips() {
        let html = '';
        ALL_COURSES.forEach(course => {
          const activeClass = course === activeFilter ? 'active' : '';
          html += `<button class="filter-chip ${activeClass}" data-filter="${course}">${course}</button>`;
        });
        filterChipsContainer.innerHTML = html;

        document.querySelectorAll('.filter-chip').forEach(chip => {
          chip.addEventListener('click', function() {
            setActiveFilter(this.dataset.filter);
          });
        });
      }

      function buildMobileList() {
        let html = '';
        ALL_COURSES.forEach(course => {
          const activeClass = course === activeFilter ? 'active' : '';
          html += `<div class="sheet-course-item ${activeClass}" data-filter="${course}">${course}</div>`;
        });
        mobileListContainer.innerHTML = html;

        document.querySelectorAll('.sheet-course-item').forEach(item => {
          item.addEventListener('click', function() {
            setActiveFilter(this.dataset.filter);
            closeBottomSheet();
          });
        });
      }

      // ─── 7. FILTER LOGIC ───────────────────────────────────────────

      function setActiveFilter(filter) {
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
        filteredBooks = books.filter(book => {
          const matchFilter = activeFilter === 'All' || book.courseName === activeFilter;
          const matchSearch = searchTerm === '' ||
            book.displayName.toLowerCase().includes(searchTerm) ||
            book.courseName.toLowerCase().includes(searchTerm) ||
            book.raw.includes(searchTerm);
          return matchFilter && matchSearch;
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
        filteredBooks.forEach((book) => {
          const filePath = PDF_FOLDER + book.fileName;
          const id = 'cover-' + book.fileName.replace(/[^a-zA-Z0-9]/g, '_');

          html += `
            <div class="book-card"
                 style="--spine-color: ${book.spineColor}; --cover-bg: ${book.coverBg};"
                 data-filename="${book.fileName}"
                 onclick="window.open('${filePath}', '_blank')"
                 title="Open ${book.displayName}">
              <div class="book-cover" id="${id}">
                <canvas></canvas>
                <div class="cover-placeholder">
                  <span class="cover-icon">${book.icon}</span>
                  <span class="cover-label">loading…</span>
                </div>
                <div class="cover-fallback">
                  <span class="fallback-icon">${book.icon}</span>
                  <div class="fallback-title">${book.displayName}</div>
                </div>
              </div>
              <div class="book-meta">
                <div class="book-title">${book.displayName}</div>
                <span class="course-tag">${book.courseName}</span>
                <div class="book-actions">
                  <button class="btn-read" onclick="event.stopPropagation(); window.open('${filePath}', '_blank');">📖 Read</button>
                  <button class="btn-download" onclick="event.stopPropagation(); downloadPDF('${filePath}');">⬇ Download</button>
                </div>
              </div>
            </div>
          `;
        });

        grid.innerHTML = html;

        const coverContainers = grid.querySelectorAll('.book-cover');
        coverContainers.forEach((container, idx) => {
          const card = container.closest('.book-card');
          const fileName = card.dataset.filename;
          const book = books.find(b => b.fileName === fileName);
          if (book) {
            setTimeout(() => renderCover(book, container), 80 + idx * 60);
          }
        });
      }

      // ─── 10. SEARCH & KEYBOARD ──────────────────────────────────────

      let searchTimeout;
      searchInput.addEventListener('input', function() {
        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(() => {
          searchTerm = this.value.trim().toLowerCase();
          render();
        }, 150);
      });

      document.addEventListener('keydown', (e) => {
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

      bottomSheetOverlay.addEventListener('click', function(e) {
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

      buildFilterChips();
      buildMobileList();
      render();
      console.log(`📚 Library ready · ${books.length} book(s) · ${ALL_COURSES.length - 1} courses`);
      console.log('💡 Click any card to open the PDF · Ctrl+K to search');
    })();