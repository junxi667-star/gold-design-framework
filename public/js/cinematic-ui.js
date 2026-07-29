const root = document.documentElement;
const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
const finePointerQuery = window.matchMedia("(pointer: fine)");
const mobileQuery = window.matchMedia("(max-width: 640px)");

root.classList.add("has-cinematic-ui");

let pointerX = window.innerWidth * 0.76;
let pointerY = window.innerHeight * 0.08;
let pointerFrame = 0;

function updatePointerVariables() {
  pointerFrame = 0;
  const x = Math.max(0, Math.min(100, (pointerX / Math.max(window.innerWidth, 1)) * 100));
  const y = Math.max(0, Math.min(100, (pointerY / Math.max(window.innerHeight, 1)) * 100));
  root.style.setProperty("--pointer-x", `${x.toFixed(2)}%`);
  root.style.setProperty("--pointer-y", `${y.toFixed(2)}%`);
}

window.addEventListener("pointermove", (event) => {
  if (!finePointerQuery.matches || motionQuery.matches) return;
  pointerX = event.clientX;
  pointerY = event.clientY;
  if (!pointerFrame) pointerFrame = window.requestAnimationFrame(updatePointerVariables);
}, { passive: true });

function bindTilt(element) {
  if (
    element.dataset.cinematicTiltBound === "true"
    || !finePointerQuery.matches
    || motionQuery.matches
  ) {
    return;
  }

  element.dataset.cinematicTiltBound = "true";
  element.classList.add("cinematic-tilt");
  const isHero = element.dataset.cinematicTilt === "hero";
  const maxTilt = isHero ? 1.2 : 2.7;
  let frame = 0;
  let pendingEvent = null;

  const update = () => {
    frame = 0;
    if (!pendingEvent) return;
    const bounds = element.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return;
    const relativeX = Math.max(0, Math.min(1, (pendingEvent.clientX - bounds.left) / bounds.width));
    const relativeY = Math.max(0, Math.min(1, (pendingEvent.clientY - bounds.top) / bounds.height));
    element.style.setProperty("--tilt-x", `${((0.5 - relativeY) * maxTilt * 2).toFixed(2)}deg`);
    element.style.setProperty("--tilt-y", `${((relativeX - 0.5) * maxTilt * 2).toFixed(2)}deg`);
    element.style.setProperty("--card-x", `${(relativeX * 100).toFixed(1)}%`);
    element.style.setProperty("--card-y", `${(relativeY * 100).toFixed(1)}%`);
  };

  element.addEventListener("pointermove", (event) => {
    pendingEvent = event;
    if (!frame) frame = window.requestAnimationFrame(update);
  }, { passive: true });

  element.addEventListener("pointerleave", () => {
    pendingEvent = null;
    if (frame) window.cancelAnimationFrame(frame);
    frame = 0;
    element.style.setProperty("--tilt-x", "0deg");
    element.style.setProperty("--tilt-y", "0deg");
    element.style.setProperty("--card-x", "50%");
    element.style.setProperty("--card-y", "15%");
  }, { passive: true });
}

const tiltSelector = [
  ".site-header[data-cinematic-tilt]",
  ".direction-card",
  ".ai-result-card",
  ".model-card",
  ".prompt-card",
].join(",");

function decorateTilt(container = document) {
  if (container instanceof Element && container.matches(tiltSelector)) bindTilt(container);
  container.querySelectorAll?.(tiltSelector).forEach(bindTilt);
}

const revealSelector = [
  ".loop-card",
  ".boundary-banner",
  ".section-heading",
  ".panel",
  ".direction-card",
  ".ai-task-card",
  ".ai-result-card",
  ".knowledge-card",
  ".model-card",
  ".prompt-card",
].join(",");

const revealObserver = "IntersectionObserver" in window && !motionQuery.matches
  ? new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      entry.target.classList.add("is-revealed");
      revealObserver.unobserve(entry.target);
    });
  }, { rootMargin: "0px 0px -36px", threshold: 0.06 })
  : null;

function bindReveal(element, order = 0) {
  if (element.dataset.cinematicRevealBound === "true") return;
  element.dataset.cinematicRevealBound = "true";
  element.dataset.revealOrder = String(order % 4);
  element.classList.add("reveal-candidate");
  if (revealObserver) {
    revealObserver.observe(element);
  } else {
    element.classList.add("is-revealed");
  }
}

function decorateReveal(container = document) {
  const elements = [];
  if (container instanceof Element && container.matches(revealSelector)) elements.push(container);
  container.querySelectorAll?.(revealSelector).forEach((element) => elements.push(element));
  elements.forEach((element, index) => bindReveal(element, index));
}

function revealActiveView() {
  const activeView = document.querySelector(".view.is-active");
  activeView?.querySelectorAll(".reveal-candidate").forEach((element) => {
    if (element.getBoundingClientRect().top < window.innerHeight * 0.96) {
      element.classList.add("is-revealed");
      revealObserver?.unobserve(element);
    }
  });
}

decorateTilt();
decorateReveal();
window.requestAnimationFrame(revealActiveView);

