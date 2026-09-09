function isLoopbackHost(hostname) {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
}

function isPrivateIpv4Host(hostname) {
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(hostname);
  if (!match) return false;

  const parts = match.slice(1).map(Number);
  if (parts.some((part) => Number.isNaN(part) || part < 0 || part > 255)) return false;

  // RFC1918 private ranges: 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16
  if (parts[0] === 10) return true;
  if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
  if (parts[0] === 192 && parts[1] === 168) return true;
  return false;
}

function inferredPort(url) {
  if (url.port) return url.port;
  if (url.protocol === 'https:') return '443';
  return '80';
}

function devPorts(config) {
  const ports = new Set();
  const rawOrigins = Array.isArray(config?.corsOrigins) ? config.corsOrigins : [];

  for (const raw of rawOrigins) {
    try {
      const url = new URL(raw);
      ports.add(inferredPort(url));
    } catch {
      // Ignore malformed values; loadConfig should already reject invalid env.
    }
  }

  try {
    const frontend = new URL(config.frontendBaseUrl);
    ports.add(inferredPort(frontend));
  } catch {
    // Ignore.
  }

  return ports;
}

export function buildOriginMatcher(config) {
  const strictAllowed = new Set(config.corsOrigins);
  const development = config.nodeEnv === 'development';
  const allowedDevPorts = devPorts(config);

  return function originAllowed(origin) {
    if (!origin) return true;
    if (strictAllowed.has(origin)) return true;
    if (!development) return false;

    try {
      const url = new URL(origin);
      const port = inferredPort(url);
      if (!allowedDevPorts.has(port)) return false;
      return isLoopbackHost(url.hostname) || isPrivateIpv4Host(url.hostname);
    } catch {
      return false;
    }
  };
}

