using System.Text.Json;
using Stayra.Domain;

namespace Stayra.Application.Common;

public class AuditService(IAppDbContext db)
{
    public static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    /// <summary>Adds an audit row to the change tracker; persisted with the caller's SaveChanges.</summary>
    public void Log(Guid? tenantId, string actor, string action, string entityType, Guid? entityId, object? data = null)
    {
        db.AuditLogs.Add(new AuditLog
        {
            TenantId = tenantId,
            Actor = actor,
            Action = action,
            EntityType = entityType,
            EntityId = entityId,
            DataJson = data is null ? null : JsonSerializer.Serialize(data, Json),
        });
    }
}

public static class Actors
{
    public const string System = "system";
    public const string Bot = "bot";
    public const string Guest = "guest";
    public static string Owner(string email) => $"owner:{email}";
}
