---
"@scrivr/core": patch
"@scrivr/docx": patch
"@scrivr/export-pdf": patch
---

A resolution records what the chosen face does not supply

Finding the closest physical face and deciding how to make it satisfy an
appearance it was not designed for are two different jobs, and they had been
fused. The layout resolver spelled the resource's own weight and slant into the
string it measured with — the decision "do not synthesize", written into the
resolution layer — so no renderer could see that anything was missing, and
reporting had to reconstruct the gap by diffing the request against the
resource.

`FontResolution.synthesis` now records it as `{ weight?: { from, to }, style?:
{ from, to } }`, present only when a resource answered. `FontShortfall` carries
it through, so a DOCX import diagnostic says "No bold face is available, and
neither is synthesized" rather than only naming the face it settled on.

No rendering change: the canvas renderer still declines to fake a weight,
because a browser's synthetic bold widens each glyph's advance and a PDF's
stroked equivalent does not. That stays true until both lanes position glyphs
from the same measurements.
