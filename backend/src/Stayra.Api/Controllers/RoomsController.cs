using FluentValidation;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Stayra.Api.Contracts;
using Stayra.Api.Infrastructure;
using Stayra.Application.Common;
using Stayra.Application.Pricing;
using Stayra.Domain;
using Stayra.Infrastructure.Import;

namespace Stayra.Api.Controllers;

public record RoomInput(string Name, string Code, string? Description, int MaxGuests, int BaseGuests, string? Beds, decimal? AreaM2, List<string>? Amenities,
    bool IsActive, bool SupportsNightly, bool SupportsHourly, decimal BaseNightlyPrice, decimal BaseHourlyPrice, int MinHours, decimal ExtraGuestFee);

public class RoomInputValidator : AbstractValidator<RoomInput>
{
    public RoomInputValidator()
    {
        RuleFor(x => x.Name).NotEmpty().WithErrorCode("required").MaximumLength(120).WithErrorCode("too_long");
        RuleFor(x => x.Code).NotEmpty().WithErrorCode("required").Matches("^[A-Za-z0-9-_]{1,20}$").WithErrorCode("code_format");
        RuleFor(x => x.MaxGuests).InclusiveBetween(1, 30).WithErrorCode("out_of_range");
        RuleFor(x => x.BaseGuests).InclusiveBetween(1, 30).WithErrorCode("out_of_range").LessThanOrEqualTo(x => x.MaxGuests).WithErrorCode("base_guests_too_high");
        RuleFor(x => x).Must(x => x.SupportsNightly || x.SupportsHourly).WithName("supportsNightly").WithErrorCode("mode_required");
        RuleFor(x => x.BaseNightlyPrice).GreaterThan(0).When(x => x.SupportsNightly).WithErrorCode("price_required");
        RuleFor(x => x.BaseHourlyPrice).GreaterThan(0).When(x => x.SupportsHourly).WithErrorCode("price_required");
        RuleFor(x => x.MinHours).InclusiveBetween(1, 12).When(x => x.SupportsHourly).WithErrorCode("out_of_range");
        RuleFor(x => x.ExtraGuestFee).GreaterThanOrEqualTo(0).WithErrorCode("out_of_range");
    }
}

public record PhotoUpdate(string? Caption);
public record OrderRequest(List<Guid> Ids);

[Route("api/app/rooms")]
public class RoomsController(IFileStorage storage, RoomImportService importer) : OwnerControllerBase
{
    [HttpGet]
    public async Task<List<RoomDto>> List() =>
        (await Db.Rooms.Include(r => r.Photos).OrderBy(r => r.SortOrder).ThenBy(r => r.Name).ToListAsync()).Select(RoomDto.From).ToList();

    [HttpGet("{id:guid}")]
    public async Task<RoomDto> Get(Guid id) => RoomDto.From(await Load(id));

    [HttpPost]
    public async Task<RoomDto> Create(RoomInput input, [FromServices] IValidator<RoomInput> v)
    {
        await v.ValidateOrThrow(input);
        await EnsureCodeFree(input.Code, null);
        var order = await Db.Rooms.AnyAsync() ? await Db.Rooms.MaxAsync(r => r.SortOrder) + 1 : 0;
        var room = new Room { TenantId = TenantId, SortOrder = order };
        Apply(room, input);
        Db.Rooms.Add(room);
        Db.AuditLogs.Add(new AuditLog { TenantId = TenantId, Actor = Actor, Action = "room.created", EntityType = nameof(Room), EntityId = room.Id });
        await Db.SaveChangesAsync();
        return RoomDto.From(room);
    }

    [HttpPut("{id:guid}")]
    public async Task<RoomDto> Update(Guid id, RoomInput input, [FromServices] IValidator<RoomInput> v)
    {
        await v.ValidateOrThrow(input);
        var room = await Load(id);
        await EnsureCodeFree(input.Code, id);
        Apply(room, input);
        await Db.SaveChangesAsync();
        return RoomDto.From(room);
    }

