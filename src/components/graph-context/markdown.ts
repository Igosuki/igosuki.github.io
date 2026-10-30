const INLINE = /(\*\*[^*]+\*\*|`[^`]+`)/;

function inline(parent: HTMLElement, text: string) {
  for (const part of text.split(INLINE)) {
    if (!part) continue;
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
      const b = document.createElement('strong');
      b.textContent = part.slice(2, -2);
      parent.append(b);
    } else if (part.startsWith('`') && part.endsWith('`') && part.length > 2) {
      const c = document.createElement('code');
      c.textContent = part.slice(1, -1);
      parent.append(c);
    } else {
      parent.append(part);
    }
  }
}

const cells = (line: string) =>
  line
    .trim()
    .replace(/^\||\|$/g, '')
    .split('|')
    .map((c) => c.trim());
const isRule = (line: string) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(line);
const LIST = /^\s*(?:(\d+)\.|[-*])\s+(.*)$/;

/** Renders bold, inline code, paragraphs, flat lists and pipe tables; everything else stays plain text. */
export function renderMarkdown(source: string): DocumentFragment {
  const out = document.createDocumentFragment();
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
    } else if (line.trim().startsWith('|') && i + 1 < lines.length && isRule(lines[i + 1])) {
      const table = document.createElement('table');
      const head = table.createTHead().insertRow();
      for (const c of cells(line)) inline(head.appendChild(document.createElement('th')), c);
      const body = table.createTBody();
      i += 2;
      while (i < lines.length && lines[i].trim().startsWith('|')) {
        const row = body.insertRow();
        for (const c of cells(lines[i])) inline(row.insertCell(), c);
        i++;
      }
      const wrap = document.createElement('div');
      wrap.className = 'gx-table';
      wrap.append(table);
      out.append(wrap);
    } else if (LIST.test(line)) {
      const ordered = /^\s*\d+\./.test(line);
      const list = document.createElement(ordered ? 'ol' : 'ul');
      while (i < lines.length && LIST.test(lines[i])) {
        inline(list.appendChild(document.createElement('li')), lines[i].match(LIST)![2]);
        i++;
      }
      out.append(list);
    } else {
      const p = document.createElement('p');
      const para: string[] = [];
      while (i < lines.length && lines[i].trim() && !LIST.test(lines[i]) && !lines[i].trim().startsWith('|')) para.push(lines[i++].trim());
      if (!para.length) para.push(lines[i++].trim());
      inline(p, para.join(' '));
      out.append(p);
    }
  }
  return out;
}
