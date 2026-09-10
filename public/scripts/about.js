/* =========================================
   CURRENT YEAR
========================================= */

const year = document.querySelector("#year");

if (year) {
    year.textContent = new Date().getFullYear();
}

document.getElementById("back-link").addEventListener("click", (e) => {
    e.preventDefault();
    if (document.referrer && document.referrer.includes(window.location.host)) {
        history.back();
    } else {
        window.location.href = "../index.html";
    }
});

/* =========================================
   SCROLL REVEAL
========================================= */

const revealElements = document.querySelectorAll(
    ".developer-card, .contribution, .section-heading, .philosophy-content, .cta-card"
);

const observer = new IntersectionObserver(
    (entries, observer) => {

        entries.forEach((entry) => {

            if (!entry.isIntersecting) {
                return;
            }

            entry.target.style.opacity = "1";
            entry.target.style.transform = "translateY(0)";

            observer.unobserve(entry.target);
        });

    },
    {
        threshold: 0.12
    }
);


/* Initial state */

revealElements.forEach((element) => {

    element.style.opacity = "0";
    element.style.transform = "translateY(30px)";

    element.style.transition =
        "opacity 0.7s ease, transform 0.7s ease";

    observer.observe(element);

});