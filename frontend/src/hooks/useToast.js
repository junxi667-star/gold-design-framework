import { useCallback, useEffect, useRef, useState } from "react";

export function useToast() {
  const [toast, setToast] = useState(null);
  const [error, setError] = useState("");
  const toastTimerRef = useRef(null);

  useEffect(() => () => clearTimeout(toastTimerRef.current), []);

  const showToast = useCallback((message, isError = false) => {
    clearTimeout(toastTimerRef.current);
    setToast({ message, isError });
    toastTimerRef.current = setTimeout(
      () => setToast(null),
      isError ? 7000 : 3500
    );
  }, []);

  const showError = useCallback(
    (cause) => {
      const message = cause?.message || String(cause);
      setError(message);
      showToast(message, true);
    },
    [showToast]
  );

  return {
    toast,
    error,
    setError,
    showToast,
    showError,
  };
}
