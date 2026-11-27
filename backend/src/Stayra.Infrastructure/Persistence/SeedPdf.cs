using UglyToad.PdfPig.Content;
using UglyToad.PdfPig.Core;
using UglyToad.PdfPig.Fonts.Standard14Fonts;
using UglyToad.PdfPig.Writer;

namespace Stayra.Infrastructure.Persistence;

/// <summary>Generates the sample "House rules & cancellation policy" PDF used by the seed and the demo.</summary>
public static class SeedPdf
{
    public record Section(string Heading, string[] Paragraphs);

    public static byte[] PineHillPolicy() => Build("Pine Hill Homestay", "House rules and cancellation policy", "Effective 1 January 2026 · 12 Đường Hoa Hồng, Ward 4, Đà Lạt",
    [
        new("1. Check-in and check-out", [
            "Check-in is from 14:00 and check-out is by 12:00. Early check-in and late check-out are subject to availability and may incur a fee of 100,000 VND per hour.",
            "Hourly stays are available between 07:00 and 23:00 for selected rooms, with a minimum of 2 hours.",
            "Please present a valid ID card or passport for every adult guest at check-in, as required by local regulations.",
        ]),
        new("2. House rules", [
            "Quiet hours are from 22:00 to 07:00. Please keep music and conversations low so that every guest can rest.",
            "Smoking is not allowed inside the rooms or on the balconies. A smoking area is available in the garden near the gate.",
            "Pets are not allowed, with the exception of registered assistance animals.",
            "Visitors who are not registered guests must leave the property by 21:00.",
            "Free parking is available for motorbikes. Car parking is available on the street outside the gate.",
        ]),
        new("3. Breakfast and facilities", [
            "A simple breakfast of bread, eggs, fruit and Đà Lạt coffee is served from 07:00 to 09:30 in the garden house and is included for nightly stays.",
            "Wi-Fi is free throughout the property. The network name and password are posted inside each room.",
            "Rooms are heated in the evening. Extra blankets are available at reception.",
        ]),
        new("4. Payments", [
            "A deposit of 30% of the total price is required to confirm a booking. Unpaid holds are released after 15 minutes.",
            "The remaining balance is due 24 hours before check-in and can be paid by MoMo using the link we send you.",
        ]),
        new("5. Cancellation policy", [
            "Cancellations made more than 7 days (168 hours) before the check-in time receive a full refund of the deposit (100%).",
            "Cancellations made between 3 and 7 days (72 to 168 hours) before the check-in time receive a refund of 50% of the deposit.",
            "Cancellations made less than 72 hours before the check-in time are not refundable.",
            "Guests who do not arrive on the check-in date without notice (no-show) are not refunded.",
            "Refunds are returned to the original MoMo wallet within 3 to 5 working days.",
        ]),
        new("6. Changes to a booking", [
            "Guests may change dates or rooms free of charge, subject to availability. If the new stay costs more, the difference is added to the remaining balance. If it costs less, any amount already paid above the new total is refunded.",
        ]),
        new("7. Damage and lost items", [
            "Guests are responsible for damage to the room or furniture beyond normal wear. Lost keys are charged at 200,000 VND.",
            "Items left behind are kept for 30 days. Contact us on Zalo or by phone at 0912 345 678.",
        ]),
    ]);

    public static byte[] Build(string title, string subtitle, string meta, IReadOnlyList<Section> sections)
    {
        var builder = new PdfDocumentBuilder();
        var regular = builder.AddStandard14Font(Standard14Font.Helvetica);
        var bold = builder.AddStandard14Font(Standard14Font.HelveticaBold);
        const double left = 60, right = 535, top = 790, bottom = 60;

        var page = builder.AddPage(PageSize.A4);
        var y = top;

        void NewPage()
        {
            page = builder.AddPage(PageSize.A4);
            y = top;
        }

        void Write(string text, double size, PdfDocumentBuilder.AddedFont font, double lineGap)
        {
            foreach (var line in Wrap(page, text, font, size, right - left))
            {
                if (y < bottom) NewPage();
                page.AddText(line, size, new PdfPoint(left, y), font);
                y -= size + lineGap;
            }
        }

        Write(title, 22, bold, 6);
        Write(subtitle, 14, regular, 4);
        Write(Ascii(meta), 9, regular, 4);
        y -= 18;
        foreach (var s in sections)
        {
            if (y < bottom + 80) NewPage();
            Write(s.Heading, 13, bold, 6);
            y -= 2;
            foreach (var p in s.Paragraphs)
            {
                Write(Ascii(p), 10.5, regular, 4.5);
                y -= 6;
            }
            y -= 10;
        }
        return builder.Build();
    }

    private static IEnumerable<string> Wrap(PdfPageBuilder page, string text, PdfDocumentBuilder.AddedFont font, double size, double width)
    {
        var words = Ascii(text).Split(' ', StringSplitOptions.RemoveEmptyEntries);
        var line = "";
        foreach (var w in words)
        {
            var candidate = line.Length == 0 ? w : line + " " + w;
            var letters = page.MeasureText(candidate, size, PdfPoint.Origin, font);
            var measured = letters.Count == 0 ? 0 : letters[^1].EndBaseLine.X - letters[0].StartBaseLine.X;
            if (measured > width && line.Length > 0)
            {
                yield return line;
                line = w;
            }
            else line = candidate;
        }
        if (line.Length > 0) yield return line;
    }

    /// <summary>Standard-14 fonts only support WinAnsi; strip Vietnamese diacritics.</summary>
    private static string Ascii(string s)
    {
        var n = s.Replace('đ', 'd').Replace('Đ', 'D').Normalize(System.Text.NormalizationForm.FormD);
        var chars = n.Where(c => System.Globalization.CharUnicodeInfo.GetUnicodeCategory(c) != System.Globalization.UnicodeCategory.NonSpacingMark)
            .Select(c => c == '·' ? '-' : c).Where(c => c < 256);
        return new string(chars.ToArray());
    }
}
