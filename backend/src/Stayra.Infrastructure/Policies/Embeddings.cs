using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;
using Stayra.Application.Common;

namespace Stayra.Infrastructure.Policies;

/// <summary>Voyage AI embeddings (voyage-3, 1024 dims). Disabled when no key is configured; search then falls back to full-text.</summary>
public class VoyageEmbeddingService(HttpClient http, IConfiguration config, ILogger<VoyageEmbeddingService> log) : IEmbeddingService
{
    private readonly string? _key = config["Embeddings:VoyageApiKey"];
    private readonly string _model = config["Embeddings:Model"] ?? "voyage-3";

    public bool IsEnabled => !string.IsNullOrWhiteSpace(_key);
    public int Dimensions => 1024;

    public async Task<float[]?> EmbedAsync(string text, bool isQuery, CancellationToken ct = default)
    {
        var r = await CallAsync([text], isQuery ? "query" : "document", ct);
        return r?.FirstOrDefault();
    }

    public async Task<IReadOnlyList<float[]>?> EmbedManyAsync(IReadOnlyList<string> texts, CancellationToken ct = default)
    {
        if (texts.Count == 0) return [];
        var all = new List<float[]>();
        foreach (var batch in texts.Chunk(64))
        {
            var r = await CallAsync(batch, "document", ct);
            if (r == null) return null;
            all.AddRange(r);
        }
        return all;
    }

    private async Task<List<float[]>?> CallAsync(IReadOnlyList<string> input, string inputType, CancellationToken ct)
    {
        if (!IsEnabled) return null;
        try
        {
            using var req = new HttpRequestMessage(HttpMethod.Post, "https://api.voyageai.com/v1/embeddings")
            {
                Content = JsonContent.Create(new { input, model = _model, input_type = inputType }),
            };
            req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", _key);
            var resp = await http.SendAsync(req, ct);
            if (!resp.IsSuccessStatusCode)
            {
                log.LogWarning("Voyage embeddings failed: {Status} {Body}", resp.StatusCode, await resp.Content.ReadAsStringAsync(ct));
                return null;
            }
            var json = await resp.Content.ReadFromJsonAsync<JsonElement>(ct);
            return json.GetProperty("data").EnumerateArray()
                .OrderBy(d => d.GetProperty("index").GetInt32())
                .Select(d => d.GetProperty("embedding").EnumerateArray().Select(x => x.GetSingle()).ToArray())
                .ToList();
        }
        catch (Exception ex)
        {
            log.LogWarning(ex, "Voyage embeddings call failed");
            return null;
        }
    }
}
