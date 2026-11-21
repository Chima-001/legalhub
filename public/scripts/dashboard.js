(function() {
    'use strict';

    if (typeof loadHeaderAvatar === 'function' && typeof supabaseClient !== 'undefined' && supabaseClient) {
        loadHeaderAvatar(document.getElementById('header-avatar')).catch(() => {});
    }

    // ─── CAROUSEL ───
    const track = document.getElementById('carouselTrack');
    const prevBtn = document.getElementById('carouselPrev');
    const nextBtn = document.getElementById('carouselNext');
    const slides = track ? track.querySelectorAll('.carousel-slide') : [];
    const total = slides.length;
    let current = 0;
    let autoPlayTimer = null;
    const INTERVAL = 5000;

    function goTo(index) {
        if (!track || total === 0) return;
        if (index < 0) index = total - 1;
        if (index >= total) index = 0;
        current = index;
        slides.forEach((slide, slideIndex) => {
            slide.classList.toggle('is-active', slideIndex === current);
        });
        track.style.transform = 'translateX(-' + (current * 100) + '%)';
        resetAutoPlay();
    }

    function next() { goTo(current + 1); }

    function prev() { goTo(current - 1); }

    function startAutoPlay() {
        if (total <= 1) return;
        stopAutoPlay();
        autoPlayTimer = setInterval(next, INTERVAL);
    }

    function stopAutoPlay() {
        if (autoPlayTimer) { clearInterval(autoPlayTimer);
            autoPlayTimer = null; }
    }

    function resetAutoPlay() {
        if (total <= 1) return;
        stopAutoPlay();
        startAutoPlay();
    }

    const wrap = document.querySelector('.carousel-wrap');
    const hideCarouselControls = total <= 1;

    if (prevBtn) prevBtn.hidden = hideCarouselControls;
    if (nextBtn) nextBtn.hidden = hideCarouselControls;

    if (track && wrap && total > 1) {
        wrap.addEventListener('mouseenter', stopAutoPlay);
        wrap.addEventListener('mouseleave', startAutoPlay);
        wrap.addEventListener('touchstart', stopAutoPlay, { passive: true });
        wrap.addEventListener('touchend', startAutoPlay, { passive: true });

        if (nextBtn) {
            nextBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                next();
            });
        }
        if (prevBtn) {
            prevBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                prev();
            });
        }

        wrap.addEventListener('keydown', (e) => {
            if (e.key === 'ArrowRight') {
                e.preventDefault();
                next();
            }
            if (e.key === 'ArrowLeft') {
                e.preventDefault();
                prev();
            }
        });
    }

    if (track && total > 0) {
        goTo(0);
        startAutoPlay();
    }

    const greeting = document.getElementById('greeting-text');
    if (greeting) {
        const hour = new Date().getHours();
        const timeGreeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
        greeting.textContent = timeGreeting + ', student';
        if (typeof supabaseClient !== 'undefined' && supabaseClient) {
            supabaseClient.auth.getSession().then(async ({ data: { session } }) => {
                if (!session) return;
                const { data: user } = await supabaseClient
                    .from('users')
                    .select('username, full_name')
                    .eq('id', session.user.id)
                    .single();
                const username = user?.username?.trim() || user?.full_name?.trim();
                if (username) greeting.textContent = timeGreeting + ', ' + username;
            }).catch(() => {}); // The general greeting remains usable offline.
        }
    }

})();
