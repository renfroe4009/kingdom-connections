// The node tree, so deeply nested blocks stay reachable — once a widget sits
// inside a Column inside a Row inside a Section, clicking the right thing on
// the canvas gets fiddly.

import { Layers } from '@craftjs/layers';

export default function LayersPanel() {
  return (
    <div className="bx-layers">
      <Layers expandRootOnLoad />
    </div>
  );
}
