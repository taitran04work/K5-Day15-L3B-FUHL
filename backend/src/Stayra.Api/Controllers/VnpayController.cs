using Microsoft.AspNetCore.Mvc;
using Stayra.Api.Contracts;
using Stayra.Application.Common;
using Stayra.Infrastructure.Payments;

namespace Stayra.Api.Controllers;

[ApiController]
[Route("api/payments/vnpay")]
public class VnpayController(VnpayCallbackService callbacks, ILogger<VnpayController> log) : ControllerBase
{
    /// <summary>VNPay server-to-server IPN (GET query params). Signature-verified and idempotent by vnp_TxnRef.</summary>
    [HttpGet("ipn")]
    public async Task<IActionResult> Ipn()
    {
        var fields = Request.Query.ToDictionary(q => q.Key, q => q.Value.ToString());
        var outcome = await callbacks.HandleAsync(fields);
        if (!outcome.SignatureValid) log.LogWarning("Rejected VNPay IPN for {OrderId} ({RspCode})", fields.GetValueOrDefault("vnp_TxnRef"), outcome.RspCode);
        return Ok(new { RspCode = outcome.RspCode, Message = outcome.RspMessage });
    }

    /// <summary>The browser lands on /pay/return with VNPay's signed query string; the page forwards it here.</summary>
    [HttpGet("return")]
    public async Task<object> Return()
    {
        var fields = Request.Query.ToDictionary(q => q.Key, q => q.Value.ToString());
        var o = await callbacks.HandleAsync(fields);
        var responseCode = fields.GetValueOrDefault("vnp_ResponseCode");
        return new
        {
            signatureValid = o.SignatureValid,
            found = o.Found,
            status = o.Status?.ToString(),
            bookingCode = o.BookingCode,
            tenantSlug = o.TenantSlug,
            amount = o.Amount,
            kind = o.Kind?.ToString(),
            responseCode,
            transactionStatus = fields.GetValueOrDefault("vnp_TransactionStatus"),
            message = responseCode is null or "00" ? null : $"VNPay ({responseCode})",
        };
    }
}

/// <summary>Development helpers so the demo never depends on the network. Disabled outside Development.</summary>
[ApiController]
[Route("api/dev")]
public class DevController(IWebHostEnvironment env, VnpayCallbackService callbacks, IConfiguration config) : ControllerBase
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
