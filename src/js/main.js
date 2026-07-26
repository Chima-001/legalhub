 (function() {
            'use strict';

            // ─── PRELOADER ───
            const preloader = document.getElementById('preloader');
            const preloaderFill = document.getElementById('preloaderFill');
            const startTime = Date.now();
            const MIN_DISPLAY_TIME = 5000; // 5 seconds

            // Animate progress bar from 0 to 100 over 5 seconds
            let progress = 0;
            const startProgress = Date.now();
            const updateProgress = () => {
                const elapsed = Date.now() - startProgress;
                progress = Math.min((elapsed / MIN_DISPLAY_TIME) * 100, 100);
                preloaderFill.style.width = progress + '%';

                if (progress < 100) {
                    requestAnimationFrame(updateProgress);
                }
            };
            requestAnimationFrame(updateProgress);

            // When the page is fully loaded, ensure the preloader stays for at least MIN_DISPLAY_TIME
            window.addEventListener('load', function() {
                const elapsed = Date.now() - startTime;
                const remaining = Math.max(MIN_DISPLAY_TIME - elapsed, 0);

                // Ensure progress bar is at 100% before hiding
                preloaderFill.style.width = '100%';

                setTimeout(function() {
                    preloader.classList.add('hidden');
                    // Allow body content to animate in
                    document.querySelectorAll('.rise').forEach(el => {
                        el.style.animationPlayState = 'running';
                    });
                }, remaining);
            });

            // Fallback: if load takes too long, force hide after 6 seconds total (5s min + 1s buffer)
            setTimeout(function() {
                if (!preloader.classList.contains('hidden')) {
                    preloaderFill.style.width = '100%';
                    setTimeout(function() {
                        preloader.classList.add('hidden');
                        document.querySelectorAll('.rise').forEach(el => {
                            el.style.animationPlayState = 'running';
                        });
                    }, 400);
                }
            }, MIN_DISPLAY_TIME + 1000);

            // ─── CAROUSEL ───
            const track = document.getElementById('carouselTrack');
            const prevBtn = document.getElementById('carouselPrev');
            const nextBtn = document.getElementById('carouselNext');
            const slides = track.querySelectorAll('.carousel-slide');
            const total = slides.length;
            let current = 0;
            let autoPlayTimer = null;
            const INTERVAL = 5000;

            function goTo(index) {
                if (index < 0) index = total - 1;
                if (index >= total) index = 0;
                current = index;
                track.style.transform = 'translateX(-' + (current * 100) + '%)';
                resetAutoPlay();
            }

            function next() { goTo(current + 1); }

            function prev() { goTo(current - 1); }

            function startAutoPlay() {
                stopAutoPlay();
                autoPlayTimer = setInterval(next, INTERVAL);
            }

            function stopAutoPlay() {
                if (autoPlayTimer) { clearInterval(autoPlayTimer);
                    autoPlayTimer = null; }
            }

            function resetAutoPlay() {
                stopAutoPlay();
                startAutoPlay();
            }

            const wrap = document.querySelector('.carousel-wrap');
            wrap.addEventListener('mouseenter', stopAutoPlay);
            wrap.addEventListener('mouseleave', startAutoPlay);
            wrap.addEventListener('touchstart', stopAutoPlay, { passive: true });
            wrap.addEventListener('touchend', startAutoPlay, { passive: true });

            nextBtn.addEventListener('click', (e) => { e.stopPropagation();
                next(); });
            prevBtn.addEventListener('click', (e) => { e.stopPropagation();
                prev(); });

            wrap.addEventListener('keydown', (e) => {
                if (e.key === 'ArrowRight') { e.preventDefault();
                    next(); }
                if (e.key === 'ArrowLeft') { e.preventDefault();
                    prev(); }
            });

            goTo(0);
            startAutoPlay();

            // ─── Greeting + semester progress ───
            (function initGreeting() {
                const hour = new Date().getHours();
                const g = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
                document.getElementById('greeting-text').textContent = g + ' 👋';

                const start = new Date('2026-05-01');
                const end = new Date('2026-09-15');
                const now = new Date();
                const total = end - start;
                const done = Math.min(Math.max(now - start, 0), total);
                const pct = total > 0 ? Math.round((done / total) * 100) : 0;
                const daysLeft = Math.max(Math.ceil((end - now) / (1000 * 60 * 60 * 24)), 0);

                document.getElementById('term-fill').style.width = pct + '%';
                document.getElementById('term-percent').textContent = pct + '%';
                document.getElementById('term-countdown').textContent =
                    daysLeft > 0 ? daysLeft + ' days left until exams — keep going.' : 'Exam period is here — good luck!';
            })();

            // ─── toast ───
            const toastEl = document.getElementById('toast');
            let toastTimer;

            function showToast(msg) {
                toastEl.textContent = msg;
                toastEl.classList.add('show');
                clearTimeout(toastTimer);
                toastTimer = setTimeout(() => toastEl.classList.remove('show'), 1800);
            }

            // ─── courses ───
            const courses = Array.from(document.querySelectorAll('.course'));
            const recentlyViewed = [];
            const starred = new Set();

            // accordion
            courses.forEach(course => {
                const left = course.querySelector('.course-head-left');
                const chev = course.querySelector('.chevron');
                const toggle = () => {
                    const isOpen = course.classList.toggle('open');
                    if (isOpen) trackRecentlyViewed(course.dataset.name);
                };
                left.addEventListener('click', toggle);
                chev.addEventListener('click', toggle);
            });

            function trackRecentlyViewed(name) {
                const i = recentlyViewed.indexOf(name);
                if (i > -1) recentlyViewed.splice(i, 1);
                recentlyViewed.unshift(name);
                if (recentlyViewed.length > 5) recentlyViewed.pop();
                renderRecent();
            }

            function courseHue(name) {
                const map = {
                    'Legal Method': '#4a6cf7',
                    'Customary Law': '#ff9d5c',
                    'Philosophy': '#34c759',
                    'Psychology': '#7c5cfc',
                    'Intro to Nigerian Literature': '#ffd25c',
                    'Communication in English': '#5ac8fa'
                };
                return map[name] || '#4a6cf7';
            }

            function courseInitials(name) {
                const map = {
                    'Legal Method': 'LM',
                    'Customary Law': 'CL',
                    'Philosophy': 'PH',
                    'Psychology': 'PS',
                    'Intro to Nigerian Literature': 'LIT',
                    'Communication in English': 'CIE'
                };
                return map[name] || name.slice(0, 2).toUpperCase();
            }

            function renderRecent() {
                const panel = document.getElementById('recent-panel');
                const row = document.getElementById('recent-row');
                if (recentlyViewed.length === 0) { panel.hidden = true; return; }
                panel.hidden = false;
                row.innerHTML = recentlyViewed.map(name =>
                    '<div class="thumb" data-jump="' + name + '">' +
                    '<div class="thumb-sq" style="background:' + courseHue(name) + ';">' + courseInitials(name) +
                    '</div>' +
                    '<div class="thumb-label">' + name + '</div>' +
                    '</div>'
                ).join('');
                wireJumpThumbs(row);
            }

            function renderStarred() {
                const panel = document.getElementById('starred-panel');
                const row = document.getElementById('starred-row');
                const sub = document.getElementById('starred-sub');
                if (starred.size === 0) { panel.hidden = true; return; }
                panel.hidden = false;
                sub.textContent = starred.size + ' course' + (starred.size === 1 ? '' : 's') + ' starred';
                row.innerHTML = Array.from(starred).map(name =>
                    '<div class="thumb" data-jump="' + name + '">' +
                    '<div class="thumb-sq" style="background:' + courseHue(name) + ';">' + courseInitials(name) +
                    '</div>' +
                    '<div class="thumb-label">' + name + '</div>' +
                    '<div class="star-badge">⭐</div>' +
                    '</div>'
                ).join('');
                wireJumpThumbs(row);
            }

            function jumpToCourse(name) {
                const course = courses.find(c => c.dataset.name === name);
                if (!course) return;
                course.classList.add('open');
                trackRecentlyViewed(name);
                course.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }

            function wireJumpThumbs(scope) {
                scope.querySelectorAll('.thumb[data-jump]').forEach(t => {
                    t.addEventListener('click', () => jumpToCourse(t.dataset.jump));
                });
            }
            wireJumpThumbs(document);

            // star toggle
            document.querySelectorAll('.star-btn').forEach(btn => {
                const course = btn.closest('.course');
                const name = course.dataset.name;
                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    if (starred.has(name)) {
                        starred.delete(name);
                        btn.classList.remove('starred');
                        showToast('Removed ' + name + ' from starred');
                    } else {
                        starred.add(name);
                        btn.classList.add('starred');
                        showToast('Starred ' + name);
                    }
                    renderStarred();
                });
            });

            // copy link
            document.querySelectorAll('.copy-btn').forEach(btn => {
                btn.addEventListener('click', async (e) => {
                    e.stopPropagation();
                    const url = btn.dataset.url;
                    try {
                        await navigator.clipboard.writeText(url);
                        showToast('Link copied');
                    } catch (_) {
                        showToast('Could not copy — long-press the link instead');
                    }
                });
            });

            // request material
            document.querySelectorAll('.request-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    const course = btn.dataset.course;
                    const subject = encodeURIComponent('Course material request — ' + course);
                    const body = encodeURIComponent('Hi,\n\nCould we get materials uploaded for ' + course +
                        ' (030 Legal Hub)?\n\nThanks!');
                    window.location.href =
                        'mailto:academicdirectors@030legalhub.example?subject=' + subject + '&body=' + body;
                });
            });

            // ─── filter chips & search ───
            const chips = Array.from(document.querySelectorAll('.chip'));
            const searchInput = document.getElementById('search');
            const noResults = document.getElementById('no-results');
            const searchMeta = document.getElementById('search-meta');
            const coursesSection = document.getElementById('courses');

            chips.forEach(chip => {
                chip.addEventListener('click', () => {
                    chips.forEach(c => c.classList.remove('active'));
                    chip.classList.add('active');
                    searchInput.value = chip.dataset.filter;
                    runSearch();
                    // scroll down to courses
                    if (coursesSection) {
                        coursesSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
                    }
                });
            });

            function clearHighlights(el) {
                el.querySelectorAll('mark').forEach(m => {
                    const parent = m.parentNode;
                    parent.replaceChild(document.createTextNode(m.textContent), m);
                    parent.normalize();
                });
            }

            function highlight(el, query) {
                const q = query.trim();
                if (!q) return;
                const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null);
                const nodes = [];
                let n;
                while ((n = walker.nextNode())) nodes.push(n);
                const re = new RegExp('(' + q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'ig');
                nodes.forEach(node => {
                    if (!re.test(node.nodeValue)) return;
                    re.lastIndex = 0;
                    const span = document.createElement('span');
                    span.innerHTML = node.nodeValue.replace(re, '<mark>$1</mark>');
                    node.parentNode.replaceChild(span, node);
                });
            }

            function runSearch() {
                const q = searchInput.value.trim().toLowerCase();
                let visibleCourses = 0;
                let matchedResourceCount = 0;

                courses.forEach(course => {
                    const courseName = course.dataset.name.toLowerCase();
                    const items = Array.from(course.querySelectorAll('.resources li'));
                    clearHighlights(course.querySelector('.course-name'));
                    items.forEach(li => { clearHighlights(li);
                        li.hidden = false; });

                    if (!q) { course.hidden = false; return; }

                    const courseMatches = courseName.includes(q);
                    let anyItemMatches = false;

                    items.forEach(li => {
                        const itemName = li.dataset.name.toLowerCase();
                        const itemMatches = itemName.includes(q);
                        if (itemMatches) { anyItemMatches = true;
                            matchedResourceCount++;
                            highlight(li, q); }
                        li.hidden = !(courseMatches || itemMatches);
                    });

                    const show = courseMatches || anyItemMatches;
                    course.hidden = !show;

                    if (show) {
                        visibleCourses++;
                        course.classList.add('open');
                        if (courseMatches) highlight(course.querySelector('.course-name'), q);
                    }
                });

                if (!q) {
                    searchMeta.classList.remove('active');
                    noResults.classList.remove('active');
                    return;
                }

                searchMeta.classList.add('active');
                searchMeta.textContent = visibleCourses ?
                    visibleCourses + ' course' + (visibleCourses === 1 ? '' : 's') + ', ' + matchedResourceCount +
                    ' matching resource' + (matchedResourceCount === 1 ? '' : 's') :
                    'No matches';
                noResults.classList.toggle('active', visibleCourses === 0);
            }

            searchInput.addEventListener('input', () => {
                if (searchInput.value.trim() === '') {
                    chips.forEach(c => c.classList.remove('active'));
                    chips[0].classList.add('active');
                } else {
                    const match = chips.find(c => c.dataset.filter.toLowerCase() === searchInput.value.trim()
                        .toLowerCase());
                    chips.forEach(c => c.classList.toggle('active', c === match));
                }
                runSearch();
            });

            // ─── keyboard shortcuts ───
            document.addEventListener('keydown', (e) => {
                if (e.key === '/' && document.activeElement !== searchInput) {
                    e.preventDefault();
                    searchInput.focus();
                }
                if (e.key === 'Escape' && document.activeElement === searchInput) {
                    searchInput.value = '';
                    searchInput.blur();
                    chips.forEach(c => c.classList.remove('active'));
                    chips[0].classList.add('active');
                    runSearch();
                }
            });

            // ─── smooth nav clicks ───
            document.querySelectorAll('.nav-links a').forEach(link => {
                link.addEventListener('click', (e) => {
                    document.querySelectorAll('.nav-links a').forEach(l => l.classList.remove('active'));
                    link.classList.add('active');
                });
            });

        })();