using System.Globalization;
using ClosedXML.Excel;
using CsvHelper;
using CsvHelper.Configuration;
using Microsoft.EntityFrameworkCore;
using Stayra.Application.Common;
using Stayra.Domain;

namespace Stayra.Infrastructure.Import;

public record ImportRow(
    int Row, string Name, string Code, string? Description, int MaxGuests, string? Beds, decimal? NightlyPrice, decimal? HourlyPrice,
    int MinHours, List<string> Amenities, bool Exists, Dictionary<string, string> Errors);

public record ImportPreview(List<ImportRow> Rows, int Valid, int Invalid, int New, int Updates);

public record ImportCommitResult(int Created, int Updated);

/// <summary>Bulk room import from xlsx/csv. Columns: name, code, description, max_guests, beds, nightly_price, hourly_price, min_hours, amenities ("wifi|ac|balcony").</summary>
public class RoomImportService(IAppDbContext db)
{
    public static readonly string[] Columns = ["name", "code", "description", "max_guests", "beds", "nightly_price", "hourly_price", "min_hours", "amenities"];

    private static readonly object[][] Examples =
    [
        ["Lake View Double", "LV-01", "Bright double room facing the lake.", 2, "1 queen bed", 750000, 130000, 2, "wifi|heater|lake_view"],
        ["Family Room", "FAM-01", "Two double beds, ideal for families.", 4, "2 double beds", 1200000, "", "", "wifi|heater|bathtub"],
    ];

    public byte[] TemplateXlsx() => BuildXlsx(Examples);

    public static readonly object[][] DaLatSample =
    [
        ["Pine Loft", "DL-LOFT", "Wooden loft under the eaves with a reading nook and pine views.", 2, "1 queen bed", 850000, 150000, 2, "wifi|heater|balcony|mountain_view"],
        ["Garden Double", "DL-GDN", "Ground-floor double opening onto the flower garden.", 2, "1 double bed", 650000, 120000, 2, "wifi|heater|garden_view"],
        ["Family Suite", "DL-FAM", "Two queen beds and a sofa corner over the valley.", 5, "2 queen beds", 1450000, "", "", "wifi|heater|valley_view|bathtub"],
        ["Attic Twin", "DL-ATT", "Cosy twin room in the attic with a skylight.", 2, "2 single beds", 550000, 100000, 2, "wifi|heater"],
        ["Valley View King", "DL-VAL", "King bed and floor-to-ceiling windows facing sunrise.", 2, "1 king bed", 1050000, 180000, 3, "wifi|heater|valley_view|balcony|bathtub"],
        ["Cabin Studio", "DL-CAB", "Standalone garden cabin with a kitchenette and daybed.", 3, "1 queen bed + daybed", 900000, "", "", "wifi|heater|kitchenette|parking"],
        ["Misty Hill Room", "DL-MST", "Quiet room on the upper floor where the morning mist rolls in.", 2, "1 queen bed", 720000, 130000, 2, "wifi|heater|mountain_view"],
        ["Coffee Corner Double", "DL-CFE", "Next to the garden coffee bar, with a small private terrace.", 2, "1 double bed", 690000, 120000, 2, "wifi|heater|coffee|garden_view"],
    ];

    public static byte[] BuildXlsx(object[][] rows)
    {
        using var wb = new XLWorkbook();
        var ws = wb.AddWorksheet("Rooms");
        for (var i = 0; i < Columns.Length; i++)
        {
            ws.Cell(1, i + 1).Value = Columns[i];
            ws.Cell(1, i + 1).Style.Font.Bold = true;
        }
        for (var r = 0; r < rows.Length; r++)
            for (var c = 0; c < rows[r].Length; c++)
                ws.Cell(r + 2, c + 1).Value = XLCellValue.FromObject(rows[r][c]);
        ws.Columns().AdjustToContents();
        using var ms = new MemoryStream();
        wb.SaveAs(ms);
        return ms.ToArray();
    }

    public string TemplateCsv()
    {
        using var sw = new StringWriter();
        using var csv = new CsvWriter(sw, CultureInfo.InvariantCulture);
        foreach (var c in Columns) csv.WriteField(c);
        csv.NextRecord();
        foreach (var row in Examples)
        {
            foreach (var v in row) csv.WriteField(Convert.ToString(v, CultureInfo.InvariantCulture));
            csv.NextRecord();
        }
        return sw.ToString();
    }

