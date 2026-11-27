using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Stayra.Api.Infrastructure;
using Stayra.Application.Common;
using Stayra.Domain;
using Stayra.Infrastructure.Persistence;

namespace Stayra.Api.Controllers;

[ApiController]
[Authorize(Policy = "Owner")]
public abstract class OwnerControllerBase : ControllerBase
{
    private Tenant? _tenant;

    protected StayraDbContext Db => HttpContext.RequestServices.GetRequiredService<StayraDbContext>();
    protected Guid TenantId => User.TenantIdOf() ?? throw AppException.Forbidden();
    protected string Actor => Actors.Owner(User.EmailOf());

    protected async Task<Tenant> CurrentTenantAsync() =>
        _tenant ??= await Db.Tenants.FirstOrDefaultAsync(t => t.Id == TenantId) ?? throw AppException.Forbidden();
}

public abstract class PublicControllerBase : ControllerBase
{
    protected Tenant CurrentTenant => HttpContext.Items["tenant"] as Tenant ?? throw AppException.NotFound("Homestay");
}
