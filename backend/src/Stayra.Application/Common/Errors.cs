namespace Stayra.Application.Common;

/// <summary>Domain/application error that maps to a ProblemDetails response. Code is a stable key used for localization on the client.</summary>
public class AppException(int status, string code, string message, IDictionary<string, string[]>? errors = null) : Exception(message)
{
    public int Status { get; } = status;
    public string Code { get; } = code;
    public IDictionary<string, string[]>? Errors { get; } = errors;

    public static AppException NotFound(string what) => new(404, "not_found", $"{what} was not found.");
    public static AppException Conflict(string code, string message) => new(409, code, message);
    public static AppException BadRequest(string code, string message) => new(400, code, message);
    public static AppException Forbidden(string message = "You don't have access to this.") => new(403, "forbidden", message);
}