const workspace = document.querySelector("#workspace-main");
if (workspace) {
  const workspaceObserver = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
      mutation.addedNodes.forEach((node) => {
        if (!(node instanceof Element)) return;
        decorateTilt(node);
        decorateReveal(node);
      });
    });
    window.requestAnimationFrame(revealActiveView);
  });
  workspaceObserver.observe(workspace, { childList: true, subtree: true });
}

document.addEventListener("click", (event) => {
  if (!event.target.closest(".nav-button")) return;
  window.setTimeout(revealActiveView, 40);
});

function addRipple(event) {
  if (motionQuery.matches) return;
  const target = event.target.closest(".button, .nav-button, .command-trigger, .command-item");
  if (!target || target.disabled) return;
  const bounds = target.getBoundingClientRect();
  const ripple = document.createElement("span");
  ripple.className = "ui-ripple";
  ripple.style.left = `${event.clientX - bounds.left}px`;
  ripple.style.top = `${event.clientY - bounds.top}px`;
  target.append(ripple);
  ripple.addEventListener("animationend", () => ripple.remove(), { once: true });
}

document.addEventListener("pointerdown", addRipple);

const mainNav = document.querySelector(".main-nav");
let scrollFrame = 0;

function updateScrollState() {
  scrollFrame = 0;
  const scrollable = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
  const progress = Math.max(0, Math.min(1, window.scrollY / scrollable));
  root.style.setProperty("--scroll-progress", progress.toFixed(4));
  mainNav?.classList.toggle("is-condensed", window.scrollY > 120);
}

window.addEventListener("scroll", () => {
  if (!scrollFrame) scrollFrame = window.requestAnimationFrame(updateScrollState);
}, { passive: true });
updateScrollState();

const commandTrigger = document.querySelector("#command-trigger");
const commandPalette = document.querySelector("#command-palette");
const commandSearch = document.querySelector("#command-search-input");
const commandItems = commandPalette ? [...commandPalette.querySelectorAll(".command-item")] : [];
let activeCommandIndex = 0;

function visibleCommandItems() {
  return commandItems.filter((item) => !item.hidden);
}

function setActiveCommand(index) {
  const visible = visibleCommandItems();
  commandItems.forEach((item) => item.classList.remove("is-command-active"));
  if (!visible.length) return;
  activeCommandIndex = (index + visible.length) % visible.length;
  visible[activeCommandIndex].classList.add("is-command-active");
  visible[activeCommandIndex].scrollIntoView({ block: "nearest" });
}

function openCommandPalette() {
  if (!commandPalette || commandPalette.open) return;
  commandSearch.value = "";
  commandItems.forEach((item) => {
    item.hidden = false;
  });
  if (typeof commandPalette.showModal === "function") {
    commandPalette.showModal();
  } else {
    commandPalette.setAttribute("open", "");
  }
  setActiveCommand(0);
  window.requestAnimationFrame(() => commandSearch.focus());
}

function closeCommandPalette() {
  if (!commandPalette?.open) return;
  if (typeof commandPalette.close === "function") {
    commandPalette.close();
  } else {
    commandPalette.removeAttribute("open");
  }
  commandTrigger?.focus();
}

function runViewCommand(viewName) {
  const navButton = document.querySelector(`.nav-button[data-view="${CSS.escape(viewName)}"]`);
  if (!navButton) return;
  navButton.click();
  closeCommandPalette();
  document.querySelector("#workspace-main")?.scrollIntoView({
    behavior: motionQuery.matches ? "auto" : "smooth",
    block: "start",
  });
}

commandTrigger?.addEventListener("click", openCommandPalette);
commandPalette?.querySelector("[data-command-close]")?.addEventListener("click", closeCommandPalette);

commandPalette?.addEventListener("click", (event) => {
  if (event.target === commandPalette) {
    closeCommandPalette();
    return;
  }
  const command = event.target.closest("[data-command-view]");
  if (command) runViewCommand(command.dataset.commandView);
});

commandSearch?.addEventListener("input", () => {
  const query = commandSearch.value.trim().toLocaleLowerCase("zh-CN");
  commandItems.forEach((item) => {
    const haystack = `${item.textContent} ${item.dataset.searchTerms || ""}`.toLocaleLowerCase("zh-CN");
    item.hidden = Boolean(query) && !haystack.includes(query);
  });
  setActiveCommand(0);
});

commandPalette?.addEventListener("keydown", (event) => {
  if (event.key === "ArrowDown") {
    event.preventDefault();
    setActiveCommand(activeCommandIndex + 1);
  }
  if (event.key === "ArrowUp") {
    event.preventDefault();
    setActiveCommand(activeCommandIndex - 1);
  }
  if (event.key === "Enter" && event.target === commandSearch) {
    event.preventDefault();
    visibleCommandItems()[activeCommandIndex]?.click();
  }
  if (/^[1-6]$/.test(event.key)) {
    event.preventDefault();
    commandItems[Number(event.key) - 1]?.click();
  }
});

document.addEventListener("keydown", (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLocaleLowerCase("en-US") === "k") {
    event.preventDefault();
    commandPalette?.open ? closeCommandPalette() : openCommandPalette();
  }
});

