interface MeteorExtensionHost {
  readonly meteorCom?: unknown;
  readonly meteorComV2?: unknown;
}

export const isMeteorExtensionAvailable = (
  host: object,
): boolean => {
  const injected = host as MeteorExtensionHost;
  return injected.meteorCom != null || injected.meteorComV2 != null;
};
