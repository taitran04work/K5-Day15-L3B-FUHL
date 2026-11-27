using System.Linq.Expressions;
using Hangfire;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.Extensions.Options;
using Npgsql;
using Stayra.Application.Bookings;
using Stayra.Application.Common;

namespace Stayra.Infrastructure.Services;

public class TenantContext : ITenantContext
{
    public Guid? TenantId { get; private set; }
    public bool IsPlatformAdmin { get; set; }
    public bool BypassFilter { get; private set; }

    public void Set(Guid? tenantId, bool bypass = false)
    {
        TenantId = tenantId;
        BypassFilter = bypass;
    }
}

public class DataProtectionSecretProtector(IDataProtectionProvider provider) : ISecretProtector
{
    private readonly IDataProtector _p = provider.CreateProtector("Stayra.TenantSecrets.v1");

    public string? Protect(string? plain) => string.IsNullOrEmpty(plain) ? null : _p.Protect(plain);

    public string? Unprotect(string? cipher)
    {
        if (string.IsNullOrEmpty(cipher)) return null;
        try { return _p.Unprotect(cipher); }
        catch (System.Security.Cryptography.CryptographicException) { return null; }
    }
}

public class StorageOptions
{
    public string Root { get; set; } = "data/uploads";
    public string PublicBaseUrl { get; set; } = "/files";
}

public class LocalDiskStorage(IOptions<StorageOptions> options) : IFileStorage
{
    private readonly StorageOptions _o = options.Value;

    private string Full(string path)
    {
        var root = Path.GetFullPath(_o.Root);
        var full = Path.GetFullPath(Path.Combine(root, path.TrimStart('/', '\\')));
        if (!full.StartsWith(root, StringComparison.OrdinalIgnoreCase)) throw new InvalidOperationException("Invalid storage path.");
        return full;
    }

    public async Task<string> SaveAsync(Stream content, string path, string contentType, CancellationToken ct = default)
    {
        var full = Full(path);
        Directory.CreateDirectory(Path.GetDirectoryName(full)!);
        await using var fs = File.Create(full);
        await content.CopyToAsync(fs, ct);
        return $"{_o.PublicBaseUrl.TrimEnd('/')}/{path.TrimStart('/').Replace('\\', '/')}";
    }

    public Task<Stream?> OpenAsync(string path, CancellationToken ct = default)
    {
        var full = Full(path);
        return Task.FromResult<Stream?>(File.Exists(full) ? File.OpenRead(full) : null);
    }

    public Task DeleteAsync(string path, CancellationToken ct = default)
    {
        var full = Full(path);
        if (File.Exists(full)) File.Delete(full);
        return Task.CompletedTask;
    }

    public string? PathFromUrl(string url)
    {
        var prefix = _o.PublicBaseUrl.TrimEnd('/') + "/";
        return url.StartsWith(prefix) ? url[prefix.Length..] : null;
    }
}

public class HangfireJobScheduler(IBackgroundJobClient client) : IJobScheduler
{
    public string Schedule<T>(Expression<Func<T, Task>> job, DateTimeOffset at) where T : notnull => client.Schedule(job, at);
    public string Enqueue<T>(Expression<Func<T, Task>> job) where T : notnull => client.Enqueue(job);
    public void Delete(string jobId) => client.Delete(jobId);
}

public class PostgresConflictDetector : IBookingConflictDetector
{
    public bool IsOverlapViolation(Exception ex)
    {
        for (var e = ex; e != null; e = e.InnerException)
            if (e is PostgresException { SqlState: PostgresErrorCodes.ExclusionViolation }) return true;
        return false;
    }
}