    [HttpDelete("{id:guid}")]
    public async Task<IActionResult> Delete(Guid id)
    {
        var room = await Load(id);
        if (await Db.Bookings.AnyAsync(b => b.RoomId == id))
        {
            // Keep history intact: rooms with bookings are archived instead of deleted.
            room.IsActive = false;
            await Db.SaveChangesAsync();
            return Ok(new { archived = true });
        }
        Db.Rooms.Remove(room);
        await Db.SaveChangesAsync();
        return Ok(new { archived = false });
    }

    [HttpPut("order")]
    public async Task<IActionResult> Reorder(OrderRequest req)
    {
        var rooms = await Db.Rooms.ToListAsync();
        for (var i = 0; i < req.Ids.Count; i++)
            if (rooms.FirstOrDefault(r => r.Id == req.Ids[i]) is { } r) r.SortOrder = i;
        await Db.SaveChangesAsync();
        return NoContent();
    }

    // ---------- Photos ----------

    [HttpPost("{id:guid}/photos")]
    [RequestSizeLimit(60_000_000)]
    public async Task<List<PhotoDto>> UploadPhotos(Guid id, List<IFormFile> files)
    {
        var room = await Load(id);
        if (files.Count == 0) throw AppException.BadRequest("no_files", "Choose at least one photo.");
        var next = room.Photos.Count == 0 ? 0 : room.Photos.Max(p => p.SortOrder) + 1;
        foreach (var f in files)
        {
            if (!f.ContentType.StartsWith("image/")) throw AppException.BadRequest("not_an_image", $"{f.FileName} isn't an image.");
            if (f.Length > 15_000_000) throw AppException.BadRequest("file_too_large", $"{f.FileName} is larger than 15 MB.");
            var ext = f.ContentType switch { "image/webp" => "webp", "image/png" => "png", _ => "jpg" };
            await using var s = f.OpenReadStream();
            var url = await storage.SaveAsync(s, $"{TenantId}/rooms/{room.Id}/{Guid.NewGuid():N}.{ext}", f.ContentType);
            var photo = new RoomPhoto { RoomId = room.Id, Url = url, SortOrder = next++, IsCover = room.Photos.Count == 0, Caption = null };
            room.Photos.Add(photo);
            Db.RoomPhotos.Add(photo);
        }
        await Db.SaveChangesAsync();
        return room.Photos.OrderBy(p => p.SortOrder).Select(p => new PhotoDto(p.Id, p.Url, p.Caption, p.SortOrder, p.IsCover)).ToList();
    }

    [HttpPut("{id:guid}/photos/order")]
    public async Task<IActionResult> ReorderPhotos(Guid id, OrderRequest req)
    {
        var room = await Load(id);
        for (var i = 0; i < req.Ids.Count; i++)
            if (room.Photos.FirstOrDefault(p => p.Id == req.Ids[i]) is { } p) p.SortOrder = i;
        await Db.SaveChangesAsync();
        return NoContent();
    }

    [HttpPost("{id:guid}/photos/{photoId:guid}/cover")]
    public async Task<IActionResult> SetCover(Guid id, Guid photoId)
    {
        var room = await Load(id);
        foreach (var p in room.Photos) p.IsCover = p.Id == photoId;
        await Db.SaveChangesAsync();
        return NoContent();
    }

    [HttpPut("{id:guid}/photos/{photoId:guid}")]
    public async Task<IActionResult> UpdatePhoto(Guid id, Guid photoId, PhotoUpdate req)
    {
        var room = await Load(id);
        var photo = room.Photos.FirstOrDefault(p => p.Id == photoId) ?? throw AppException.NotFound("Photo");
        photo.Caption = string.IsNullOrWhiteSpace(req.Caption) ? null : req.Caption.Trim();
        await Db.SaveChangesAsync();
        return NoContent();
    }

    [HttpDelete("{id:guid}/photos/{photoId:guid}")]
    public async Task<IActionResult> DeletePhoto(Guid id, Guid photoId)
    {
        var room = await Load(id);
        var photo = room.Photos.FirstOrDefault(p => p.Id == photoId) ?? throw AppException.NotFound("Photo");
        Db.RoomPhotos.Remove(photo);
        room.Photos.Remove(photo);
        if (photo.IsCover && room.Photos.OrderBy(p => p.SortOrder).FirstOrDefault() is { } first) first.IsCover = true;
        await Db.SaveChangesAsync();
        if (storage.PathFromUrl(photo.Url) is { } path) await storage.DeleteAsync(path);
        return NoContent();
    }

