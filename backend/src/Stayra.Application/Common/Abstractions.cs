using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Stayra.Domain;

namespace Stayra.Application.Common;

/// <summary>Resolved per request (JWT for owners, slug for public, explicit for jobs).</summary>
public interface ITenantContext
{
    Guid? TenantId { get; }
    bool IsPlatformAdmin { get; }
    /// <summary>When true, global tenant filters are bypassed (platform admin, background jobs scanning all tenants).</summary>
    bool BypassFilter { get; }
    void Set(Guid? tenantId, bool bypass = false);
}

public interface IAppDbContext
{
    DbSet<Tenant> Tenants { get; }
    DbSet<User> Users { get; }
    DbSet<Room> Rooms { get; }
    DbSet<RoomPhoto> RoomPhotos { get; }
    DbSet<PriceRule> PriceRules { get; }
    DbSet<Booking> Bookings { get; }
    DbSet<Payment> Payments { get; }
    DbSet<BookingChangeRequest> ChangeRequests { get; }
    DbSet<PolicyDocument> PolicyDocuments { get; }
    DbSet<PolicyChunk> PolicyChunks { get; }
    DbSet<RefundPolicy> RefundPolicies { get; }
    DbSet<FaqItem> FaqItems { get; }
    DbSet<Conversation> Conversations { get; }
    DbSet<Message> Messages { get; }
    DbSet<ChannelConnection> ChannelConnections { get; }
    DbSet<AuditLog> AuditLogs { get; }
    DatabaseFacade Database { get; }
    Task<int> SaveChangesAsync(CancellationToken ct = default);
}

public interface ISecretProtector
{
    string? Protect(string? plain);
    string? Unprotect(string? cipher);
}

public interface IFileStorage
{
    Task<string> SaveAsync(Stream content, string path, string contentType, CancellationToken ct = default);
    Task<Stream?> OpenAsync(string path, CancellationToken ct = default);
    Task DeleteAsync(string path, CancellationToken ct = default);
    /// <summary>Map a public URL produced by SaveAsync back to a storage path.</summary>
    string? PathFromUrl(string url);
}

public interface IEmbeddingService
{
    bool IsEnabled { get; }
    int Dimensions { get; }
    Task<float[]?> EmbedAsync(string text, bool isQuery, CancellationToken ct = default);
    Task<IReadOnlyList<float[]>?> EmbedManyAsync(IReadOnlyList<string> texts, CancellationToken ct = default);
}

public interface IJobScheduler
{
    string Schedule<T>(System.Linq.Expressions.Expression<Func<T, Task>> job, DateTimeOffset at) where T : notnull;
    string Enqueue<T>(System.Linq.Expressions.Expression<Func<T, Task>> job) where T : notnull;
    void Delete(string jobId);
}

/// <summary>Pushes live updates to owner dashboards and widget clients.</summary>
public interface IRealtimeNotifier
{
    Task ConversationUpdated(Guid tenantId, Guid conversationId);
    Task MessageAdded(Guid tenantId, Guid conversationId, object message);
    Task BookingChanged(Guid tenantId, Guid bookingId);
    Task DocumentChanged(Guid tenantId, Guid documentId);
    Task Typing(Guid conversationId, bool typing);
    Task ConversationStatusChanged(Guid conversationId, string status) => Task.CompletedTask;
}

/// <summary>Delivers a bot/owner/system message to the guest's channel.</summary>
public interface IGuestMessenger
{
    Task<Message> SendAsync(Guid conversationId, MessageRole role, string text, IReadOnlyList<Card>? cards = null, string? author = null, CancellationToken ct = default);
}

public record EmailMessage(string To, string Subject, string HtmlBody, string TextBody, string? ReplyTo = null);

public interface IEmailNotifier
{
    Task SendBookingConfirmationAsync(Tenant tenant, Booking booking, Room? room, string language, CancellationToken ct = default);
}

public interface IEmailSender
{
    bool IsEnabled { get; }
    string WebBaseUrl => "http://localhost:5173";
    Task SendAsync(EmailMessage message, CancellationToken ct = default);
    Task SendBookingConfirmationAsync(Tenant tenant, Booking booking, Room? room, string language, CancellationToken ct = default) => Task.CompletedTask;
}

public record Card(string Type, object Data);
