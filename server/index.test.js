import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

process.env.CCL_SKIP_SERVER = 'true';

const {
  createTreeNode,
  flattenEccnTree,
  markNodeRequiresAllChildren,
  parsePart,
} = await import('./index.js');

test('nodes marked as requiring all children suppress standalone ECCNs', () => {
  const root = createTreeNode({ identifier: '3B001', heading: 'Test root', path: [], parent: null });
  const a = createTreeNode({ identifier: '3B001.a', heading: 'Assemblies', path: ['a'], parent: root });
  root.children.push(a);

  const a4 = createTreeNode({ identifier: '3B001.a.4', heading: 'Assemblies level 4', path: ['a', '4'], parent: a });
  a.children.push(a4);

  markNodeRequiresAllChildren(a4, 'Systems HAVING ALL OF THE FOLLOWING:');

  const a4a = createTreeNode({ identifier: '3B001.a.4.a', heading: 'Requirement 1', path: ['a', '4', 'a'], parent: a4 });
  const a4b = createTreeNode({ identifier: '3B001.a.4.b', heading: 'Requirement 2', path: ['a', '4', 'b'], parent: a4 });
  a4a.content.push({ type: 'text', text: 'a. Requirement 1 details' });
  a4b.content.push({ type: 'text', text: 'b. Requirement 2 details' });
  a4.children.push(a4a, a4b);

  const entries = flattenEccnTree(root, {
    code: '3B001',
    heading: root.heading,
    breadcrumbs: ['Supplement 1'],
    supplement: '1',
  });

  const suppressedChild = entries.find((entry) => entry.eccn === '3B001.a.4.a');
  assert.equal(suppressedChild, undefined);

  const parentEntry = entries.find((entry) => entry.eccn === '3B001.a.4');
  assert(parentEntry, 'expected parent entry to be present');
  assert.deepEqual(parentEntry.childEccns, []);
  const boundChild = parentEntry.structure.children?.find((child) => child.identifier === '3B001.a.4.a');
  assert(boundChild, 'bound child should remain in the parent structure');
  assert.equal(boundChild?.isEccn, true);
  assert.equal(boundChild?.boundToParent, true);
  assert.equal(boundChild?.content?.[0]?.text, 'a. Requirement 1 details');
});

test('nodes without the phrase still produce standalone ECCNs for children', () => {
  const root = createTreeNode({ identifier: '3B002', heading: 'Another root', path: [], parent: null });
  const a = createTreeNode({ identifier: '3B002.a', heading: 'Other assemblies', path: ['a'], parent: root });
  root.children.push(a);

  const a1 = createTreeNode({ identifier: '3B002.a.1', heading: 'Basic requirement', path: ['a', '1'], parent: a });
  a.children.push(a1);

  const a1a = createTreeNode({ identifier: '3B002.a.1.a', heading: 'Sub requirement', path: ['a', '1', 'a'], parent: a1 });
  a1.children.push(a1a);

  const entries = flattenEccnTree(root, {
    code: '3B002',
    heading: root.heading,
    breadcrumbs: ['Supplement 1'],
    supplement: '1',
  });

  const childEntry = entries.find((entry) => entry.eccn === '3B002.a.1.a');
  assert(childEntry, 'child without the special phrase should remain its own ECCN');
  assert.equal(childEntry?.structure.isEccn, true);
  assert.equal(childEntry?.structure.boundToParent, false);
});

test('duplicate headings are removed from structure content', () => {
  const root = createTreeNode({ identifier: '3C001', heading: 'Widgets', path: [], parent: null });
  root.content.push({ type: 'text', text: 'Widgets' });
  root.content.push({ type: 'text', text: 'Note: Additional context' });

  const entries = flattenEccnTree(root, {
    code: '3C001',
    heading: root.heading,
    breadcrumbs: [],
    supplement: '1',
  });

  const [entry] = entries;
  assert(entry, 'expected entry to be generated');
  assert.equal(entry.structure.content?.length, 1);
  assert.equal(entry.structure.content?.[0].text, 'Note: Additional context');
});

test('duplicate headings with enumerators are removed from structure content', () => {
  const root = createTreeNode({ identifier: '3B001', heading: 'Root heading', path: [], parent: null });
  const child = createTreeNode({
    identifier: '3B001.a',
    heading: 'Equipment designed for epitaxial growth as follows',
    path: ['a'],
    parent: root,
  });

  root.children.push(child);

  child.content.push({ type: 'text', text: 'a. Equipment designed for epitaxial growth as follows:' });
  child.content.push({ type: 'text', text: 'Includes metal-organic chemical vapor deposition (MOCVD) systems.' });

  const entries = flattenEccnTree(root, {
    code: '3B001',
    heading: root.heading,
    breadcrumbs: [],
    supplement: '1',
  });

  const entry = entries.find((candidate) => candidate.eccn === '3B001.a');
  assert(entry, 'expected ECCN entry to be present');
  assert.equal(entry.structure.content?.length, 1);
  assert.equal(
    entry.structure.content?.[0].text,
    'Includes metal-organic chemical vapor deposition (MOCVD) systems.'
  );
});

