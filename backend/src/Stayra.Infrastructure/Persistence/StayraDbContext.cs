using System.Linq.Expressions;
using Microsoft.AspNetCore.DataProtection.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore;
using Stayra.Application.Common;
using Stayra.Domain;

namespace Stayra.Infrastructure.Persistence;

public class StayraDbContext(DbContextOptions<StayraDbContext> options, ITenantContext tenant)
    : DbContext(options), IAppDbContext, IDataProtectionKeyContext
{
    // Referenced by global query filters; EF re-evaluates these per query on the current context instance.
    public Guid? CurrentTenantId => tenant.TenantId;
    public bool BypassTenantFilter => tenant.BypassFilter;

    public DbSet<Tenant> Tenants => Set<Tenant>();
    public DbSet<User> Users => Set<User>();
    public DbSet<Room> Rooms => Set<Room>();
    public DbSet<RoomPhoto> RoomPhotos => Set<RoomPhoto>();
    public DbSet<PriceRule> PriceRules => Set<PriceRule>();
    public DbSet<Booking> Bookings => Set<Booking>();
    public DbSet<Payment> Payments => Set<Payment>();
    public DbSet<BookingChangeRequest> ChangeRequests => Set<BookingChangeRequest>();
    public DbSet<PolicyDocument> PolicyDocuments => Set<PolicyDocument>();
    public DbSet<PolicyChunk> PolicyChunks => Set<PolicyChunk>();
    public DbSet<RefundPolicy> RefundPolicies => Set<RefundPolicy>();
    public DbSet<FaqItem> FaqItems => Set<FaqItem>();
    public DbSet<Conversation> Conversations => Set<Conversation>();
    public DbSet<Message> Messages => Set<Message>();
    public DbSet<ChannelConnection> ChannelConnections => Set<ChannelConnection>();
    public DbSet<AuditLog> AuditLogs => Set<AuditLog>();
    public DbSet<DataProtectionKey> DataProtectionKeys => Set<DataProtectionKey>();

    protected override void OnModelCreating(ModelBuilder b)
    {
        b.HasPostgresExtension("vector");
        b.HasPostgresExtension("btree_gist");

        b.Entity<Tenant>(e =>
        {
            e.HasIndex(x => x.Slug).IsUnique();
            e.Property(x => x.Slug).HasMaxLength(80);
            e.Property(x => x.Name).HasMaxLength(200);
        });

        b.Entity<User>(e =>
        {
            e.HasIndex(x => x.Email).IsUnique();
            e.Property(x => x.Email).HasMaxLength(256);
        });

        b.Entity<Room>(e =>
        {
            e.HasIndex(x => new { x.TenantId, x.Code }).IsUnique();
            e.HasMany(x => x.Photos).WithOne().HasForeignKey(p => p.RoomId).OnDelete(DeleteBehavior.Cascade);
            e.Property(x => x.BaseNightlyPrice).HasPrecision(14, 0);
            e.Property(x => x.BaseHourlyPrice).HasPrecision(14, 0);
            e.Property(x => x.ExtraGuestFee).HasPrecision(14, 0);
            e.Property(x => x.AreaM2).HasPrecision(8, 1);
        });

        b.Entity<PriceRule>(e => e.Property(x => x.Value).HasPrecision(14, 2));

        b.Entity<Booking>(e =>
        {
            e.HasIndex(x => x.Code).IsUnique();
            e.HasIndex(x => new { x.TenantId, x.StartAt });
            e.HasIndex(x => new { x.RoomId, x.Status });
            e.HasOne(x => x.Room).WithMany().HasForeignKey(x => x.RoomId).OnDelete(DeleteBehavior.Restrict);
            e.HasMany(x => x.Payments).WithOne(p => p.Booking).HasForeignKey(p => p.BookingId);
            foreach (var p in new[] { nameof(Booking.TotalAmount), nameof(Booking.DepositAmount), nameof(Booking.PaidAmount), nameof(Booking.RefundAmount), nameof(Booking.CreditAmount) })
                e.Property(p).HasPrecision(14, 0);
            e.Property(x => x.PriceBreakdownJson).HasColumnType("jsonb");
            e.Ignore(x => x.Balance);
        });

        b.Entity<Payment>(e =>
        {
            e.HasIndex(x => x.OrderId).IsUnique();
            e.Property(x => x.Amount).HasPrecision(14, 0);
            e.Property(x => x.RawCallbackJson).HasColumnType("jsonb");
        });

        b.Entity<BookingChangeRequest>(e =>
        {
            e.HasOne(x => x.Booking).WithMany().HasForeignKey(x => x.BookingId);
            e.Property(x => x.PayloadJson).HasColumnType("jsonb");
            e.Property(x => x.PriceDiff).HasPrecision(14, 0);
            e.Property(x => x.RefundQuote).HasPrecision(14, 0);
        });

        b.Entity<PolicyChunk>(e =>
        {
            e.Property(x => x.Embedding).HasColumnType("vector(1024)");
            e.HasIndex(x => x.Embedding).HasMethod("hnsw").HasOperators("vector_cosine_ops");
            e.HasIndex(x => new { x.TenantId, x.DocumentId });
        });

        b.Entity<RefundPolicy>(e =>
        {
            e.OwnsMany(x => x.Rules, r =>
            {
                r.ToJson();
                r.Property(x => x.AppliesTo).HasConversion<string>();
            });
            e.Property(x => x.NoShowRefundPercent).HasPrecision(5, 2);
        });

        b.Entity<Conversation>(e =>
        {
            e.HasIndex(x => new { x.TenantId, x.LastMessageAt });
            e.HasIndex(x => new { x.TenantId, x.Channel, x.ExternalUserId });
            e.HasIndex(x => x.VisitorToken);
            e.HasMany(x => x.Messages).WithOne().HasForeignKey(m => m.ConversationId).OnDelete(DeleteBehavior.Cascade);
        });

        b.Entity<Message>(e =>
        {
            e.HasIndex(x => new { x.ConversationId, x.CreatedAt });
            e.HasIndex(x => new { x.ConversationId, x.ExternalMessageId });
            e.Property(x => x.CardsJson).HasColumnType("jsonb");
        });

        b.Entity<ChannelConnection>(e =>
        {
            e.HasIndex(x => new { x.TenantId, x.Channel, x.AccountId }).IsUnique();
            e.HasIndex(x => new { x.Channel, x.AccountId });
        });

        b.Entity<AuditLog>(e => e.HasIndex(x => new { x.TenantId, x.EntityId }));

        // Store enums as readable strings and apply tenant filters to every ITenantOwned entity.
        foreach (var et in b.Model.GetEntityTypes().Where(t => !t.IsOwned()))
        {
            // Ids are client-generated (Guid v7); never let EF mistake a new child for an existing row.
            if (typeof(Entity).IsAssignableFrom(et.ClrType)) b.Entity(et.ClrType).Property(nameof(Entity.Id)).ValueGeneratedNever();

            foreach (var prop in et.ClrType.GetProperties())
            {
                var t = Nullable.GetUnderlyingType(prop.PropertyType) ?? prop.PropertyType;
                if (t.IsEnum && et.FindProperty(prop.Name) is not null)
                    b.Entity(et.ClrType).Property(prop.Name).HasConversion<string>().HasMaxLength(32);
            }

            if (typeof(ITenantOwned).IsAssignableFrom(et.ClrType))
            {
                var method = typeof(StayraDbContext).GetMethod(nameof(ApplyTenantFilter), System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Instance)!
                    .MakeGenericMethod(et.ClrType);
                method.Invoke(this, [b]);
            }
        }
    }

    private void ApplyTenantFilter<T>(ModelBuilder b) where T : class, ITenantOwned
    {
        Expression<Func<T, bool>> filter = e => BypassTenantFilter || e.TenantId == CurrentTenantId;
        b.Entity<T>().HasQueryFilter(filter);
    }

    public override Task<int> SaveChangesAsync(CancellationToken ct = default)
    {
        // Stamp TenantId on new tenant-owned rows and block cross-tenant writes.
        foreach (var entry in ChangeTracker.Entries<ITenantOwned>())
        {
            if (entry.State == EntityState.Added && entry.Entity.TenantId == Guid.Empty && CurrentTenantId is { } tid)
                entry.Entity.TenantId = tid;
            if (!BypassTenantFilter && CurrentTenantId is { } current
                && entry.State is EntityState.Added or EntityState.Modified or EntityState.Deleted
                && entry.Entity.TenantId != current)
                throw new AppException(403, "cross_tenant_write", "Cross-tenant write blocked.");
        }
        return base.SaveChangesAsync(ct);
    }
}
