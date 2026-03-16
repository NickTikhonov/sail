export default class AgentScriptError extends Error {
  public readonly exitCode: number;

  public constructor(message: string, exitCode = 1) {
    super(message);
    this.name = "AgentScriptError";
    this.exitCode = exitCode;
  }
}
