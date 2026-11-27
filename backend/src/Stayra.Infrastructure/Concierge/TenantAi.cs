using Anthropic;
using Anthropic.Models.Messages;
using Microsoft.Extensions.Configuration;
using Stayra.Application.Common;
using Stayra.Domain;

namespace Stayra.Infrastructure.Concierge;

/// <summary>
/// Resolves which Anthropic key and model a homestay's AI features use. Each homestay brings its own key
/// (set by the owner in Bot settings, stored encrypted). Without one, callers fall back to their offline,
/// rule-based behaviour — the platform key is only used when <c>Anthropic:PlatformKeyFallback</c> is true.
/// </summary>
public class TenantAi(ISecretProtector secrets, IConfiguration config)
{
    /// <summary>Models an owner may choose. First entry is the default.</summary>
    public static readonly string[] Models = ["claude-haiku-5-5", "claude-sonnet-5-5", "claude-opus-5-5"];

    public string? ApiKey(Tenant t)
    {
        var own = secrets.Unprotect(t.AnthropicApiKeyEnc);
        if (!string.IsNullOrWhiteSpace(own)) return own;
        var platform = config["Anthropic:ApiKey"];
        return config.GetValue("Anthropic:PlatformKeyFallback", false) && !string.IsNullOrWhiteSpace(platform) ? platform : null;
    }

    public bool Enabled(Tenant t) => ApiKey(t) is not null;

    public string Model(Tenant t) =>
        t.AiModel is { Length: > 0 } m && Models.Contains(m) ? m : config["Anthropic:Model"] is { Length: > 0 } c ? c : Models[0];

    public AnthropicClient? Client(Tenant t) => ApiKey(t) is { } key ? new AnthropicClient { ApiKey = key } : null;

    /// <summary>Makes a tiny request with the given key so the owner learns immediately whether it works.</summary>
    public static async Task<(bool Ok, string? Error)> TestKeyAsync(string apiKey, string model, CancellationToken ct = default)
    {
        try
        {
            var client = new AnthropicClient { ApiKey = apiKey };
            await client.Messages.Create(new MessageCreateParams
            {
                Model = model,
                MaxTokens = 8,
                Messages = [new UserMessageParam { Content = "ping" }],
            }, ct);
            return (true, null);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            var msg = ex.Message;
            var code = msg.Contains("401") || msg.Contains("authentication", StringComparison.OrdinalIgnoreCase) ? "invalid_key"
                : msg.Contains("404") || msg.Contains("model", StringComparison.OrdinalIgnoreCase) ? "model_unavailable"
                : msg.Contains("429") || msg.Contains("credit", StringComparison.OrdinalIgnoreCase) ? "quota"
                : "unreachable";
            return (false, code);
        }
    }

    /// <summary>"…abcd" style hint for display.</summary>
    public static string Hint(string key) => key.Length <= 4 ? "…" : "…" + key[^4..];
}
