export type WorldCutErrorCode =
  | "WORLDCUT_INVALID_INPUT"
  | "WORLDCUT_INVALID_ARGUMENT"
  | "WORLDCUT_FILE_READ_FAILED"
  | "WORLDCUT_INVALID_JSON"
  | "WORLDCUT_RUNTIME_ERROR"
  | "WORLDCUT_GITHUB_API_ERROR"
  | "WORLDCUT_GITHUB_RESPONSE_INVALID"
  | "WORLDCUT_ADK_RESOLUTION_INVALID";

export class WorldCutError extends Error {
  public readonly code: WorldCutErrorCode;

  public constructor(
    code: WorldCutErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "WorldCutError";
    this.code = code;
  }
}

export class WorldCutInputError extends WorldCutError {
  public constructor(message: string, options?: ErrorOptions) {
    super("WORLDCUT_INVALID_INPUT", message, options);
    this.name = "WorldCutInputError";
  }
}

export class WorldCutIntegrationError extends WorldCutError {
  public constructor(
    code:
      | "WORLDCUT_GITHUB_API_ERROR"
      | "WORLDCUT_GITHUB_RESPONSE_INVALID"
      | "WORLDCUT_ADK_RESOLUTION_INVALID",
    message: string,
    options?: ErrorOptions,
  ) {
    super(code, message, options);
    this.name = "WorldCutIntegrationError";
  }
}
