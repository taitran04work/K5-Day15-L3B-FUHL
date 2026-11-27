using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Design;
using Stayra.Infrastructure.Services;

namespace Stayra.Infrastructure.Persistence;

public class DesignTimeFactory : IDesignTimeDbContextFactory<StayraDbContext>
{
    public StayraDbContext CreateDbContext(string[] args)
    {
        var cs = Environment.GetEnvironmentVariable("ConnectionStrings__Default") ?? "Host=localhost;Port=5432;Database=stayra;Username=stayra;Password=stayra";
        var options = new DbContextOptionsBuilder<StayraDbContext>().UseNpgsql(cs, o => o.UseVector()).Options;
        var tenant = new TenantContext();
        tenant.Set(null, bypass: true);
        return new StayraDbContext(options, tenant);
    }
}