test('parser handles notes, headings, and all-of-the-following blocks correctly', () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<ROOT>
  <DIV5 TYPE="PART" N="774">
    <DIV9 TYPE="SUPPLEMENT" N="1">
      <HEAD>Supplement No. 1 to Part 774—The Commerce Control List</HEAD>
      <HD SOURCE="HED">Category 3 - Electronics</HD>
      <P><B>3B001 Equipment</B></P>
      <P ID="3b001d"><E T="03">d.</E> Control systems for manufacturing</P>
      <P ID="3b001d1"><E T="03">(1)</E> Capable of positioning wafers with nanometer precision</P>
      <NOTE ID="note3b001d1"><P>Note to 3B001.d.1: Additional application guidance.</P></NOTE>
      <P ID="3b001d1ii"><E T="03">(ii)</E> With closed-loop feedback</P>
      <P><B>3B993 Specially designed components</B></P>
      <P ID="3b993f"><E T="03">(f)</E> Devices</P>
      <P ID="3b993f4"><E T="03">(4)</E> All of the following:</P>
      <P ID="3b993f4a"><E T="03">(a)</E> Component A with specific tolerances</P>
      <P ID="3b993f4b"><E T="03">(b)</E> Component B capable of rapid alignment</P>
    </DIV9>
  </DIV5>
</ROOT>`;

  const { supplements } = parsePart(xml);
  const supplement = supplements.find((entry) => entry.number === '1');
  assert(supplement, 'expected supplement to be parsed');

  const entries = supplement.eccns;

  const dEntry = entries.find((entry) => entry.eccn === '3B001.d');
  assert(dEntry, 'expected 3B001.d to be parsed');
  assert.equal(dEntry.heading, 'Control systems for manufacturing');
  assert.equal(dEntry.structure.label, '3B001.d – Control systems for manufacturing');

  const d1Entry = entries.find((entry) => entry.eccn === '3B001.d.1');
  assert(d1Entry, 'expected 3B001.d.1 to be parsed');
  const noteBlocks = (d1Entry.structure.content || []).filter((block) =>
    block.text?.startsWith('Note to 3B001.d.1:')
  );
  assert.equal(noteBlocks.length, 1, 'note should only appear once');

  const f4Entry = entries.find((entry) => entry.eccn === '3B993.f.4');
  assert(f4Entry, 'expected 3B993.f.4 to be parsed');
  assert.deepEqual(f4Entry.childEccns, [], 'children should be suppressed for all-of-the-following');
  const suppressedChildren = f4Entry.structure.children || [];
  const childIds = suppressedChildren.map((child) => child.identifier);
  assert.deepEqual(childIds.sort(), ['3B993.f.4.a', '3B993.f.4.b']);
  const childAText = suppressedChildren.find((child) => child.identifier === '3B993.f.4.a')?.content?.[0]?.text;
  assert(childAText?.includes('Component A with specific tolerances'));

  const suppressedEntries = entries.filter((entry) => entry.eccn.startsWith('3B993.f.4.'));
  assert.equal(suppressedEntries.length, 0, 'child ECCNs should not produce standalone entries');
});

test('shorthand ECCN references expand to explicit lists', () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<ROOT>
  <DIV5 TYPE="PART" N="774">
    <DIV9 TYPE="SUPPLEMENT" N="1">
      <HEAD>Supplement No. 1 to Part 774—The Commerce Control List</HEAD>
      <P><B>3B001 Equipment</B></P>
      <TABLE>
        <TBODY>
          <TR>
            <TD>NS applies to 3B001.a.1 to a.3, b, e, f.2 to f.4, g to j</TD>
            <TD>NS Column 2.</TD>
          </TR>
        </TBODY>
      </TABLE>
    </DIV9>
  </DIV5>
</ROOT>`;

  const { supplements } = parsePart(xml);
  const supplement = supplements.find((entry) => entry.number === '1');
  assert(supplement, 'supplement should be parsed');

  const entry = supplement.eccns.find((candidate) => candidate.eccn === '3B001');
  assert(entry, 'expected 3B001 entry to exist');

  const tableBlock = entry.structure.content?.find((block) => block.tag === 'TABLE');
  assert(tableBlock, 'table block should be present');

  const html = tableBlock.html ?? '';
  assert(html.includes('3B001.a.2'), 'range should expand to include 3B001.a.2');
  assert(html.includes('3B001.a.3'), 'range should expand to include 3B001.a.3');
  assert(html.includes('3B001.b'), 'shorthand letter should expand to full ECCN');
  assert(html.includes('3B001.f.3'), 'numeric ranges should expand to include intermediate ECCNs');
  assert(html.includes('3B001.h'), 'letter ranges should expand across the alphabet');
  assert(!/to\s+a\.3/.test(html), 'original shorthand range text should be replaced');
  assert(!/g\s+to\s+j/.test(html), 'letter shorthand should be removed');
});

