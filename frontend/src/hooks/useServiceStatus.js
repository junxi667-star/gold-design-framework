import { useCallback, useEffect, useRef, useState } from "react";

import { normalizeHackathonConfig, request } from "../lib/api.js";

export function useServiceStatus(accessCode) {
  const [config, setConfig] = useState(null);
  const [isMasterOnline, setIsMasterOnline] = useState(false);
  const [isStatusBusy, setIsStatusBusy] = useState(false);
  const configRef = useRef(config);
  const statusBusyRef = useRef(false);

  useEffect(() => {
    configRef.current = config;
  }, [config]);

  const api = useCallback(
    (path, options = {}) => request(path, { accessCode: accessCode.trim(), ...options }),
    [accessCode]
  );

  const loadConfig = useCallback(async () => {
    if (statusBusyRef.current) return configRef.current;
    statusBusyRef.current = true;
    setIsStatusBusy(true);
    try {
      const nextConfig = normalizeHackathonConfig(await api("/api/hackathon/config"));
      const chain = await api("/api/hackathon/chain/status");
      setConfig(nextConfig);
      setIsMasterOnline(true);
      return { ...nextConfig, chainStatus: chain };
    } catch (error) {
      console.warn("loadConfig failed:", error);
      setIsMasterOnline(false);
      return null;
    } finally {
      statusBusyRef.current = false;
      setIsStatusBusy(false);
    }
  }, [api]);

  return {
    config,
    isMasterOnline,
    isStatusBusy,
    loadConfig,
    setIsMasterOnline,
  };
}
