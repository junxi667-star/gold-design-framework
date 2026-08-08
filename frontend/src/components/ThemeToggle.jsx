import { useCallback, useEffect, useState } from "react";

const THEME_COLORS = {
  dark: "#171522",
  light: "#f8f7fa",
};

function SunIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="5" />
      <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  );
}

function getStoredTheme() {
  try {
    return localStorage.getItem("jewelchain-theme") || "system";
  } catch {
    return "system";
  }
}

function getSystemTheme() {
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function applyTheme(theme) {
  const resolved = theme === "system" ? getSystemTheme() : theme;
  document.documentElement.setAttribute("data-theme", resolved);
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute("content", THEME_COLORS[resolved]);
  try {
    localStorage.setItem("jewelchain-theme", theme);
  } catch {
    // Storage not available
  }
}

export function ThemeToggle() {
  const [theme, setTheme] = useState(getStoredTheme);

  useEffect(() => {
    applyTheme(theme);

    if (theme === "system") {
      const media = window.matchMedia("(prefers-color-scheme: dark)");
      const handler = () => applyTheme("system");
      media.addEventListener("change", handler);
      return () => media.removeEventListener("change", handler);
    }
  }, [theme]);

  const toggleTheme = useCallback(() => {
    setTheme((current) => {
      const system = getSystemTheme();
      if (current === "system") return system === "dark" ? "light" : "dark";
      if (current === "dark") return "light";
      return "dark";
    });
  }, []);

  const resolved = theme === "system" ? getSystemTheme() : theme;
  const label = resolved === "dark" ? "切换到亮色模式" : "切换到暗色模式";

  return (
    <button
      className="icon-button theme-toggle"
      type="button"
      title={label}
      aria-label={label}
      onClick={toggleTheme}
    >
      {resolved === "dark" ? <SunIcon /> : <MoonIcon />}
    </button>
  );
}
