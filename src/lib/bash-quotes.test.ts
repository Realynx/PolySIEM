import { describe, expect, it } from "vitest";
import { decodeEntities, parseBashQuote } from "./bash-quotes";

/** Trimmed from a live bash-org-archive.com permalink page. */
const PAGE = `
<p class="quote">
  <a href="/?396045" title="Permanent link to this quote."><b>#396045</b></a>
  <a href="#+" class="qa">+</a>
  (<font color="green">319</font>)
  <a href="#-" class="qa">-</a>
</p>
<p class="qt">&lt;GOD&gt; whats next on my list?
&lt;GOD&gt; ah yes
* moogle has quit IRC (Ping timeout)
</p>
`;

describe("decodeEntities", () => {
  it("decodes named and numeric entities", () => {
    expect(decodeEntities("&lt;nick&gt; hi &amp; bye")).toBe("<nick> hi & bye");
    expect(decodeEntities("&#39;quoted&#39;")).toBe("'quoted'");
    expect(decodeEntities("&#x41;")).toBe("A");
  });

  it("leaves unknown entities alone", () => {
    expect(decodeEntities("&bogus; 100&")).toBe("&bogus; 100&");
  });
});

describe("parseBashQuote", () => {
  it("extracts the quote body, id and rating", () => {
    const quote = parseBashQuote(PAGE);
    expect(quote).not.toBeNull();
    expect(quote!.id).toBe(396045);
    expect(quote!.rating).toBe(319);
    expect(quote!.url).toBe("https://bash-org-archive.com/?396045");
    expect(quote!.source).toBe("live");
    expect(quote!.text).toBe(
      "<GOD> whats next on my list?\n<GOD> ah yes\n* moogle has quit IRC (Ping timeout)",
    );
  });

  it("truncates very long quotes", () => {
    const long = `<p class="qt">${Array.from({ length: 40 }, (_, i) => `line ${i}`).join("\n")}</p>`;
    const quote = parseBashQuote(long);
    expect(quote!.text.split("\n")).toHaveLength(13);
    expect(quote!.text.endsWith("…")).toBe(true);
  });

  it("returns null when the page has no quote", () => {
    expect(parseBashQuote("<html><body>nope</body></html>")).toBeNull();
    expect(parseBashQuote('<p class="qt">   </p>')).toBeNull();
  });
});
