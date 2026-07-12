 // ===== PRELOADER =====
    window.addEventListener('load', function() {
      const preloader = document.getElementById('preloader');
      setTimeout(function() {
        preloader.classList.add('loaded');
      }, 1500);
    });

    // ===== SIDEBAR TOGGLE =====
    const menuIcon = document.querySelector('.menu-icon');
    const sidebar = document.getElementById('sidebar');
    const sidebarOverlay = document.getElementById('sidebarOverlay');
    const closeSidebar = document.getElementById('closeSidebar');

    function openSidebar() {
      sidebar.classList.add('open');
      sidebarOverlay.classList.add('active');
      document.body.style.overflow = 'hidden';
    }
    function closeSidebarFunc() {
      sidebar.classList.remove('open');
      sidebarOverlay.classList.remove('active');
      document.body.style.overflow = '';
    }
    menuIcon.addEventListener('click', openSidebar);
    closeSidebar.addEventListener('click', closeSidebarFunc);
    sidebarOverlay.addEventListener('click', closeSidebarFunc);

    document.addEventListener('keydown', function(e) {
      if (e.key === 'Escape' && sidebar.classList.contains('open')) {
        closeSidebarFunc();
      }
    });

    // ===== SEARCH TOGGLE =====
    const searchToggle = document.getElementById('searchToggle');
    const searchBar = document.getElementById('searchBar');

    searchToggle.addEventListener('click', function(e) {
      e.stopPropagation();
      searchBar.classList.toggle('active');
      if (searchBar.classList.contains('active')) {
        setTimeout(() => searchBar.querySelector('input').focus(), 100);
      }
    });

    // ===== DROPDOWN TOGGLE =====
    document.querySelectorAll('.course-header').forEach(header => {
      header.addEventListener('click', function(e) {
        const targetId = this.getAttribute('data-target');
        const dropdown = document.getElementById(targetId);
        const arrow = this.querySelector('.arrow');
        if (!dropdown) return;

        // close others
        document.querySelectorAll('.dropdown-menu').forEach(menu => {
          if (menu.id !== targetId) menu.classList.remove('open');
        });
        document.querySelectorAll('.arrow').forEach(a => {
          if (a !== arrow) a.classList.remove('open');
        });

        const isOpen = dropdown.classList.contains('open');
        dropdown.classList.toggle('open');
        arrow.classList.toggle('open');
      });
    });

    // ===== SUB-ITEM CLICK (silent) =====
    document.querySelectorAll('.sub-item').forEach(item => {
      item.addEventListener('click', function(e) {
        e.stopPropagation();
      });
    });

    // ===== CLICK OUTSIDE TO CLOSE ALL =====
    document.addEventListener('click', function(e) {
      const isInside = e.target.closest('.header') ||
        e.target.closest('.search-bar') ||
        e.target.closest('.course-item') ||
        e.target.closest('.content');
      if (!isInside) {
        searchBar.classList.remove('active');
        document.querySelectorAll('.dropdown-menu').forEach(menu => menu.classList.remove('open'));
        document.querySelectorAll('.arrow').forEach(a => a.classList.remove('open'));
      }
    });

    // ===== ESC KEY =====
    document.addEventListener('keydown', function(e) {
      if (e.key === 'Escape') {
        searchBar.classList.remove('active');
        document.querySelectorAll('.dropdown-menu').forEach(menu => menu.classList.remove('open'));
        document.querySelectorAll('.arrow').forEach(a => a.classList.remove('open'));
      }
    });