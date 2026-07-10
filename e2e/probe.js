// Page shape probe for browser smoke tests.
//
// Returns a snapshot of what's rendered on the current page + any errors
// captured on the window. Paste this into the page console or run via the
// claude-in-chrome `javascript_tool`.
//
// No DOM mutation. Safe to run on any page.
(() => {
  const text = (el) => (el?.innerText ?? '').trim().slice(0, 200);
  const texts = (sel, limit = 20) =>
    Array.from(document.querySelectorAll(sel))
      .map((el) => text(el))
      .filter(Boolean)
      .slice(0, limit);

  const firstOf = (selectors) => {
    for (const s of selectors) {
      const el = document.querySelector(s);
      if (el) return text(el);
    }
    return null;
  };

  return {
    url: location.href,
    pathname: location.pathname,
    title: document.title,
    h1: firstOf(['h1']),
    h2s: texts('h2', 5),
    hasNav: !!document.querySelector('nav'),
    hasMain: !!document.querySelector('main, [role="main"]'),
    bodyText: text(document.body).slice(0, 400),
    buttonTexts: texts('button'),
    linkTexts: texts('a'),
    inputs: document.querySelectorAll('input, textarea, select').length,
    familyLinks: Array.from(document.querySelectorAll('a[href^="/family/"]'))
      .map((a) => a.getAttribute('href'))
      .filter(Boolean)
      .slice(0, 10),
    sessionLinks: Array.from(document.querySelectorAll('a[href^="/sessions/"]'))
      .map((a) => a.getAttribute('href'))
      .filter(Boolean)
      .slice(0, 10),
    timestamp: new Date().toISOString(),
  };
})();