    // ---------- Import ----------

    [HttpGet("import/template")]
    public IActionResult Template([FromQuery] string format = "xlsx") => format == "csv"
        ? File(System.Text.Encoding.UTF8.GetBytes(importer.TemplateCsv()), "text/csv", "stayra-rooms-template.csv")
        : File(importer.TemplateXlsx(), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "stayra-rooms-template.xlsx");

    [HttpPost("import/preview")]
    public async Task<ImportPreview> ImportPreview(IFormFile file)
    {
        if (file == null || file.Length == 0) throw AppException.BadRequest("no_file", "Choose a spreadsheet to import.");
        if (!file.FileName.EndsWith(".xlsx", StringComparison.OrdinalIgnoreCase) && !file.FileName.EndsWith(".csv", StringComparison.OrdinalIgnoreCase))
            throw AppException.BadRequest("unsupported_file", "Use the .xlsx or .csv template.");
        await using var s = file.OpenReadStream();
        var ms = new MemoryStream();
        await s.CopyToAsync(ms);
        ms.Position = 0;
        try { return await importer.PreviewAsync(TenantId, ms, file.FileName); }
        catch (Exception ex) when (ex is not AppException) { throw AppException.BadRequest("unreadable_file", "We couldn't read that file. Please start from the template."); }
    }

    [HttpPost("import/commit")]
    public async Task<ImportCommitResult> ImportCommit([FromBody] List<ImportRow> rows)
    {
        var result = await importer.CommitAsync(TenantId, rows);
        Db.AuditLogs.Add(new AuditLog { TenantId = TenantId, Actor = Actor, Action = "rooms.imported", EntityType = nameof(Room), DataJson = System.Text.Json.JsonSerializer.Serialize(result) });
        await Db.SaveChangesAsync();
        return result;
    }

    private async Task<Room> Load(Guid id) =>
        await Db.Rooms.Include(r => r.Photos).FirstOrDefaultAsync(r => r.Id == id) ?? throw AppException.NotFound("Room");

    private async Task EnsureCodeFree(string code, Guid? exceptId)
    {
        var c = code.Trim().ToUpperInvariant();
        if (await Db.Rooms.AnyAsync(r => r.Code == c && r.Id != exceptId))
            throw new AppException(409, "code_taken", "Another room already uses this code.", new Dictionary<string, string[]> { ["code"] = ["code_taken"] });
    }

    private static void Apply(Room room, RoomInput i)
    {
        room.Name = i.Name.Trim();
        room.Code = i.Code.Trim().ToUpperInvariant();
        room.Description = i.Description?.Trim();
        room.MaxGuests = i.MaxGuests;
        room.BaseGuests = i.BaseGuests;
        room.Beds = i.Beds?.Trim();
        room.AreaM2 = i.AreaM2;
        room.Amenities = i.Amenities?.Select(a => a.Trim().ToLowerInvariant()).Where(a => a.Length > 0).Distinct().ToList() ?? [];
        room.IsActive = i.IsActive;
        room.SupportsNightly = i.SupportsNightly;
        room.SupportsHourly = i.SupportsHourly;
        room.BaseNightlyPrice = i.SupportsNightly ? i.BaseNightlyPrice : 0;
        room.BaseHourlyPrice = i.SupportsHourly ? i.BaseHourlyPrice : 0;
        room.MinHours = i.MinHours <= 0 ? 1 : i.MinHours;
        room.ExtraGuestFee = i.ExtraGuestFee;
    }
}

public record PriceRuleInput(Guid? RoomId, string Name, PriceRuleType Type, List<DayOfWeek>? DaysOfWeek, DateOnly? StartDate, DateOnly? EndDate,
    TimeOnly? StartTime, TimeOnly? EndTime, AdjustmentType AdjustmentType, decimal Value, int Priority, bool IsActive = true);