const lightbox = document.querySelector("#image-lightbox");
const lightboxImage = document.querySelector("#lightbox-image");
const lightboxTitle = document.querySelector("#image-lightbox-title");

function closeLightbox() {
  if (!lightbox?.open) return;
  if (typeof lightbox.close === "function") {
    lightbox.close();
  } else {
    lightbox.removeAttribute("open");
  }
}

document.addEventListener("click", (event) => {
  const previewTarget = event.target.closest(".direction-media-grid img, [data-editorial-preview]");
  const image = previewTarget?.matches("img") ? previewTarget : previewTarget?.querySelector("img");
  if (!previewTarget || !image || !lightbox || !lightboxImage) return;
  lightboxImage.src = image.currentSrc || image.src;
  lightboxImage.alt = image.alt;
  if (lightboxTitle) {
    lightboxTitle.textContent =
      previewTarget.dataset.previewCaption || image.dataset.previewCaption || image.alt || "图片预览";
  }
  if (typeof lightbox.showModal === "function") {
    lightbox.showModal();
  } else {
    lightbox.setAttribute("open", "");
  }
});

lightbox?.querySelector("[data-lightbox-close]")?.addEventListener("click", closeLightbox);
lightbox?.addEventListener("click", (event) => {
  if (event.target === lightbox) closeLightbox();
});

function setupParticles() {
  const canvas = document.querySelector("#aurum-particles");
  const context = canvas?.getContext("2d");
  if (!canvas || !context || motionQuery.matches) return;

  let particles = [];
  let width = 0;
  let height = 0;
  let animationFrame = 0;
  let lastTime = performance.now();

  function createParticle() {
    return {
      x: Math.random() * width,
      y: Math.random() * height,
      radius: 0.45 + Math.random() * 1.35,
      opacity: 0.14 + Math.random() * 0.38,
      speedX: (Math.random() - 0.5) * 0.075,
      speedY: -0.035 - Math.random() * 0.075,
      phase: Math.random() * Math.PI * 2,
    };
  }

  function resize() {
    const scale = Math.min(window.devicePixelRatio || 1, 1.5);
    width = window.innerWidth;
    height = window.innerHeight;
    canvas.width = Math.round(width * scale);
    canvas.height = Math.round(height * scale);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    context.setTransform(scale, 0, 0, scale, 0, 0);
    const count = mobileQuery.matches ? 20 : Math.min(52, Math.max(30, Math.round(width / 34)));
    particles = Array.from({ length: count }, createParticle);
  }

  function draw(time) {
    const delta = Math.min(34, time - lastTime);
    lastTime = time;
    context.clearRect(0, 0, width, height);

    particles.forEach((particle, index) => {
      particle.x += particle.speedX * delta;
      particle.y += particle.speedY * delta;
      particle.phase += delta * 0.0007;

      if (particle.y < -8) particle.y = height + 8;
      if (particle.x < -8) particle.x = width + 8;
      if (particle.x > width + 8) particle.x = -8;

      const pointerDistance = Math.hypot(particle.x - pointerX, particle.y - pointerY);
      const proximity = Math.max(0, 1 - pointerDistance / 210);
      const glow = particle.opacity + proximity * 0.34;

      context.beginPath();
      context.arc(particle.x, particle.y, particle.radius + proximity * 0.8, 0, Math.PI * 2);
      context.fillStyle = `rgba(255, 222, 133, ${Math.max(0.04, glow + Math.sin(particle.phase) * 0.06)})`;
      context.fill();

      if (index >= 24) return;
      for (let peerIndex = index + 1; peerIndex < Math.min(particles.length, 25); peerIndex += 1) {
        const peer = particles[peerIndex];
        const distance = Math.hypot(particle.x - peer.x, particle.y - peer.y);
        if (distance > 108) continue;
        context.beginPath();
        context.moveTo(particle.x, particle.y);
        context.lineTo(peer.x, peer.y);
        context.strokeStyle = `rgba(231, 196, 106, ${(1 - distance / 108) * 0.055})`;
        context.lineWidth = 0.55;
        context.stroke();
      }
    });

    animationFrame = window.requestAnimationFrame(draw);
  }

  function handleVisibility() {
    if (document.hidden) {
      if (animationFrame) window.cancelAnimationFrame(animationFrame);
      animationFrame = 0;
      return;
    }
    if (!animationFrame) {
      lastTime = performance.now();
      animationFrame = window.requestAnimationFrame(draw);
    }
  }

  resize();
  animationFrame = window.requestAnimationFrame(draw);
  window.addEventListener("resize", resize, { passive: true });
  document.addEventListener("visibilitychange", handleVisibility);
}

setupParticles();

function honorDeepLink() {
  if (!window.location.hash) return;
  const target = document.querySelector(window.location.hash);
  if (!target || !target.getClientRects().length) return;
  target.scrollIntoView({
    behavior: motionQuery.matches ? "auto" : "smooth",
    block: "start",
  });
}

window.addEventListener("load", () => {
  window.setTimeout(honorDeepLink, 700);
  window.setTimeout(honorDeepLink, 1800);
});
