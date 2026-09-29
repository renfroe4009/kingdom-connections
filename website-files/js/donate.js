/**
 * Kingdom Connections — Join / donate checkout
 * Full 3-step gift flow matching the United Way donate UX, ready for Valor Passage.js.
 *
 * Wire-up (NetSimple / Valor):
 *   1. Set KC_VALOR.enabled = true
 *   2. Fill epi
 *   3. Point clientTokenUrl at your GetClientToken endpoint
 *   4. Point saleUrl at your Sale / recurring endpoint
 * Passage.js tokenizes the card into #valor-fields. Card data never posts to this page.
 */
(function () {
  "use strict";

  window.KC_VALOR = window.KC_VALOR || {
    enabled: false,
    epi: "",
    demo: true,
    clientTokenUrl: "/api/valor/client-token",
    saleUrl: "/api/valor/sale",
    scriptSrc: "https://js.valorpaytech.com/V1/js/Passage.min.js",
    feePercent: 2.9,
    feeFixed: 0.3,
  };

  var TIERS = {
    supporting: {
      label: "Supporting Membership",
      amounts: [50, 100, 250],
      popular: 100,
      impact: "Membership Portal Access, the 17 Day Discipleship Program, a Prayer Coin, and invitations to member webinars and events.",
    },
    founding: {
      label: "Founding Membership",
      amounts: [500, 1000, 1776],
      popular: 1000,
      impact: "Founding recognition, a logo gift, and VIP invitations to webinars and special events.",
    },
    partner: {
      label: "Partner Membership",
      amounts: [2500, 5000, 10000],
      popular: 5000,
      impact: "Partnership that expands prayer, connection, and the Word around the globe.",
    },
    general: {
      label: "General Donations",
      amounts: [25, 50, 100, 250, 500, 1000],
      popular: 100,
      impact: "Every gift helps Kingdom Connections connect, pray, and impact the world.",
    },
  };

  var THEME_KEY = "kc_donate_theme_v2";

  function qs(sel, root) {
    return (root || document).querySelector(sel);
  }
  function qsa(sel, root) {
    return Array.from((root || document).querySelectorAll(sel));
  }
  function money(n) {
    var v = Number(n) || 0;
    return v.toLocaleString("en-US", { style: "currency", currency: "USD" });
  }
  function feeFor(amount, cover) {
    if (!cover) return 0;
    var cfg = window.KC_VALOR;
    return Math.round((amount * (Number(cfg.feePercent) || 0) / 100 + (Number(cfg.feeFixed) || 0)) * 100) / 100;
  }

  function initDonate() {
    var root = qs("[data-donate]");
    if (!root) return;

    var form = qs("#donate-form", root);
    if (!form) return;

    var state = {
      step: 1,
      category: "supporting",
      frequency: "once",
      amount: 100,
      custom: "",
      coverFees: false,
      donor: {
        first: "",
        last: "",
        email: "",
        phone: "",
        address: "",
        city: "",
        state: "",
        zip: "",
        anonymous: false,
        updates: false,
      },
      agree: false,
      receiptId: "",
      error: "",
      processing: false,
      cardReady: false,
    };

    applyTheme("site");

    qsa("[data-donate-open]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var spec = btn.getAttribute("data-donate-open") || "";
        var parts = spec.split(":");
        if (parts[0] && TIERS[parts[0]]) {
          state.category = parts[0];
          if (parts[1]) {
            state.amount = Number(parts[1]);
            state.custom = "";
          } else {
            state.amount = TIERS[parts[0]].popular;
          }
          state.step = 1;
          render();
        }
      });
    });

    var themeBtn = qs("[data-donate-theme]", root);
    if (themeBtn) {
      themeBtn.addEventListener("click", function () {
        var next = root.getAttribute("data-donate-theme") === "patriotic" ? "site" : "patriotic";
        applyTheme(next);
        try {
          localStorage.setItem(THEME_KEY, next);
        } catch (e) {
          /* ignore */
        }
      });
    }

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      if (state.step !== 3) return;
      submitGift();
    });

    render();

    function applyTheme(name) {
      root.setAttribute("data-donate-theme", name === "patriotic" ? "patriotic" : "site");
      var btn = qs("[data-donate-theme]", root);
      if (btn) {
        var patriotic = name === "patriotic";
        btn.textContent = patriotic ? "View site colors" : "View patriotic colors";
        btn.setAttribute("aria-pressed", patriotic ? "true" : "false");
      }
    }

    function giftAmount() {
      var custom = Number(state.custom);
      if (state.custom !== "" && !isNaN(custom) && custom > 0) return custom;
      return Number(state.amount) || 0;
    }

    function fees() {
      return feeFor(giftAmount(), state.coverFees);
    }

    function total() {
      return Math.round((giftAmount() + fees()) * 100) / 100;
    }

    function setError(msg) {
      state.error = msg || "";
      var el = qs("[data-donate-error]", root);
      if (el) {
        if (state.error) {
          el.hidden = false;
          el.textContent = state.error;
        } else {
          el.hidden = true;
          el.textContent = "";
        }
      }
    }

    function go(step) {
      state.step = step;
      state.error = "";
      render();
      var panel = qs("[data-step='" + step + "']", root);
      var heading = panel && panel.querySelector("h2");
      if (heading) heading.focus();
    }

    function render() {
      qsa("[data-step]", root).forEach(function (panel) {
        panel.hidden = String(panel.getAttribute("data-step")) !== String(state.step);
      });
      qsa("[data-donate-tab]", root).forEach(function (tab) {
        var on = tab.getAttribute("data-donate-tab") === state.category;
        tab.classList.toggle("is-active", on);
        tab.setAttribute("aria-selected", on ? "true" : "false");
      });
      renderAmounts();
      renderFrequency();
      renderImpact();
      renderSummary();
      setError(state.error);
      var giveBtn = qs("[data-donate-give]", root);
      if (giveBtn) {
        giveBtn.disabled = state.processing;
        giveBtn.textContent = state.processing
          ? "Processing…"
          : "Give now · " + money(total());
      }
      var themeLabel = qs("[data-donate-theme]", root);
      if (themeLabel) {
        var patriotic = root.getAttribute("data-donate-theme") === "patriotic";
        themeLabel.textContent = patriotic ? "View site colors" : "View patriotic colors";
      }
      if (state.step === 3) initValorFields();
    }

    function renderFrequency() {
      qsa("[name='frequency']", root).forEach(function (input) {
        input.checked = input.value === state.frequency;
      });
    }

    function renderAmounts() {
      var grid = qs("[data-amount-grid]", root);
      if (!grid) return;
      var tier = TIERS[state.category];
      grid.innerHTML = "";
      tier.amounts.forEach(function (n) {
        var id = "amt-" + n;
        var label = document.createElement("label");
        label.className = "amount-option";
        var checked = state.custom === "" && state.amount === n;
        if (checked) label.classList.add("is-selected");
        label.innerHTML =
          '<input type="radio" name="gift-amount" value="' +
          n +
          '"' +
          (checked ? " checked" : "") +
          " />" +
          (n === tier.popular ? '<span class="popular-badge">Popular</span>' : "") +
          "<span>" +
          (n >= 1000 ? "$" + n.toLocaleString("en-US") : "$" + n) +
          "</span>";
        label.querySelector("input").addEventListener("change", function () {
          state.amount = n;
          state.custom = "";
          var customInput = qs("#donate-custom", root);
          if (customInput) customInput.value = "";
          render();
        });
        grid.appendChild(label);
      });
      var customInput = qs("#donate-custom", root);
      if (customInput && customInput.value !== state.custom) {
        customInput.value = state.custom;
      }
    }

    function renderImpact() {
      var el = qs("[data-donate-impact]", root);
      if (el) el.textContent = TIERS[state.category].impact;
    }

    function renderSummary() {
      var map = {
        gift: state.frequency === "monthly" ? "Monthly gift" : "One-time gift",
        amount: money(giftAmount()),
        designation: TIERS[state.category].label,
        fees: money(fees()),
        donor: (state.donor.first + " " + state.donor.last).trim() || "—",
        email: state.donor.email || "—",
        total: money(total()),
      };
      Object.keys(map).forEach(function (key) {
        qsa("[data-sum='" + key + "']", root).forEach(function (el) {
          el.textContent = map[key];
        });
      });
      var feeLabel = qs("[data-fee-label]", root);
      if (feeLabel) feeLabel.textContent = "Cover processing fees (" + money(feeFor(giftAmount(), true)) + ")";
    }

    qsa("[data-donate-tab]", root).forEach(function (tab) {
      tab.addEventListener("click", function () {
        var cat = tab.getAttribute("data-donate-tab");
        if (!TIERS[cat]) return;
        state.category = cat;
        state.amount = TIERS[cat].popular;
        state.custom = "";
        var customInput = qs("#donate-custom", root);
        if (customInput) customInput.value = "";
        render();
      });
    });

    qsa("[name='frequency']", root).forEach(function (input) {
      input.addEventListener("change", function () {
        state.frequency = input.value;
        render();
      });
    });

    var customInput = qs("#donate-custom", root);
    if (customInput) {
      customInput.addEventListener("input", function () {
        state.custom = customInput.value;
        render();
      });
    }

    var cover = qs("#donate-cover-fees", root);
    if (cover) {
      cover.addEventListener("change", function () {
        state.coverFees = cover.checked;
        render();
      });
    }

    var continue1 = qs("[data-donate-to='2']", root);
    if (continue1) {
      continue1.addEventListener("click", function () {
        if (!giftAmount() || giftAmount() <= 0) {
          setError("Please choose or enter a gift amount.");
          return;
        }
        go(2);
      });
    }
    var back1 = qs("[data-donate-to='1']", root);
    qsa("[data-donate-to='1']", root).forEach(function (b) {
      b.addEventListener("click", function () {
        go(1);
      });
    });
    var continue2 = qs("[data-donate-to='3']", root);
    if (continue2) {
      continue2.addEventListener("click", function () {
        readDonor();
        if (!state.donor.first || !state.donor.last) {
          setError("First and last name are required.");
          return;
        }
        if (!state.donor.email) {
          setError("Email is required so we can send your receipt.");
          return;
        }
        if (!state.donor.zip) {
          setError("ZIP code is required.");
          return;
        }
        go(3);
      });
    }
    qsa("[data-donate-to='2']", root).forEach(function (b) {
      if (b === continue1) return;
      b.addEventListener("click", function () {
        go(2);
      });
    });

    ["first", "last", "email", "phone", "address", "city", "state", "zip"].forEach(function (name) {
      var el = qs("#donate-" + name, root);
      if (!el) return;
      el.addEventListener("input", function () {
        state.donor[name] = el.value;
      });
    });
    var anon = qs("#donate-anon", root);
    if (anon) {
      anon.addEventListener("change", function () {
        state.donor.anonymous = anon.checked;
      });
    }
    var updates = qs("#donate-updates", root);
    if (updates) {
      updates.addEventListener("change", function () {
        state.donor.updates = updates.checked;
      });
    }
    var agree = qs("#donate-agree", root);
    if (agree) {
      agree.addEventListener("change", function () {
        state.agree = agree.checked;
      });
    }

    function readDonor() {
      ["first", "last", "email", "phone", "address", "city", "state", "zip"].forEach(function (name) {
        var el = qs("#donate-" + name, root);
        if (el) state.donor[name] = el.value.trim();
      });
    }

    var valorLoaded = false;
    function initValorFields() {
      var cfg = window.KC_VALOR;
      var mount = qs("#valor-fields", root);
      var note = qs("[data-valor-note]", root);
      if (!mount) return;
      if (!cfg.enabled) {
        if (note) {
          note.hidden = false;
          note.textContent =
            "Card fields are ready for Valor Passage.js. Set KC_VALOR.enabled = true in js/donate.js when the client-token endpoint is live. Preview mode will not charge a card.";
        }
        return;
      }
      if (valorLoaded) return;
      valorLoaded = true;
      fetch(cfg.clientTokenUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          amount: total().toFixed(2),
          frequency: state.frequency,
          category: state.category,
        }),
      })
        .then(function (res) {
          return res.json();
        })
        .then(function (data) {
          var token = data.clientToken || data.client_token;
          if (!token) throw new Error("No client token");
          var script = document.createElement("script");
          script.src = cfg.scriptSrc;
          script.setAttribute("data-name", "valor_passage");
          script.setAttribute("data-clientToken", token);
          script.setAttribute("data-epi", cfg.epi);
          script.setAttribute("data-amount", total().toFixed(2));
          script.setAttribute("data-cardholderName", "true");
          script.setAttribute("data-email", "true");
          script.setAttribute("data-billingAddress", "true");
          script.setAttribute("data-defaultEmail", state.donor.email);
          script.setAttribute("data-defaultCardholderName", state.donor.first + " " + state.donor.last);
          script.setAttribute("data-defaultAddress1", state.donor.address);
          script.setAttribute("data-defaultCity", state.donor.city);
          script.setAttribute("data-defaultState", state.donor.state);
          if (cfg.demo) script.setAttribute("data-demo", "true");
          document.body.appendChild(script);
          state.cardReady = true;
          if (note) note.hidden = true;
        })
        .catch(function () {
          if (note) {
            note.hidden = false;
            note.textContent =
              "Could not load Valor card fields. Check KC_VALOR.clientTokenUrl, then retry.";
          }
        });
    }

    function payload() {
      return {
        amount: giftAmount().toFixed(2),
        fees: fees().toFixed(2),
        total: total().toFixed(2),
        frequency: state.frequency,
        category: state.category,
        designation: TIERS[state.category].label,
        coverFees: state.coverFees,
        donor: {
          first: state.donor.first,
          last: state.donor.last,
          email: state.donor.email,
          phone: state.donor.phone,
          address: state.donor.address,
          city: state.donor.city,
          state: state.donor.state,
          zip: state.donor.zip,
          anonymous: state.donor.anonymous,
          updates: state.donor.updates,
        },
      };
    }

    function finishPreview() {
      state.receiptId = "KC-PREVIEW-" + Date.now().toString().slice(-8);
      var rec = qs("[data-receipt-id]", root);
      if (rec) rec.textContent = state.receiptId;
      var recEmail = qs("[data-receipt-email]", root);
      if (recEmail) recEmail.textContent = state.donor.email;
      go(4);
    }

    function submitGift() {
      readDonor();
      if (!state.agree) {
        setError("Please authorize this gift to continue.");
        return;
      }
      if (!giftAmount()) {
        setError("Please choose a gift amount.");
        return;
      }
      var cfg = window.KC_VALOR;
      if (!cfg.enabled) {
        finishPreview();
        return;
      }
      state.processing = true;
      render();
      fetch(cfg.saleUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(payload()),
      })
        .then(function (res) {
          return res.json().then(function (data) {
            return { ok: res.ok, data: data };
          });
        })
        .then(function (result) {
          state.processing = false;
          if (!result.ok || (result.data && result.data.error)) {
            setError((result.data && (result.data.message || result.data.error)) || "Payment could not be completed.");
            render();
            return;
          }
          state.receiptId = (result.data && (result.data.receiptId || result.data.txnid)) || "";
          var rec = qs("[data-receipt-id]", root);
          if (rec) rec.textContent = state.receiptId || "—";
          var recEmail = qs("[data-receipt-email]", root);
          if (recEmail) recEmail.textContent = state.donor.email;
          go(4);
        })
        .catch(function () {
          state.processing = false;
          setError("Payment could not be completed. Please try again.");
          render();
        });
    }
  }

  document.addEventListener("DOMContentLoaded", initDonate);
})();
