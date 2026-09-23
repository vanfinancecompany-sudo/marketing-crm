// Visual-only geometry and typography, shared by the canvas and SVG renderers.
// Scene selection, copy, photo order and duration belong to the existing caller.
export function editorialLayout(index, finalCta = false) {
  const typeFirst = !finalCta && index % 4 % 2 === 0;
  const light = !finalCta && index % 4 === 3;
  return {
    typeFirst, light,
    photoY: finalCta ? 208 : typeFirst ? 770 : 242,
    textY: finalCta ? 1026 : typeFirst ? 236 : 1080,
    background: finalCta ? '#e92642' : light ? '#eeece5' : '#0b1015',
    ink: light ? '#10171b' : '#f7f4ec',
    muted: light ? '#546064' : finalCta ? '#ffe4e6' : '#aab6bf',
    accent: light ? '#ce1836' : finalCta ? '#ffffff' : '#ff425c',
  };
}

export function editorialMotion(progress, index) {
  const p = Math.max(0, Math.min(1, progress));
  return {
    zoom: index % 2 === 0
      ? 1.016 + 0.03 * (1 - Math.exp(-p * 7)) + 0.009 * p
      : 1.055 - 0.031 * (1 - Math.exp(-p * 6)) - 0.008 * p,
    textScale: 1 + 0.025 * Math.exp(-p * 14),
    textOffset: 18 * Math.exp(-p * 14),
  };
}

export function editorialHeadline(value, measure, finalCta = false) {
  const text = String(value || '').replace(/\s+/g, ' ').trim().toUpperCase();
  const wrap = (copy, size, width = 926) => {
    const lines = [];
    let current = '';
    for (const word of copy.split(' ').filter(Boolean)) {
      const next = current ? `${current} ${word}` : word;
      if (current && measure(next, size) > width) { lines.push(current); current = word; }
      else current = next;
    }
    if (current) lines.push(current);
    return lines;
  };
  // Isolate an existing offer figure without rewriting or inventing copy.
  const figure = !finalCta && text.match(/£[\d,.]+(?:\s*P\/M)?|\b60\b|\b200\+/);
  let rows;
  if (figure) {
    const before = text.slice(0, figure.index).trim();
    const after = text.slice(figure.index + figure[0].length).trim();
    rows = [
      ...wrap(before, 65).map(line => ({ text: line, size: 65, tone: 'ink' })),
      { text: figure[0], size: Math.min(250, 926 / Math.max(measure(figure[0], 1), 1)), tone: 'accent' },
      ...wrap(after, 96).map(line => ({ text: line, size: 96, tone: 'ink' })),
    ];
  } else {
    let size = finalCta ? 160 : 132;
    while (size > 56 && (wrap(text, size).length > 3 || wrap(text, size).some(line => measure(line, size) > 926))) size -= 2;
    rows = wrap(text, size).map(line => ({ text: line, size, tone: 'ink' }));
  }
  const total = rows.reduce((sum, row) => sum + row.size * 1.02, 0);
  const widest = Math.max(1, ...rows.map(row => measure(row.text, row.size)));
  const scale = Math.min(1, (finalCta ? 420 : 444) / Math.max(total, 1), 926 / widest);
  let baseline = 0;
  return rows.map(row => {
    const size = row.size * scale;
    baseline += size * 1.02;
    return { ...row, size, y: baseline };
  });
}
