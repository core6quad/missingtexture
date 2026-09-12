(function () {
  "use strict";

  /* ---------------- element refs ---------------- */
  const $ = (id) => document.getElementById(id);
  const el = {
    width: $("width"),
    height: $("height"),
    cell: $("cell"),
    colorA: $("colorA"),
    colorAHex: $("colorAHex"),
    colorB: $("colorB"),
    colorBHex: $("colorBHex"),
    swap: $("swap"),
    redx: $("redx"),
    canvas: $("canvas"),
    download: $("download"),
    copy: $("copy"),
    reset: $("reset"),
    readout: $("readout"),
    sizeLabel: $("sizeLabel"),
    status: $("status"),
  };

  /* ---------------- config ---------------- */
  const DEFAULTS = {
    width: 512,
    height: 512,
    cell: 32,
    colorA: "#202020",
    colorB: "#ff00ff",
    swap: false,
    redx: false,
  };

  const MIN_DIM = 8;
  const MAX_DIM = 8192;
  const ESTIMATE_MAX_AREA = 2048 * 2048; // skip live PNG-size estimate for very large images

  /* ---------------- helpers ---------------- */
  function clamp(n, lo, hi) {
    return Math.max(lo, Math.min(hi, n));
  }

  // Returns a normalized #rrggbb lowercase string, or null if invalid.
  function normalizeHex(v) {
    if (typeof v !== "string") return null;
    let s = v.trim();
    if (s[0] !== "#") s = "#" + s;
    if (/^#([0-9a-fA-F]{3})$/.test(s)) {
      s = "#" + s[1] + s[1] + s[2] + s[2] + s[3] + s[3];
    }
    return /^#[0-9a-fA-F]{6}$/.test(s) ? s.toLowerCase() : null;
  }

  function debounce(fn, ms) {
    let t;
    return function (...args) {
      clearTimeout(t);
      t = setTimeout(() => fn.apply(this, args), ms);
    };
  }

  function fmtBytes(n) {
    if (n == null) return "";
    if (n < 1024) return n + " B";
    const kb = n / 1024;
    if (kb < 1024) return kb.toFixed(1) + " KB";
    return (kb / 1024).toFixed(2) + " MB";
  }

  function flash(msg, kind) {
    el.status.textContent = msg;
    el.status.className = "status" + (kind ? " " + kind : "");
    clearTimeout(flash._t);
    flash._t = setTimeout(() => {
      el.status.textContent = "";
      el.status.className = "status";
    }, 2500);
  }

  /* ---------------- read current config (clamped/sanitized) ---------------- */
  function getConfig() {
    let w = parseInt(el.width.value, 10);
    let h = parseInt(el.height.value, 10);
    let s = parseInt(el.cell.value, 10);
    if (!isFinite(w) || w <= 0) w = DEFAULTS.width;
    if (!isFinite(h) || h <= 0) h = DEFAULTS.height;
    if (!isFinite(s) || s <= 0) s = DEFAULTS.cell;
    w = clamp(w, MIN_DIM, MAX_DIM);
    h = clamp(h, MIN_DIM, MAX_DIM);
    s = clamp(s, 1, Math.max(w, h));

    // The native picker always holds a valid value, so it is the source of
    // truth; the hex field only pushes a value into it when it is valid.
    let a = normalizeHex(el.colorA.value) || DEFAULTS.colorA;
    let b = normalizeHex(el.colorB.value) || DEFAULTS.colorB;

    return { w, h, s, a, b, swap: el.swap.checked, redx: el.redx.checked };
  }

  /* ---------------- rendering ---------------- */
  function render() {
    const { w, h, s, a, b, swap, redx } = getConfig();

    el.canvas.width = w;
    el.canvas.height = h;
    const ctx = el.canvas.getContext("2d");

    // Build a 2s x 2s tile holding one full checker period, then fill the
    // whole canvas with it as a repeating pattern -> O(1) in square count.
    const tile = document.createElement("canvas");
    tile.width = s * 2;
    tile.height = s * 2;
    const tctx = tile.getContext("2d");
    const base = swap ? b : a;
    const alt = swap ? a : b;
    tctx.fillStyle = base;
    tctx.fillRect(0, 0, s * 2, s * 2);
    tctx.fillStyle = alt;
    tctx.fillRect(0, 0, s, s);
    tctx.fillRect(s, s, s, s);

    const pattern = ctx.createPattern(tile, "repeat");
    ctx.fillStyle = pattern;
    ctx.fillRect(0, 0, w, h);

    if (redx) drawRedX(ctx, w, h);

    const cols = Math.ceil(w / s);
    const rows = Math.ceil(h / s);
    el.readout.textContent = w + "\u00d7" + h + " px \u2022 " + cols + "\u00d7" + rows + " cells";
  }

  function drawRedX(ctx, w, h) {
    const m = Math.min(w, h);
    const lw = Math.max(2, Math.round(m * 0.02));
    ctx.save();
    ctx.strokeStyle = "#ff0000";
    ctx.lineWidth = lw;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(w, h);
    ctx.moveTo(w, 0);
    ctx.lineTo(0, h);
    ctx.stroke();
    ctx.restore();
  }

  /* ---------------- live PNG size estimate (debounced + guarded) ---------------- */
  const updateSizeEstimate = debounce(function () {
    const { w, h } = getConfig();
    if (w * h > ESTIMATE_MAX_AREA) {
      el.sizeLabel.textContent = "PNG: \u2014";
      return;
    }
    el.canvas.toBlob(function (blob) {
      el.sizeLabel.textContent = "PNG \u2248 " + fmtBytes(blob ? blob.size : null);
    }, "image/png");
  }, 350);

  /* ---------------- actions ---------------- */
  function download() {
    const { w, h } = getConfig();
    const name = "missingtexture_" + w + "x" + h + ".png";
    el.canvas.toBlob(function (blob) {
      if (!blob) {
        flash("Could not create PNG.", "err");
        return;
      }
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      el.sizeLabel.textContent = "PNG " + fmtBytes(blob.size);
      flash("Saved " + name, "ok");
    }, "image/png");
  }

  async function copyPng() {
    if (
      typeof ClipboardItem === "undefined" ||
      !("clipboard" in navigator) ||
      !("write" in navigator.clipboard)
    ) {
      flash("Clipboard unavailable (needs a secure context: https / localhost).", "err");
      return;
    }
    try {
      const blob = await new Promise((res) => el.canvas.toBlob(res, "image/png"));
      if (!blob) throw new Error("no blob");
      await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
      flash("PNG copied to clipboard.", "ok");
    } catch (e) {
      flash("Copy failed: " + e.message, "err");
    }
  }

  function applyDefaults() {
    el.width.value = DEFAULTS.width;
    el.height.value = DEFAULTS.height;
    el.cell.value = DEFAULTS.cell;
    el.colorA.value = DEFAULTS.colorA;
    el.colorAHex.value = "#202020";
    el.colorB.value = DEFAULTS.colorB;
    el.colorBHex.value = "#FF00FF";
    el.swap.checked = DEFAULTS.swap;
    el.redx.checked = DEFAULTS.redx;
  }

  function setPreset(size) {
    el.width.value = size;
    el.height.value = size;
  }

  /* ---------------- wiring ---------------- */
  function onColorPicker(key) {
    const picker = key === "A" ? el.colorA : el.colorB;
    const hex = key === "A" ? el.colorAHex : el.colorBHex;
    picker.addEventListener("input", () => {
      hex.value = picker.value.toUpperCase();
      hex.classList.remove("invalid");
      onInput();
    });
  }

  function onColorHex(key) {
    const picker = key === "A" ? el.colorA : el.colorB;
    const hex = key === "A" ? el.colorAHex : el.colorBHex;
    hex.addEventListener("input", () => {
      const n = normalizeHex(hex.value);
      if (n) {
        picker.value = n;
        hex.classList.remove("invalid");
        onInput();
      } else {
        hex.classList.add("invalid");
      }
    });
  }

  function onInput() {
    render();
    updateSizeEstimate();
  }

  function init() {
    ["width", "height", "cell"].forEach((k) => el[k].addEventListener("input", onInput));
    el.swap.addEventListener("change", onInput);
    el.redx.addEventListener("change", onInput);
    onColorPicker("A");
    onColorPicker("B");
    onColorHex("A");
    onColorHex("B");

    el.download.addEventListener("click", download);
    el.copy.addEventListener("click", copyPng);
    el.reset.addEventListener("click", () => {
      applyDefaults();
      onInput();
      flash("Reset to defaults.", "ok");
    });

    document.querySelectorAll("[data-preset]").forEach((btn) => {
      btn.addEventListener("click", () => {
        setPreset(parseInt(btn.dataset.preset, 10));
        onInput();
      });
    });

    applyDefaults();
    render();
    updateSizeEstimate();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();