test('note paragraphs do not replace ECCN headings', () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<ROOT>
  <DIV5 TYPE="PART" N="774">
    <DIV9 TYPE="SUPPLEMENT" N="1">
      <HEAD>Supplement No. 1 to Part 774—The Commerce Control List</HEAD>
      <P><B>3B001 Equipment</B></P>
      <P ID="3b001f"><E T="03">(f)</E> Assemblies, as follows:</P>
      <P ID="3b001f2"><E T="03">(2)</E> Assemblies with positional accuracy better than 5 nm</P>
      <NOTE ID="note3b001f2"><P>Note to 3B001.f.2: These notes provide additional context.</P></NOTE>
      <P ID="3b001f2i"><E T="03">(i)</E> Incorporating closed-loop feedback control</P>
    </DIV9>
  </DIV5>
</ROOT>`;

  const { supplements } = parsePart(xml);
  const supplement = supplements.find((entry) => entry.number === '1');
  assert(supplement, 'expected supplement to be parsed');

  const entries = supplement.eccns;
  const entry = entries.find((candidate) => candidate.eccn === '3B001.f.2');
  assert(entry, 'expected 3B001.f.2 entry to be present');
  assert.equal(
    entry.heading,
    'Assemblies with positional accuracy better than 5 nm',
    'note text should not replace the ECCN heading'
  );

  const label = entry.structure.label;
  assert(label?.includes('3B001.f.2'), 'label should include the ECCN identifier');
  assert(label?.includes('Assemblies with positional accuracy better than 5 nm'));
  assert(!label?.includes('Note to 3B001.f.2'), 'label should not include the note text');

  const noteBlocks = (entry.structure.content || []).filter((block) =>
    block.text?.startsWith('Note to 3B001.f.2:')
  );
  assert.equal(noteBlocks.length, 1, 'note should remain in the ECCN content');
});

test('letter enumerators reset after deeply nested paragraphs', () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<ROOT>
  <DIV5 TYPE="PART" N="774">
    <DIV9 TYPE="SUPPLEMENT" N="1">
      <HEAD>Supplement No. 1 to Part 774—The Commerce Control List</HEAD>
      <P><B>3B001 Equipment</B></P>
      <P><E T="03">c.4.c.3.</E> Placeholder requirement</P>
      <P><E T="03">d.</E> Semiconductor manufacturing deposition equipment, as follows:</P>
      <P><E T="03">d.1.</E> Equipment designed for cobalt (Co) electroplating or cobalt electroless-plating deposition processes;</P>
    </DIV9>
  </DIV5>
</ROOT>`;

  const { supplements } = parsePart(xml);
  const supplement = supplements.find((entry) => entry.number === '1');
  assert(supplement, 'expected supplement to be parsed');

  const entries = supplement.eccns;
  const dEntry = entries.find((entry) => entry.eccn === '3B001.d');
  assert(dEntry, 'expected 3B001.d to be parsed');
  assert.equal(dEntry.heading, 'Semiconductor manufacturing deposition equipment, as follows:');
});

