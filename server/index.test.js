import test from 'node:test';
import assert from 'node:assert/strict';

process.env.CCL_SKIP_SERVER = 'true';

const {
  createTreeNode,
  flattenEccnTree,
  markNodeRequiresAllChildren,
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
  assert(parentEntry.structure.children?.some((child) => child.identifier === '3B001.a.4.a'));
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
});
