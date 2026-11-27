using System.Text.Json;
using Microsoft.AspNetCore.Mvc;
using Stayra.Api.Contracts;
using Stayra.Application.Common;
using Stayra.Infrastructure.Payments;

namespace Stayra.Api.Controllers;

[ApiController]
[Route("api/payments/momo")]
public class MomoController(MomoCallbackService callbacks, ILogger<MomoController> log) : ControllerBase
{
    /// <summary>MoMo server-to-server IPN. Signature-verified and idempotent by orderId. MoMo expects HTTP 204.</summary>
    [HttpPost("ipn")]
    public async Task<IActionResult> Ipn([FromBody] JsonElement body)
    {
        var fields = new Dictionary<string, string>();
        foreach (var p in body.EnumerateObject())
            fields[p.Name] = p.Value.ValueKind == JsonValueKind.String ? p.Value.GetString() ?? "" : p.Value.GetRawText();
        var outcome = await callbacks.HandleAsync(fields);
        if (!outcome.SignatureValid) log.LogWarning("Rejected MoMo IPN for {OrderId}", fields.GetValueOrDefault("orderId"));
        return outcome.SignatureValid ? NoContent() : BadRequest();
    }

    /// <summary>The browser lands on the web app's /pay/return page with MoMo's signed query string; the page forwards it here.</summary>
    [HttpGet("return")]
    public async Task<object> Return()
    {
        var fields = Request.Query.ToDictionary(q => q.Key, q => q.Value.ToString());
        var o = await callbacks.HandleAsync(fields);
        return new
        {
            signatureValid = o.SignatureValid,
            found = o.Found,
            status = o.Status?.ToString(),
            bookingCode = o.BookingCode,
            tenantSlug = o.TenantSlug,
            amount = o.Amount,
            kind = o.Kind?.ToString(),
            resultCode = fields.GetValueOrDefault("resultCode"),
            message = fields.GetValueOrDefault("message"),
        };
    }
}

/// <summary>Development helpers so the demo never depends on the network. Disabled outside Development.</summary>
[ApiController]
[Route("api/dev")]
public class DevController(IWebHostEnvironment env, MomoCallbackService callbacks, IConfiguration config) : ControllerBase
{
    [HttpGet("config")]
    public object Config() => new
    {
        devTools = env.IsDevelopment(),
        aiEnabled = !string.IsNullOrEmpty(config["Anthropic:ApiKey"]),
        embeddingsEnabled = !string.IsNullOrEmpty(config["Embeddings:VoyageApiKey"]),
    };

    [HttpPost("payments/{id:guid}/simulate-success")]
    public async Task<object> Simulate(Guid id)
    {
        if (!env.IsDevelopment()) throw AppException.NotFound("Endpoint");
        var p = await callbacks.SimulateSuccessAsync(id);
        return PaymentDto.From(p);
    }
}