test('compound enumerators with cross references keep descriptive children', () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<ROOT>
  <DIV5 TYPE="PART" N="774">
    <DIV9 TYPE="SUPPLEMENT" N="1">
      <HEAD>Supplement No. 1 to Part 774—The Commerce Control List</HEAD>
      <P><B>3B993 Components</B></P>
      <P ID="fheading"><E T="03">(f)</E> Devices</P>
      <P ID="f4"><E T="03">f.4.</E> Commodities not specified by 3B993.f.1 designed or modified to perform all of the following in or with deep-ultraviolet immersion photolithography equipment:</P>
      <P ID="f4a"><E T="03">f.4.a.</E> Decrease the minimum resolvable feature specified by 3B993.f.1.b.1; and</P>
      <P ID="f4b"><E T="03">f.4.b.</E> Decrease the maximum 'dedicated chuck overlay' of deep-ultraviolet immersion lithography equipment above 1.5 nm and below or equal to 2.4 nm.</P>
    </DIV9>
  </DIV5>
</ROOT>`;

  const { supplements } = parsePart(xml);
  const supplement = supplements.find((entry) => entry.number === '1');
  assert(supplement, 'expected supplement to be parsed');

  const entry = supplement.eccns.find((candidate) => candidate.eccn === '3B993.f.4');
  assert(entry, 'expected 3B993.f.4 entry to exist');
  assert.equal(entry.heading, 'Commodities not specified by 3B993.f.1 designed or modified to perform all of the following in or with deep-ultraviolet immersion photolithography equipment:');
  assert.deepEqual(entry.childEccns, [], 'children should be suppressed when all-of-the-following applies');
  const childIdentifiers = entry.structure.children?.map((child) => child.identifier).sort();
  assert.deepEqual(childIdentifiers, ['3B993.f.4.a', '3B993.f.4.b']);
});

test('heading updates when initial capture only yields the ECCN identifier', () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<ROOT>
  <DIV5 TYPE="PART" N="774">
    <DIV9 TYPE="SUPPLEMENT" N="1">
      <HEAD>Supplement No. 1 to Part 774—The Commerce Control List</HEAD>
      <P><B>3B001 Equipment</B></P>
      <P ID="3b001d"><E T="03">d.</E><E T="03">3B001.d</E></P>
      <P>Control systems for manufacturing wafers</P>
    </DIV9>
  </DIV5>
</ROOT>`;

  const { supplements } = parsePart(xml);
  const supplement = supplements.find((entry) => entry.number === '1');
  assert(supplement, 'supplement should be parsed');

  const entry = supplement.eccns.find((candidate) => candidate.eccn === '3B001.d');
  assert(entry, '3B001.d entry should exist');
  assert.equal(entry.heading, 'Control systems for manufacturing wafers');
  assert.equal(entry.structure.label, '3B001.d – Control systems for manufacturing wafers');
});

test('all-of-the-following is detected even when descriptive text is separated into another paragraph', () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<ROOT>
  <DIV5 TYPE="PART" N="774">
    <DIV9 TYPE="SUPPLEMENT" N="1">
      <HEAD>Supplement No. 1 to Part 774—The Commerce Control List</HEAD>
      <P><B>3B993 Components</B></P>
      <P ID="3b993f"><E T="03">(f)</E> Devices</P>
      <P ID="3b993f4"><E T="03">(4)</E></P>
      <P><I>All of the following:</I></P>
      <P ID="3b993f4a"><E T="03">(a)</E> Component A with precision alignment</P>
      <P ID="3b993f4b"><E T="03">(b)</E> Component B capable of rapid alignment</P>
    </DIV9>
  </DIV5>
</ROOT>`;

  const { supplements } = parsePart(xml);
  const supplement = supplements.find((entry) => entry.number === '1');
  assert(supplement, 'supplement should be parsed');

  const entries = supplement.eccns;

  const f4Entry = entries.find((entry) => entry.eccn === '3B993.f.4');
  assert(f4Entry, '3B993.f.4 entry should exist');
  assert.equal(f4Entry.childEccns.length, 0, 'children should be suppressed');

  const suppressedChildren = f4Entry.structure.children || [];
  const childAText = suppressedChildren.find((child) => child.identifier === '3B993.f.4.a')?.content?.[0]?.text;
  assert(childAText?.includes('Component A with precision alignment'), 'child A text should be retained');

  const suppressedStandaloneEntries = entries.filter((entry) => entry.eccn.startsWith('3B993.f.4.'));
  assert.equal(suppressedStandaloneEntries.length, 0, 'suppressed children must not produce standalone ECCNs');
});

test('list-based license exceptions retain full LVS breakdown for 3A001', () => {
  const xml = readFileSync(new URL('../example-title-15.xml', import.meta.url), 'utf8');
  const { supplements } = parsePart(xml);
  const supplement = supplements.find((entry) => entry.number === '1');
  assert(supplement, 'supplement 1 should be present');

  const eccn = supplement.eccns.find((entry) => entry.eccn === '3A001');
  assert(eccn, 'expected ECCN 3A001 to be parsed');

  const licenseLines = eccn.structure.content
    .map((block) => (typeof block.text === 'string' ? block.text.trim() : ''))
    .filter((text) => Boolean(text));

  const yesForIndex = licenseLines.indexOf('Yes for:');
  assert.notEqual(yesForIndex, -1, 'LVS section should include a "Yes for:" line');

  const hasValueBreakdown = licenseLines.some((line) =>
    line.includes('$5000: 3A001.a (except a.1.a and a.5.a when controlled for MT), b.4 to b.7, and b.12.')
  );

  assert(hasValueBreakdown, 'LVS section should include the $5000 value breakdown for 3A001');
});
