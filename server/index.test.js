import test from 'node:test';
import assert from 'node:assert/strict';

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
