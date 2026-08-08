import { useEffect } from "react";

import { gsap } from "gsap";

function revealElement(element) {
  element.classList.add("visible");
  gsap.fromTo(
    element,
    { autoAlpha: 0, y: 24 },
    {
      autoAlpha: 1,
      y: 0,
      duration: 0.72,
      ease: "power3.out",
      clearProps: "transform,opacity,visibility",
    }
  );
}

function revealCandidates(node) {
  if (!(node instanceof Element)) return [];
  const result = node.matches(".reveal") ? [node] : [];
  return [...result, ...node.querySelectorAll(".reveal")];
}

export function useEntranceAnimations() {
  useEffect(() => {
    const media = gsap.matchMedia();
    media.add(
      {
        reduceMotion: "(prefers-reduced-motion: reduce)",
        motionAllowed: "(prefers-reduced-motion: no-preference)",
      },
      (context) => {
        const revealItems = () => [...document.querySelectorAll(".reveal")];
        if (context.conditions.reduceMotion) {
          revealItems().forEach((item) => item.classList.add("visible"));
          return undefined;
        }

        const hero = document.querySelector(".hero-section");
        hero?.classList.add("visible");
        if (hero) {
          const heroCopy = hero.querySelector(".hero-copy");
          const heroSequence = [
            heroCopy?.querySelector(".eyebrow"),
            heroCopy?.querySelector("h1"),
            heroCopy?.querySelector("p"),
            heroCopy?.querySelector(".hero-actions"),
            heroCopy?.querySelector(".trust-row"),
            heroCopy?.querySelector(".protocol-pills"),
            hero.querySelector(".hero-visual"),
          ].filter(Boolean);
          gsap.set(hero, { autoAlpha: 1, y: 0 });
          gsap.from(".topbar", {
            autoAlpha: 0,
            y: -18,
            duration: 0.52,
            ease: "power3.out",
          });
          gsap.from(heroSequence, {
            autoAlpha: 0,
            y: 24,
            duration: 0.62,
            ease: "power3.out",
            stagger: 0.09,
            delay: 0.08,
          });
        }

        if (!("IntersectionObserver" in window)) {
          revealItems()
            .filter((item) => item !== hero)
            .forEach(revealElement);
          return undefined;
        }
        const observer = new IntersectionObserver(
          (entries) => {
            entries.forEach((entry) => {
              if (!entry.isIntersecting) return;
              revealElement(entry.target);
              observer.unobserve(entry.target);
            });
          },
          { threshold: 0.1, rootMargin: "0px 0px -8%" }
        );
        const observe = (node) =>
          revealCandidates(node)
            .filter((item) => item !== hero && !item.classList.contains("visible"))
            .forEach((item) => observer.observe(item));
        observe(document.body);
        const mutationObserver = new MutationObserver((records) => {
          records.forEach((record) => record.addedNodes.forEach(observe));
        });
        mutationObserver.observe(document.body, { childList: true, subtree: true });
        return () => {
          mutationObserver.disconnect();
          observer.disconnect();
        };
      }
    );
    return () => media.revert();
  }, []);
}

export function useParticles() {
  useEffect(() => {
    const canvas = document.getElementById("particleCanvas");
    if (!canvas || window.matchMedia("(prefers-reduced-motion: reduce)").matches)
      return undefined;
    const context = canvas.getContext("2d", { alpha: true });
    if (!context) return undefined;
    let frameId = 0;
    let width = 0;
    let height = 0;
    let dpr = 1;
    let particles = [];
    const pointer = { x: -1000, y: -1000 };
    const palette = ["214,179,106", "139,102,255", "85,214,194", "245,228,190"];

    const buildParticles = () => {
      const count =
        window.innerWidth < 640
          ? 34
          : Math.min(120, Math.round(window.innerWidth / 15));
      particles = Array.from({ length: count }, (_, index) => ({
        x: Math.random() * width,
        y: Math.random() * height,
        r: Math.random() * 2.2 + 0.6,
        vx: (Math.random() - 0.5) * 0.22,
        vy: -(Math.random() * 0.28 + 0.04),
        alpha: Math.random() * 0.28 + 0.1,
        color: palette[index % palette.length],
        pulse: Math.random() * Math.PI * 2,
        drift: Math.random() * Math.PI * 2,
      }));
    };
    const resize = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      width = window.innerWidth;
      height = window.innerHeight;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      buildParticles();
    };
    const drawLinks = (time) => {
      for (let index = 0; index < particles.length; index += 1) {
        const a = particles[index];
        for (
          let next = index + 1;
          next < Math.min(index + 7, particles.length);
          next += 1
        ) {
          const b = particles[next];
          const distance = Math.hypot(a.x - b.x, a.y - b.y);
          if (distance > 110) continue;
          const alpha =
            (1 - distance / 110) * 0.085 * (0.7 + Math.sin(time * 0.001 + a.pulse) * 0.3);
          context.beginPath();
          context.strokeStyle = `rgba(214,179,106,${alpha})`;
          context.lineWidth = 0.9;
          context.moveTo(a.x, a.y);
          context.lineTo(b.x, b.y);
          context.stroke();
        }
      }
    };
    const frame = (time) => {
      context.clearRect(0, 0, width, height);
      drawLinks(time);
      particles.forEach((particle) => {
        const dx = particle.x - pointer.x;
        const dy = particle.y - pointer.y;
        const distance = Math.hypot(dx, dy);
        if (distance < 120 && distance > 0) {
          particle.x += (dx / distance) * 0.42;
          particle.y += (dy / distance) * 0.42;
        }
        particle.x += particle.vx + Math.sin(time * 0.00055 + particle.drift) * 0.08;
        particle.y += particle.vy;
        if (particle.y < -10) {
          particle.y = height + 10;
          particle.x = Math.random() * width;
        }
        if (particle.x < -10) particle.x = width + 10;
        if (particle.x > width + 10) particle.x = -10;
        const glow = Math.sin(time * 0.0014 + particle.pulse) * 0.1;
        const alpha = Math.max(0.05, particle.alpha + glow);

        // Draw particle with radial gradient instead of shadowBlur (performance optimization)
        context.beginPath();
        context.fillStyle = `rgba(${particle.color},${alpha})`;
        context.arc(particle.x, particle.y, particle.r, 0, Math.PI * 2);
        context.fill();

        // Optional: draw a soft glow circle instead of shadowBlur
        if (particle.r > 1) {
          context.beginPath();
          context.fillStyle = `rgba(${particle.color},${alpha * 0.15})`;
          context.arc(particle.x, particle.y, particle.r * 3, 0, Math.PI * 2);
          context.fill();
        }

        context.beginPath();
        context.strokeStyle = `rgba(${particle.color},${Math.max(0.02, particle.alpha * 0.18)})`;
        context.lineWidth = 0.7;
        context.moveTo(particle.x, particle.y + particle.r * 4);
        context.lineTo(particle.x - particle.vx * 18, particle.y - 14);
        context.stroke();
      });
      frameId = requestAnimationFrame(frame);
    };
    const onMove = (event) => {
      pointer.x = event.clientX;
      pointer.y = event.clientY;
    };
    const onLeave = () => {
      pointer.x = -1000;
      pointer.y = -1000;
    };
    resize();
    frameId = requestAnimationFrame(frame);
    window.addEventListener("resize", resize, { passive: true });
    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("pointerleave", onLeave, { passive: true });
    return () => {
      cancelAnimationFrame(frameId);
      window.removeEventListener("resize", resize);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerleave", onLeave);
    };
  }, []);
}
