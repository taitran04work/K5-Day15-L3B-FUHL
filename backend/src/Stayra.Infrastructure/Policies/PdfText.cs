using System.Text;
using System.Text.RegularExpressions;
using UglyToad.PdfPig;
using UglyToad.PdfPig.DocumentLayoutAnalysis.TextExtractor;

namespace Stayra.Infrastructure.Policies;

public record PageText(int Page, string Text);
public record TextChunk(int Page, int Ordinal, string Content);

public static partial class PdfText
{
    public static List<PageText> Extract(byte[] pdf)
    {
        using var doc = PdfDocument.Open(pdf);
        var pages = new List<PageText>();
        foreach (var page in doc.GetPages())
        {
            string text;
            try { text = ContentOrderTextExtractor.GetText(page); }
            catch { text = string.Join(" ", page.GetWords().Select(w => w.Text)); }
            pages.Add(new PageText(page.Number, Normalize(text)));
        }
        return pages;
    }

    private static string Normalize(string s)
    {
        s = s.Replace("\r", "");
        s = MultiSpace().Replace(s, " ");
        s = MultiNewline().Replace(s, "\n\n");
        return s.Trim();
    }

    /// <summary>
    /// Splits text into ~maxChars chunks (≈800 tokens) with overlap (≈100 tokens), preferring paragraph/sentence boundaries.
    /// Chunks never span pages, so every chunk keeps an exact page number for citations.
    /// </summary>
    public static List<TextChunk> Chunk(IEnumerable<PageText> pages, int maxChars = 3200, int overlapChars = 400)
    {
        var chunks = new List<TextChunk>();
        var ordinal = 0;
        foreach (var p in pages)
        {
            if (string.IsNullOrWhiteSpace(p.Text)) continue;
            var sentences = SentenceSplit().Split(p.Text).Where(s => s.Trim().Length > 0).ToList();
            var current = new StringBuilder();
            foreach (var sentence in sentences)
            {
                if (current.Length + sentence.Length + 1 > maxChars && current.Length > 0)
                {
                    chunks.Add(new TextChunk(p.Page, ordinal++, current.ToString().Trim()));
                    var tail = current.ToString();
                    current.Clear();
                    if (tail.Length > overlapChars)
                    {
                        var start = tail.Length - overlapChars;
                        var space = tail.IndexOf(' ', start);
                        current.Append(tail[(space < 0 ? start : space + 1)..]).Append(' ');
                    }
                }
                if (sentence.Length > maxChars)
                {
                    for (var i = 0; i < sentence.Length; i += maxChars - overlapChars)
                        chunks.Add(new TextChunk(p.Page, ordinal++, sentence.Substring(i, Math.Min(maxChars, sentence.Length - i)).Trim()));
                    continue;
                }
                current.Append(sentence.Trim()).Append(' ');
            }
            if (current.ToString().Trim().Length > 0) chunks.Add(new TextChunk(p.Page, ordinal++, current.ToString().Trim()));
        }
        return chunks;
    }

    [GeneratedRegex(@"[ \t]+")] private static partial Regex MultiSpace();
    [GeneratedRegex(@"\n{3,}")] private static partial Regex MultiNewline();
    [GeneratedRegex(@"(?<=[.!?])\s+|\n{2,}")] private static partial Regex SentenceSplit();
}
