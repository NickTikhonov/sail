export default class SailError extends Error {
  public readonly exitCode: number;

  public constructor(message: string, exitCode = 1) {
    super(message);
    this.name = "SailError";
    this.exitCode = exitCode;
  }
}