public class PriceRuleValidator : AbstractValidator<PriceRuleInput>
{
    public PriceRuleValidator()
    {
        RuleFor(x => x.Name).NotEmpty().WithErrorCode("required");
        RuleFor(x => x.StartDate).NotNull().When(x => x.Type is PriceRuleType.DateRange or PriceRuleType.Holiday).WithErrorCode("required");
        RuleFor(x => x.EndDate).NotNull().When(x => x.Type is PriceRuleType.DateRange or PriceRuleType.Holiday).WithErrorCode("required")
            .GreaterThanOrEqualTo(x => x.StartDate).When(x => x.StartDate != null && x.EndDate != null).WithErrorCode("end_before_start");
        RuleFor(x => x.StartTime).NotNull().When(x => x.Type == PriceRuleType.HourWindow).WithErrorCode("required");
        RuleFor(x => x.EndTime).NotNull().When(x => x.Type == PriceRuleType.HourWindow).WithErrorCode("required");
        RuleFor(x => x.Value).InclusiveBetween(-100, 1000).When(x => x.AdjustmentType == AdjustmentType.Percent).WithErrorCode("out_of_range");
        RuleFor(x => x.Value).GreaterThan(0).When(x => x.AdjustmentType == AdjustmentType.Override).WithErrorCode("price_required");
    }
}

[Route("api/app/pricing")]
public class PricingController(PricingService pricing) : OwnerControllerBase
{
    [HttpGet("rules")]
    public async Task<List<PriceRuleDto>> Rules() =>
        (await Db.PriceRules.OrderByDescending(r => r.Priority).ThenBy(r => r.Name).ToListAsync()).Select(PriceRuleDto.From).ToList();

    [HttpPost("rules")]
    public async Task<PriceRuleDto> Create(PriceRuleInput input, [FromServices] IValidator<PriceRuleInput> v)
    {
        await v.ValidateOrThrow(input);
        var rule = new PriceRule { TenantId = TenantId };
        Apply(rule, input);
        Db.PriceRules.Add(rule);
        await Db.SaveChangesAsync();
        return PriceRuleDto.From(rule);
    }

    [HttpPut("rules/{id:guid}")]
    public async Task<PriceRuleDto> Update(Guid id, PriceRuleInput input, [FromServices] IValidator<PriceRuleInput> v)
    {
        await v.ValidateOrThrow(input);
        var rule = await Db.PriceRules.FirstOrDefaultAsync(r => r.Id == id) ?? throw AppException.NotFound("Price rule");
        Apply(rule, input);
        await Db.SaveChangesAsync();
        return PriceRuleDto.From(rule);
    }

    [HttpDelete("rules/{id:guid}")]
    public async Task<IActionResult> Delete(Guid id)
    {
        var rule = await Db.PriceRules.FirstOrDefaultAsync(r => r.Id == id) ?? throw AppException.NotFound("Price rule");
        Db.PriceRules.Remove(rule);
        await Db.SaveChangesAsync();
        return NoContent();
    }

    /// <summary>Effective nightly price for the next N days (price preview calendar).</summary>
    [HttpGet("calendar")]
    public async Task<object> Calendar([FromQuery] Guid roomId, [FromQuery] DateOnly? from, [FromQuery] int days = 60)
    {
        var tenant = await CurrentTenantAsync();
        var start = from ?? DateOnly.FromDateTime(TenantTime.Now(tenant, TimeProvider.System));
        var cal = await pricing.CalendarAsync(tenant, roomId, start, Math.Clamp(days, 1, 120));
        return cal.Select(d => new { date = d.Date, price = d.Price, rule = d.Rule });
    }

    private static void Apply(PriceRule r, PriceRuleInput i)
    {
        r.RoomId = i.RoomId;
        r.Name = i.Name.Trim();
        r.Type = i.Type;
        r.DaysOfWeek = i.DaysOfWeek ?? [];
        r.StartDate = i.StartDate;
        r.EndDate = i.EndDate;
        r.StartTime = i.StartTime;
        r.EndTime = i.EndTime;
        r.AdjustmentType = i.AdjustmentType;
        r.Value = i.Value;
        r.Priority = i.Priority;
        r.IsActive = i.IsActive;
    }
}
