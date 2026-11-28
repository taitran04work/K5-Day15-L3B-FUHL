using System.Collections.Concurrent;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;

namespace Stayra.Infrastructure.Concierge;

/// <summary>
/// Debounces rapid bursts of inbound channel messages (2.5s) and serializes AI execution
/// per conversation so consecutive user messages are answered once with full context.
/// </summary>
public class ConciergeReplyDebouncer(IServiceScopeFactory scopeFactory, ILogger<ConciergeReplyDebouncer> log)
{
    private static readonly TimeSpan DebounceWindow = TimeSpan.FromMilliseconds(2500);
    private readonly ConcurrentDictionary<Guid, CancellationTokenSource> _pending = new();
    private readonly ConcurrentDictionary<Guid, SemaphoreSlim> _locks = new();

    public void Schedule(Guid conversationId)
    {
        var cts = new CancellationTokenSource();
        var prev = _pending.AddOrUpdate(conversationId, cts, (_, old) =>
        {
            try { old.Cancel(); old.Dispose(); } catch { /* ignore */ }
            return cts;
        });
        if (!ReferenceEquals(prev, cts))
        {
            // AddOrUpdate already cancelled old via updateFactory
        }

        _ = Task.Run(async () =>
        {
            try
            {
                await Task.Delay(DebounceWindow, cts.Token);
            }
            catch (OperationCanceledException)
            {
                return;
            }

            // Only run if this CTS is still the active one for the conversation
            if (_pending.TryGetValue(conversationId, out var current) && !ReferenceEquals(current, cts))
                return;

            var gate = _locks.GetOrAdd(conversationId, _ => new SemaphoreSlim(1, 1));
            await gate.WaitAsync();
            try
            {
                if (cts.IsCancellationRequested) return;
                await using var scope = scopeFactory.CreateAsyncScope();
                var concierge = scope.ServiceProvider.GetRequiredService<ConciergeService>();
                await concierge.RunAssistantReplyAsync(conversationId);
            }
            catch (Exception ex)
            {
                log.LogError(ex, "Background concierge reply failed for conversation {ConversationId}", conversationId);
            }
            finally
            {
                gate.Release();
                _pending.TryRemove(new KeyValuePair<Guid, CancellationTokenSource>(conversationId, cts));
                cts.Dispose();
            }
        });
    }
}
