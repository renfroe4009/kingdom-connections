/**
 * Kingdom Connections — vanilla JS behaviors
 * All hooks use data attributes so a visual builder can re-render markup safely.
 */
(function () {
  "use strict";

  const COOKIE_NAME = "analytics_consent";
  const STORAGE_KEY = "kc_analytics_consent";
  const COOKIE_DAYS = 365;

  /* ---------- Helpers ---------- */
  function qs(sel, root) {
    return (root || document).querySelector(sel);
  }
  function qsa(sel, root) {
    return Array.from((root || document).querySelectorAll(sel));
  }

  function setCookie(name, value, days) {
    const maxAge = days * 24 * 60 * 60;
    const secure = location.protocol === "https:" ? "; Secure" : "";
    // SameSite=Lax works on http://localhost; Strict can fail in some local setups
    document.cookie =
      name +
      "=" +
      encodeURIComponent(value) +
      "; Max-Age=" +
      maxAge +
      "; Path=/; SameSite=Lax" +
      secure;
  }

  function getCookie(name) {
    const match = document.cookie.match(
      new RegExp("(?:^|; )" + name.replace(/([.$?*|{}()[\]\\/+^])/g, "\\$1") + "=([^;]*)")
    );
    return match ? decodeURIComponent(match[1]) : null;
  }

  /** Persist consent in localStorage (primary) + cookie (secondary).
   *  localStorage is required so a one-time choice sticks when opening
   *  index.html via file:// where cookies often do not save. */
  function getConsent() {
    try {
      const ls = localStorage.getItem(STORAGE_KEY);
      if (ls) return ls;
    } catch (e) {
      /* private mode / blocked storage */
    }
    return getCookie(COOKIE_NAME);
  }

  function setConsent(value) {
    try {
      localStorage.setItem(STORAGE_KEY, value);
    } catch (e) {
      /* ignore */
    }
    setCookie(COOKIE_NAME, value, COOKIE_DAYS);
  }

  function prefersDNT() {
    return (
      navigator.doNotTrack === "1" ||
      window.doNotTrack === "1" ||
      navigator.msDoNotTrack === "1"
    );
  }

  /* ---------- Mobile nav ---------- */
  function initNav() {
    const toggle = qs("[data-toggle='nav']");
    const drawer = qs("[data-nav-drawer]");
    if (!toggle || !drawer) return;

    function close() {
      toggle.setAttribute("aria-expanded", "false");
      drawer.classList.remove("is-open");
      document.body.classList.remove("nav-open");
    }

    function open() {
      toggle.setAttribute("aria-expanded", "true");
      drawer.classList.add("is-open");
      document.body.classList.add("nav-open");
    }

    toggle.addEventListener("click", function () {
      const expanded = toggle.getAttribute("aria-expanded") === "true";
      if (expanded) close();
      else open();
    });

    qsa("a", drawer).forEach(function (link) {
      link.addEventListener("click", close);
    });

    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") close();
    });

    window.addEventListener("resize", function () {
      if (window.innerWidth >= 1024) close();
    });
  }

  /* ---------- Current page highlight ---------- */
  function initActiveNav() {
    const path = (location.pathname.split("/").pop() || "index.html").toLowerCase();
    qsa("[data-nav] a").forEach(function (a) {
      const href = (a.getAttribute("href") || "").split("/").pop().toLowerCase();
      if (
        href === path ||
        (path === "" && href === "index.html") ||
        (path === "index.html" && href === "index.html")
      ) {
        a.setAttribute("aria-current", "page");
      }
    });
  }

  /* ---------- Testimonial carousel ---------- */
  function initCarousels() {
    qsa("[data-carousel]").forEach(function (root) {
      const items = qsa("[data-carousel-item]", root);
      const dots = qsa("[data-carousel-dot]", root);
      const prev = qs("[data-carousel-prev]", root);
      const nextBtn = qs("[data-carousel-next]", root);
      if (items.length < 2) return;

      let index = 0;
      let timer;

      function show(i) {
        index = (i + items.length) % items.length;
        // Desktop: both cards stay visible (mockup shows a pair)
        if (window.innerWidth >= 600) {
          items.forEach(function (el) {
            el.hidden = false;
          });
        } else {
          items.forEach(function (el, n) {
            el.hidden = n !== index;
          });
        }
        dots.forEach(function (d, n) {
          d.setAttribute("aria-current", n === index ? "true" : "false");
        });
      }

      dots.forEach(function (dot, n) {
        dot.addEventListener("click", function () {
          show(n);
          restart();
        });
      });

      if (prev) {
        prev.addEventListener("click", function () {
          show(index - 1);
          restart();
        });
      }
      if (nextBtn) {
        nextBtn.addEventListener("click", function () {
          show(index + 1);
          restart();
        });
      }

      function next() {
        show(index + 1);
      }

      function restart() {
        clearInterval(timer);
        timer = setInterval(next, 7000);
      }

      show(0);
      restart();
      window.addEventListener("resize", function () {
        show(index);
      });
    });
  }

  /* ---------- Smooth scroll for in-page anchors ---------- */
  function initSmoothAnchors() {
    qsa('a[href^="#"]').forEach(function (a) {
      a.addEventListener("click", function (e) {
        const id = a.getAttribute("href");
        if (!id || id === "#") return;
        const target = qs(id);
        if (!target) return;
        e.preventDefault();
        target.scrollIntoView({ behavior: "smooth", block: "start" });
        target.setAttribute("tabindex", "-1");
        target.focus({ preventScroll: true });
      });
    });
  }

  /* ---------- Cookie / analytics consent ---------- */
  function loadAnalytics() {
    if (window.__kcAnalyticsLoaded) return;
    window.__kcAnalyticsLoaded = true;
    // Placeholder: wire GA / Plausible / PostHog only after opt-in.
    // Example (disabled by default):
    // var s = document.createElement('script');
    // s.src = 'https://www.googletagmanager.com/gtag/js?id=G-XXXXXXXX';
    // s.async = true;
    // document.head.appendChild(s);
    console.info("[KC] Analytics enabled by user consent.");
  }

  function initCookieBanner() {
    const banner = qs("[data-cookie-banner]");
    if (!banner) return;

    const acceptBtn = qs("[data-cookie-accept]", banner);
    const rejectBtn = qs("[data-cookie-reject]", banner);
    const customizeBtn = qs("[data-cookie-customize]", banner);
    const saveBtn = qs("[data-cookie-save]", banner);
    const prefs = qs("[data-cookie-prefs]", banner);
    const analyticsToggle = qs("[data-cookie-analytics]", banner);
    const reopenLinks = qsa("[data-cookie-settings]");

    function hideBanner() {
      banner.classList.remove("is-visible");
      banner.setAttribute("hidden", "");
      banner.setAttribute("aria-hidden", "true");
    }

    function showBanner() {
      banner.removeAttribute("hidden");
      banner.setAttribute("aria-hidden", "false");
      banner.classList.add("is-visible");
      if (analyticsToggle) {
        const current = getConsent();
        analyticsToggle.checked =
          current === "accepted" || current === "analytics";
      }
    }

    function applyConsent(value) {
      // One-time decision: stored permanently until user opens Cookie Settings
      setConsent(value);
      hideBanner();
      if (value === "accepted" || value === "analytics") {
        loadAnalytics();
      }
    }

    // Always start hidden; only show when no prior decision exists
    hideBanner();

    const existing = getConsent();
    if (!existing) {
      // First visit only — optional DNT pre-checks analytics off in Customize
      if (prefersDNT() && analyticsToggle) {
        analyticsToggle.checked = false;
      }
      showBanner();
    } else if (existing === "accepted" || existing === "analytics") {
      loadAnalytics();
    }
    // If existing is "rejected" (or any other saved value): do not show again

    if (acceptBtn) {
      acceptBtn.addEventListener("click", function () {
        applyConsent("accepted");
      });
    }
    if (rejectBtn) {
      rejectBtn.addEventListener("click", function () {
        applyConsent("rejected");
      });
    }
    if (customizeBtn && prefs) {
      customizeBtn.addEventListener("click", function () {
        prefs.classList.toggle("is-open");
        customizeBtn.setAttribute(
          "aria-expanded",
          prefs.classList.contains("is-open") ? "true" : "false"
        );
      });
    }
    if (saveBtn) {
      saveBtn.addEventListener("click", function () {
        const on = analyticsToggle && analyticsToggle.checked;
        applyConsent(on ? "analytics" : "rejected");
      });
    }

    // Footer "Cookie Settings" is the only way to re-open after a decision
    reopenLinks.forEach(function (link) {
      link.addEventListener("click", function (e) {
        e.preventDefault();
        showBanner();
        if (prefs) {
          prefs.classList.add("is-open");
          if (customizeBtn) customizeBtn.setAttribute("aria-expanded", "true");
        }
      });
    });
  }

  /* ---------- Contact / join form (client-side only) ---------- */
  function initForms() {
    qsa("[data-form]").forEach(function (form) {
      form.addEventListener("submit", function (e) {
        e.preventDefault();
        const status = qs("[data-form-status]", form);
        if (!form.checkValidity()) {
          form.reportValidity();
          return;
        }
        if (status) {
          status.hidden = false;
          status.textContent =
            "Thank you! Your message has been prepared. Connect this form to your backend or email service to go live.";
          status.focus();
        }
        form.reset();
      });
    });
  }

  /* ---------- Year in footer ---------- */
  function initYear() {
    qsa("[data-year]").forEach(function (el) {
      el.textContent = String(new Date().getFullYear());
    });
  }

  document.addEventListener("DOMContentLoaded", function () {
    initNav();
    initActiveNav();
    initCarousels();
    initSmoothAnchors();
    initCookieBanner();
    initForms();
    initYear();
  });
})();