    public async Task<ImportPreview> PreviewAsync(Guid tenantId, Stream file, string fileName, CancellationToken ct = default)
    {
        var raw = fileName.EndsWith(".csv", StringComparison.OrdinalIgnoreCase) ? ReadCsv(file) : ReadXlsx(file);
        var existingCodes = (await db.Rooms.Where(r => r.TenantId == tenantId).Select(r => r.Code).ToListAsync(ct)).ToHashSet(StringComparer.OrdinalIgnoreCase);
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var rows = new List<ImportRow>();
        foreach (var (rowNum, cells) in raw)
        {
            if (cells.Values.All(string.IsNullOrWhiteSpace)) continue;
            var errors = new Dictionary<string, string>();
            string Get(string k) => cells.TryGetValue(k, out var v) ? v.Trim() : "";

            var name = Get("name");
            var code = Get("code").ToUpperInvariant();
            if (name.Length == 0) errors["name"] = "required";
            if (code.Length == 0) errors["code"] = "required";
            else if (!seen.Add(code)) errors["code"] = "duplicate_in_file";

            var maxGuests = ParseInt(Get("max_guests"), "max_guests", errors, required: true, min: 1, max: 30) ?? 0;
            var nightly = ParseMoney(Get("nightly_price"), "nightly_price", errors);
            var hourly = ParseMoney(Get("hourly_price"), "hourly_price", errors);
            var minHours = ParseInt(Get("min_hours"), "min_hours", errors, required: false, min: 1, max: 12) ?? (hourly is > 0 ? 2 : 0);
            if (nightly is null or 0 && hourly is null or 0) errors["nightly_price"] = "price_required";

            var amenities = Get("amenities").Split(['|', ',', ';'], StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
                .Select(a => a.ToLowerInvariant().Replace(' ', '_')).Distinct().ToList();

            rows.Add(new ImportRow(rowNum, name, code, NullIfEmpty(Get("description")), maxGuests, NullIfEmpty(Get("beds")), nightly, hourly, minHours,
                amenities, existingCodes.Contains(code), errors));
        }
        var valid = rows.Count(r => r.Errors.Count == 0);
        return new ImportPreview(rows, valid, rows.Count - valid, rows.Count(r => r.Errors.Count == 0 && !r.Exists), rows.Count(r => r.Errors.Count == 0 && r.Exists));
    }

    public async Task<ImportCommitResult> CommitAsync(Guid tenantId, IReadOnlyList<ImportRow> rows, CancellationToken ct = default)
    {
        var rooms = await db.Rooms.Where(r => r.TenantId == tenantId).ToListAsync(ct);
        var order = rooms.Count == 0 ? 0 : rooms.Max(r => r.SortOrder) + 1;
        int created = 0, updated = 0;
        foreach (var row in rows.Where(r => r.Errors.Count == 0))
        {
            var room = rooms.FirstOrDefault(r => string.Equals(r.Code, row.Code, StringComparison.OrdinalIgnoreCase));
            if (room == null)
            {
                room = new Room { TenantId = tenantId, Code = row.Code, SortOrder = order++ };
                db.Rooms.Add(room);
                rooms.Add(room);
                created++;
            }
            else updated++;
            room.Name = row.Name;
            room.Description = row.Description ?? room.Description;
            room.MaxGuests = row.MaxGuests;
            room.BaseGuests = Math.Min(room.BaseGuests == 0 ? 2 : room.BaseGuests, row.MaxGuests);
            room.Beds = row.Beds ?? room.Beds;
            room.SupportsNightly = row.NightlyPrice is > 0;
            room.BaseNightlyPrice = row.NightlyPrice ?? 0;
            room.SupportsHourly = row.HourlyPrice is > 0;
            room.BaseHourlyPrice = row.HourlyPrice ?? 0;
            room.MinHours = Math.Max(1, row.MinHours);
            if (row.Amenities.Count > 0) room.Amenities = row.Amenities;
        }
        await db.SaveChangesAsync(ct);
        return new ImportCommitResult(created, updated);
    }

    private static string? NullIfEmpty(string s) => s.Length == 0 ? null : s;

    private static int? ParseInt(string v, string key, Dictionary<string, string> errors, bool required, int min, int max)
    {
        if (v.Length == 0)
        {
            if (required) errors[key] = "required";
            return null;
        }
        if (!int.TryParse(v.Split('.')[0], NumberStyles.Integer, CultureInfo.InvariantCulture, out var n) || n < min || n > max)
        {
            errors[key] = "out_of_range";
            return null;
        }
        return n;
    }

    private static decimal? ParseMoney(string v, string key, Dictionary<string, string> errors)
    {
        if (v.Length == 0) return null;
        var cleaned = new string(v.Where(c => char.IsDigit(c) || c == '.').ToArray());
        // "1.250.000" (vi thousands separators) vs "1250000.0"
        if (cleaned.Count(c => c == '.') > 1 || (cleaned.Contains('.') && cleaned.Split('.')[1].Length == 3)) cleaned = cleaned.Replace(".", "");
        if (!decimal.TryParse(cleaned, NumberStyles.Number, CultureInfo.InvariantCulture, out var d) || d < 0 || d > 1_000_000_000)
        {
            errors[key] = "invalid_number";
            return null;
        }
        return Math.Round(d);
    }

    private static List<(int Row, Dictionary<string, string> Cells)> ReadXlsx(Stream file)
    {
        using var wb = new XLWorkbook(file);
        var ws = wb.Worksheets.First();
        var header = ws.Row(1).CellsUsed().ToDictionary(c => c.Address.ColumnNumber, c => Normalize(c.GetString()));
        var result = new List<(int, Dictionary<string, string>)>();
        foreach (var row in ws.RowsUsed().Skip(1))
        {
            var cells = header.ToDictionary(h => h.Value, h => row.Cell(h.Key).GetFormattedString());
            result.Add((row.RowNumber(), cells));
        }
        return result;
    }

    private static List<(int Row, Dictionary<string, string> Cells)> ReadCsv(Stream file)
    {
        using var reader = new StreamReader(file);
        using var csv = new CsvReader(reader, new CsvConfiguration(CultureInfo.InvariantCulture) { DetectDelimiter = true, MissingFieldFound = null, BadDataFound = null });
        csv.Read();
        csv.ReadHeader();
        var headers = csv.HeaderRecord!.Select(Normalize).ToArray();
        var result = new List<(int, Dictionary<string, string>)>();
        var rowNum = 1;
        while (csv.Read())
        {
            rowNum++;
            var cells = new Dictionary<string, string>();
            for (var i = 0; i < headers.Length; i++) cells[headers[i]] = csv.GetField(i) ?? "";
            result.Add((rowNum, cells));
        }
        return result;
    }

    private static string Normalize(string h) => h.Trim().ToLowerInvariant().Replace(' ', '_');
}
