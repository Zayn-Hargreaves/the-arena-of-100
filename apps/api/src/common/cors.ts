const DEV_ALLOWED_ORIGINS = [
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  /^http:\/\/(?:10(?:\.\d{1,3}){3}|192\.168(?:\.\d{1,3}){2}|172\.(?:1[6-9]|2\d|3[0-1])(?:\.\d{1,3}){2}):3000$/,
];

function parseCorsOriginList(value: string): string[] {
  return value
    .split(",")
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
}

export function resolveCorsOrigins(
  envValue: string | undefined,
): Array<string | RegExp> {
  if (!envValue) {
    return DEV_ALLOWED_ORIGINS;
  }

  const configuredOrigins = parseCorsOriginList(envValue);
  if (configuredOrigins.length === 0) {
    return DEV_ALLOWED_ORIGINS;
  }

  if (
    configuredOrigins.length === 1 &&
    configuredOrigins[0] === "http://localhost:3000"
  ) {
    return DEV_ALLOWED_ORIGINS;
  }

  return configuredOrigins;
}
